// Developer-only asset preparation. Customer runtime never downloads or invokes pip.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(repository, "vendor/offline-tools/win32-x64/scene");
const lock = JSON.parse(
	await fs.readFile(path.join(repository, "scripts/offline-scene.lock.json"), "utf8"),
);
const digest = async (file) => {
	const sum = createHash("sha256");
	for await (const chunk of createReadStream(file)) sum.update(chunk);
	return sum.digest("hex");
};
async function verify() {
	const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
	if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 10000)
		throw Error("Invalid scene bundle manifest");
	for (const entry of manifest.files) {
		if (
			typeof entry.file !== "string" ||
			/(^|\/)\.\.(\/|$)|[:\\]/.test(entry.file) ||
			entry.file.startsWith("/")
		)
			throw Error("Invalid scene asset path");
		const file = path.join(root, entry.file);
		if ((await fs.stat(file)).size !== entry.size || (await digest(file)) !== entry.sha256)
			throw Error(`Scene asset integrity failed: ${entry.file}`);
	}
	console.log(`Verified ${manifest.files.length} offline scene assets`);
}
if (process.argv.includes("--verify")) {
	await verify();
} else {
	if (process.platform !== "win32" || process.arch !== "x64")
		throw Error("Prepare the Windows x64 scene bundle on Windows x64");
	await fs.mkdir(root, { recursive: true });
	const cache = path.join(repository, ".tmp/scene-downloads");
	await fs.mkdir(cache, { recursive: true });
	const runtime = path.join(root, "runtime"),
		packages = path.join(runtime, "site-packages");
	await fs.mkdir(packages, { recursive: true });
	for (const entry of lock.files) {
		if (
			!Number.isSafeInteger(entry.size) ||
			entry.size <= 0 ||
			entry.size > 100_000_000 ||
			!/^[a-f0-9]{64}$/.test(entry.sha256)
		)
			throw Error("Invalid locked scene archive");
		const archive = path.join(cache, entry.file);
		if ((await digest(archive).catch(() => "")) !== entry.sha256) {
			const response = await fetch(entry.url, { signal: AbortSignal.timeout(300000) });
			if (!response.ok)
				throw Error(`Scene asset download failed: ${entry.name} ${response.status}`);
			const bytes = Buffer.from(await response.arrayBuffer());
			if (
				bytes.length !== entry.size ||
				createHash("sha256").update(bytes).digest("hex") !== entry.sha256
			)
				throw Error(`Scene archive hash mismatch: ${entry.name}`);
			await fs.writeFile(archive, bytes);
		}
		console.log(`Extracting pinned ${entry.name} ${entry.version}`);
		const listing = spawnSync("tar", ["-tf", archive], {
			encoding: "utf8",
			windowsHide: true,
			timeout: 30000,
			maxBuffer: 4 * 1024 * 1024,
		});
		if (
			listing.status !== 0 ||
			listing.stdout
				.split(/\r?\n/)
				.some(
					(name) => name && (/^[/\\]|[:\\]/.test(name) || name.split("/").includes("..")),
				)
		)
			throw Error("Unsafe or unreadable scene archive");
		const extraction = spawnSync(
			"tar",
			["-xf", archive, "-C", entry.name === "python" ? runtime : packages],
			{ encoding: "utf8", windowsHide: true, timeout: 120000 },
		);
		if (extraction.status !== 0)
			throw Error(`Scene archive extraction failed: ${extraction.stderr}`);
	}
	await fs.writeFile(
		path.join(runtime, "python313._pth"),
		"python313.zip\n.\nsite-packages\nimport site\n",
	);
	const dependency = spawnSync(
		process.execPath,
		[path.join(repository, "scripts/prepare-offline-msvc.mjs")],
		{ windowsHide: true, encoding: "utf8" },
	);
	if (dependency.status !== 0)
		throw Error(`App-local runtime preparation failed: ${dependency.stderr}`);
	const msvc = JSON.parse(
		await fs.readFile(path.join(repository, "scripts/offline-msvc.lock.json"), "utf8"),
	);
	for (const entry of msvc.files)
		await fs.copyFile(
			path.join(repository, "vendor/offline-tools/win32-x64/msvc", entry.path),
			path.join(runtime, entry.path),
		);
	await fs.copyFile(
		path.join(repository, "vendor/offline-tools/win32-x64/msvc/NOTICE.txt"),
		path.join(root, "MSVC-NOTICE.txt"),
	);
	await fs.copyFile(
		path.join(repository, "scripts/scene-worker.py"),
		path.join(root, "scene-worker.py"),
	);
	const probe = spawnSync(
		path.join(runtime, "python.exe"),
		[
			"-I",
			"-B",
			"-c",
			"import cv2,numpy,scenedetect; print(cv2.__version__,numpy.__version__,scenedetect.__version__)",
		],
		{ encoding: "utf8", windowsHide: true, timeout: 30000 },
	);
	if (probe.status !== 0) throw Error(`Embedded scene runtime failed to import: ${probe.stderr}`);
	console.log(probe.stdout.trim());
	await fs.writeFile(
		path.join(root, "NOTICE.txt"),
		"Offline scene detection uses an isolated, bundled Python runtime with PySceneDetect, OpenCV headless, NumPy, Click, platformdirs, tqdm and colorama. No customer Python installation is used. Original license files are retained in runtime/LICENSE.txt and runtime/site-packages/*.dist-info/. OpenCV third-party notices include its decoder dependencies. Exact package versions and archive hashes are in SOURCE-LOCK.json.\n",
	);
	await fs.copyFile(
		path.join(repository, "scripts/offline-scene.lock.json"),
		path.join(root, "SOURCE-LOCK.json"),
	);
	const files = [];
	async function walk(directory) {
		for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
			const full = path.join(directory, entry.name);
			if (entry.isSymbolicLink()) throw Error("Scene bundle must not contain symbolic links");
			if (entry.isDirectory()) await walk(full);
			else if (
				entry.name !== "manifest.json" &&
				!full.includes(`${path.sep}__pycache__${path.sep}`)
			)
				files.push({
					file: path.relative(root, full).replaceAll("\\", "/"),
					size: (await fs.stat(full)).size,
					sha256: await digest(full),
				});
		}
	}
	await walk(root);
	await fs.writeFile(
		path.join(root, "manifest.json"),
		JSON.stringify(
			{
				version: 1,
				engine: "PySceneDetect",
				engineVersion: "0.7.2",
				pythonVersion: "3.13.16",
				files,
			},
			null,
			2,
		),
	);
	await verify();
}
