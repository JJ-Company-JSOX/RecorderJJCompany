// Build-time extraction only. Never runs the installer or changes system runtimes.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
	await fs.readFile(path.join(repository, "scripts/offline-msvc.lock.json"), "utf8"),
);
const destination = path.join(repository, "vendor/offline-tools/win32-x64/msvc"),
	cache = path.join(repository, ".tmp/microsoft-crt");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const check = async (file, entry) => {
	const bytes = await fs.readFile(file);
	if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256)
		throw Error("Microsoft runtime checksum mismatch");
};
if (process.argv.includes("--verify")) {
	for (const entry of lock.files) await check(path.join(destination, entry.path), entry);
	console.log("Verified pinned app-local Microsoft runtime; no network used");
} else {
	await fs.mkdir(cache, { recursive: true });
	await fs.mkdir(destination, { recursive: true });
	const installer = path.join(cache, "vc_redist.x64.exe");
	try {
		await check(installer, lock.installer);
	} catch {
		const response = await fetch(lock.installer.url, { signal: AbortSignal.timeout(120000) });
		if (!response.ok) throw Error("Microsoft runtime download failed");
		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.length !== lock.installer.bytes || digest(bytes) !== lock.installer.sha256)
			throw Error("Microsoft runtime archive integrity failed");
		await fs.writeFile(installer, bytes);
	}
	const bytes = await fs.readFile(installer),
		cab = bytes.subarray(lock.container.offset, lock.container.offset + lock.container.size);
	if (cab.toString("ascii", 0, 4) !== "MSCF" || digest(cab) !== lock.container.sha256)
		throw Error("Pinned Microsoft cabinet differs");
	const container = path.join(cache, "app-local-container.cab"),
		stage = await fs.mkdtemp(path.join(cache, "extract-"));
	await fs.writeFile(container, cab);
	const extract = (file, directory, member) => {
		const result = spawnSync(
			"tar",
			["-xf", file, "-C", directory, ...(member ? [member] : [])],
			{ encoding: "utf8", windowsHide: true, timeout: 30000 },
		);
		if (result.status !== 0)
			throw Error(`Microsoft cabinet extraction failed: ${result.stderr}`);
	};
	extract(container, stage, lock.container.payload);
	const payload = path.join(stage, lock.container.payload);
	if (digest(await fs.readFile(payload)) !== lock.container.payloadSha256)
		throw Error("Pinned Microsoft payload differs");
	const dlls = path.join(stage, "dlls");
	await fs.mkdir(dlls);
	// Names and cabinet are locked, with no user-supplied archive paths.
	extract(payload, dlls);
	for (const entry of lock.files) {
		if (!/^[a-z0-9_.]+\.dll$/.test(entry.path) || entry.source !== `${entry.path}_amd64`)
			throw Error("Invalid runtime dependency name");
		await check(path.join(dlls, entry.source), entry);
		await fs.copyFile(path.join(dlls, entry.source), path.join(destination, entry.path));
	}
	await fs.copyFile(
		path.join(repository, "scripts/offline-msvc.lock.json"),
		path.join(destination, "SOURCE-LOCK.json"),
	);
	await fs.writeFile(
		path.join(destination, "NOTICE.txt"),
		`Microsoft Visual C++ Redistributable ${lock.runtimeVersion} app-local x64 dependencies. Copyright Microsoft Corporation. These are not open-source libraries. Original Microsoft-signed DLLs are extracted without modification from the pinned Microsoft redistributable; no installer is run and no system runtime is installed or replaced. Redistribution is subject to Microsoft's software license terms: ${lock.licenseUrl}\nOfficial package manifest: ${lock.manifestSource}\nCommercial distribution review remains a separate release requirement.\n`,
	);
	console.log("Prepared Microsoft app-local dependencies without system installation");
}
