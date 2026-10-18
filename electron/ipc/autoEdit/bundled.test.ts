import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyBundledAi } from "./bundled";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) {
		const target = path.resolve(root);
		if (
			path.dirname(target) !== path.resolve(os.tmpdir()) ||
			!path.basename(target).startsWith("jsox-bundled-test-")
		)
			throw Error("Refusing to remove a directory outside the test temporary root");
		await rm(target, { recursive: true, force: true });
	}
});
async function fixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), "jsox-bundled-test-"));
	roots.push(root);
	await mkdir(path.join(root, "runtime-static"));
	const files = [];
	for (const file of ["model.gguf", "vision.gguf", "runtime-static/llama-server.exe"]) {
		const bytes = Buffer.from(`Synthetic integrity-test fixture, never executed: ${file}`);
		await writeFile(path.join(root, file), bytes);
		files.push({
			file,
			size: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
	}
	await writeFile(
		path.join(root, "manifest.json"),
		JSON.stringify({ version: 1, modelName: "fixture", files }),
	);
	return root;
}
it("verifies streamed asset hashes and rejects changed weights of the same size", async () => {
	const root = await fixture();
	await expect(verifyBundledAi(root, new AbortController().signal)).resolves.toBeUndefined();
	const bytes = await readFile(path.join(root, "model.gguf"));
	bytes[0] ^= 1;
	await writeFile(path.join(root, "model.gguf"), bytes);
	await expect(verifyBundledAi(root, new AbortController().signal)).rejects.toThrow("integrity");
});
it("rejects missing assets, manifest path traversal and canceled verification", async () => {
	const root = await fixture();
	const controller = new AbortController();
	controller.abort();
	await expect(verifyBundledAi(root, controller.signal)).rejects.toThrow();
	const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
	manifest.files[0].file = "../outside.gguf";
	await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
	await expect(verifyBundledAi(root, new AbortController().signal)).rejects.toThrow("manifest");
	manifest.files[0].file = "model.gguf";
	await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
	await rm(path.join(root, "vision.gguf"));
	await expect(verifyBundledAi(root, new AbortController().signal)).rejects.toThrow();
});
