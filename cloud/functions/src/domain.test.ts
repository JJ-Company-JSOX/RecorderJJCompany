import test from "node:test";
import assert from "node:assert/strict";
import { consent, id, keywords, providerPage, stableId, timeline } from "./domain.js";
test("IDs and tenant-bound idempotency reject paths and separate workspaces", () => {
	assert.throws(() => id("../other"));
	assert.throws(() => id("a/b"));
	assert.notEqual(stableId("ws-a", "uid", "job"), stableId("ws-b", "uid", "job"));
});
test("explicit cloud and sensitive-information confirmation is required", () => {
	assert.throws(() => consent({ cloudProcessing: true, gemini: true }));
	assert.equal(
		consent({ cloudProcessing: true, gemini: true, sensitivityReviewed: true }).gemini,
		true,
	);
});
test("bounded keyword tokens support Chinese and Malay without promising full text", () => {
	assert(keywords("Open Settings 保存视频 Tetapan rangkaian").includes("rangkaian"));
	assert(keywords("保存视频").includes("保存"));
	assert.equal(keywords("a ".repeat(500)).length, 1);
});
test("timeline accepts local asset references and rejects arbitrary URLs or huge renders", () => {
	const value = {
		width: 1280,
		height: 720,
		fps: 30,
		clips: [{ assetType: "original", assetId: "video", startMs: 0, endMs: 1000 }],
	};
	assert.equal(timeline(value).clips.length, 1);
	assert.throws(() =>
		timeline({ ...value, clips: [{ ...value.clips[0], assetId: "https://other/a" }] }),
	);
	assert.throws(() => timeline({ ...value, clips: [{ ...value.clips[0], endMs: 600001 }] }));
});
test("stock attribution pages must belong to the declared provider", () => {
	assert(providerPage("pexels", "https://www.pexels.com/video/123/"));
	assert(!providerPage("pexels", "https://pexels.com.evil.invalid/x"));
	assert(!providerPage("pixabay", "http://pixabay.com/x"));
});
