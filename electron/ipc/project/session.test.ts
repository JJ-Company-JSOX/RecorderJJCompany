import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLinkedWebcamPath } from "./session";

vi.mock("electron", () => ({
	app: { getPath: () => os.tmpdir() },
}));

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), "recordly-session-"));
	roots.push(root);
	return root;
}

describe("resolveLinkedWebcamPath (parallel existence checks)", () => {
	it("returns null when no companion webcam file exists", async () => {
		const root = await fixture();
		const videoPath = path.join(root, "clip.mp4");
		await writeFile(videoPath, "video");
		expect(await resolveLinkedWebcamPath(videoPath)).toBeNull();
	});
	it("prefers the source video's own extension when it exists alongside other candidates", async () => {
		const root = await fixture();
		const videoPath = path.join(root, "clip.mp4");
		await writeFile(videoPath, "video");
		await writeFile(path.join(root, "clip-webcam.mp4"), "webcam-mp4");
		await writeFile(path.join(root, "clip-webcam.mkv"), "webcam-mkv");
		expect(await resolveLinkedWebcamPath(videoPath)).toBe(path.join(root, "clip-webcam.mp4"));
	});
	it("skips missing higher-priority candidates and still picks the earliest existing one", async () => {
		const root = await fixture();
		// .flv is not one of the hardcoded fallback extensions, so none of the source
		// extension, .webm or .mp4 candidates exist; only .mov and .mkv do, and .mov
		// precedes .mkv in the fallback list.
		const videoPath = path.join(root, "clip.flv");
		await writeFile(videoPath, "video");
		await writeFile(path.join(root, "clip-webcam.mov"), "webcam-mov");
		await writeFile(path.join(root, "clip-webcam.mkv"), "webcam-mkv");
		expect(await resolveLinkedWebcamPath(videoPath)).toBe(path.join(root, "clip-webcam.mov"));
	});
	it("does not look up a companion for a file that is itself a webcam recording", async () => {
		const root = await fixture();
		const videoPath = path.join(root, "clip-webcam.mp4");
		await writeFile(videoPath, "video");
		await writeFile(path.join(root, "clip-webcam-webcam.mp4"), "unrelated");
		expect(await resolveLinkedWebcamPath(videoPath)).toBeNull();
	});
});
