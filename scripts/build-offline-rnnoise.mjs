// Build host only: pinned Xiph source/model -> standalone CPU Windows executable.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-rnnoise.lock.json"), "utf8"),
);
const files = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-rnnoise-sources.json"), "utf8"),
);
const source = path.join(root, ".tmp/rnnoise-research/source");
const dest = path.join(root, "vendor/offline-tools/win32-x64/rnnoise");
const sha = (b) => createHash("sha256").update(b).digest("hex");
await fs.mkdir(dest, { recursive: true });
if (process.argv.includes("--verify")) {
	const info = JSON.parse(await fs.readFile(path.join(dest, "BUILD-INFO.json"), "utf8"));
	if (info.sourceRevision !== lock.sourceRevision || info.modelSha256 !== lock.modelSha256)
		throw Error("RNNoise revision mismatch");
	for (const item of info.files)
		if (sha(await fs.readFile(path.join(dest, item.path))) !== item.sha256)
			throw Error(`RNNoise checksum mismatch: ${item.path}`);
	console.log("RNNoise assets verified");
	process.exit(0);
}
if (process.platform !== "win32" || process.arch !== "x64")
	throw Error("Build requires Windows x64");
for (const entry of files) {
	const out = path.join(source, entry.path);
	await fs.mkdir(path.dirname(out), { recursive: true });
	const validate = (b) =>
		createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex") === entry.gitBlob;
	if (
		await fs
			.readFile(out)
			.then(validate)
			.catch(() => false)
	)
		continue;
	const response = await fetch(
		`https://raw.githubusercontent.com/xiph/rnnoise/${lock.sourceRevision}/${entry.path}`,
		{ signal: AbortSignal.timeout(60000) },
	);
	if (!response.ok) throw Error(`Source download ${response.status}: ${entry.path}`);
	const b = Buffer.from(await response.arrayBuffer());
	if (!validate(b)) throw Error("Pinned source Git blob mismatch");
	await fs.writeFile(out, b);
}
const archive = path.join(root, ".tmp/rnnoise-research/model.tar.gz");
if (
	(await fs
		.readFile(archive)
		.then(sha)
		.catch(() => null)) !== lock.modelSha256
) {
	const response = await fetch(lock.modelUrl, { signal: AbortSignal.timeout(120000) });
	if (!response.ok) throw Error("Model download failed");
	const b = Buffer.from(await response.arrayBuffer());
	if (sha(b) !== lock.modelSha256) throw Error("Model checksum mismatch");
	await fs.writeFile(archive, b);
}
execFileSync("tar", ["-xzf", archive, "-C", source, "src/rnnoise_data.c", "src/rnnoise_data.h"], {
	windowsHide: true,
});
const tool = JSON.parse(
	await fs.readFile(path.join(root, "scripts/offline-ai-build.lock.json"), "utf8"),
).llvm;
const bin = path.join(root, ".tmp/offline-build-tools", tool.directory, "bin");
const names = [
	"denoise",
	"rnn",
	"pitch",
	"kiss_fft",
	"celt_lpc",
	"nnet",
	"nnet_default",
	"parse_lpcnet_weights",
	"rnnoise_data",
	"rnnoise_tables",
];
const exe = path.join(dest, "rnnoise-cli.exe");
execFileSync(
	path.join(bin, "x86_64-w64-mingw32-clang.exe"),
	[
		"-O2",
		"-static",
		"-municode",
		"-DRNNOISE_BUILD",
		"-I" + path.join(source, "include"),
		"-I" + path.join(source, "src"),
		...names.map((n) => path.join(source, "src", n + ".c")),
		path.join(root, "scripts/rnnoise-cli.c"),
		"-o",
		exe,
	],
	{ windowsHide: true, stdio: "inherit" },
);
await fs.copyFile(path.join(source, "COPYING"), path.join(dest, "RNNoise-COPYING.txt"));
await fs.copyFile(path.join(source, "AUTHORS"), path.join(dest, "RNNoise-AUTHORS.txt"));
await fs.writeFile(
	path.join(dest, "MODEL-NOTICE.txt"),
	`Official Xiph RNNoise default model generated sources, embedded unchanged.\nSource ${lock.sourceRevision}\nModel archive SHA256 ${lock.modelSha256}\nDistributed by Xiph through download_model.sh as part of RNNoise; see RNNoise-COPYING.txt. No training checkpoints are included.\n`,
);
const imports = execFileSync(path.join(bin, "llvm-readobj.exe"), ["--coff-imports", exe], {
	encoding: "utf8",
	windowsHide: true,
});
if (/(?:libwinpthread|libgcc|libc\+\+|vcruntime|msvcp).*\.dll/i.test(imports))
	throw Error("Unexpected external runtime dependency");
const manifest = [];
for (const p of [
	"rnnoise-cli.exe",
	"RNNoise-COPYING.txt",
	"RNNoise-AUTHORS.txt",
	"MODEL-NOTICE.txt",
]) {
	const b = await fs.readFile(path.join(dest, p));
	manifest.push({ path: p, bytes: b.length, sha256: sha(b) });
}
await fs.writeFile(
	path.join(dest, "BUILD-INFO.json"),
	JSON.stringify({ ...lock, compiler: tool.directory, files: manifest }, null, 2) + "\n",
);
console.log(execFileSync(exe, ["--version"], { encoding: "utf8", windowsHide: true }));
