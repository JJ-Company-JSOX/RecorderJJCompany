import test from "node:test";
import assert from "node:assert/strict";
import {
	assetDecision,
	assertStudioJob,
	dispatchPayload,
	DomainError,
	consent,
	id,
	keywords,
	providerPage,
	stableId,
	timeline,
} from "./domain.js";
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
test("unsupported desktop effects cannot disappear from CPU timeline saves", () => {
	const clip = { assetType: "original", assetId: "video", startMs: 0, endMs: 1000 };
	const value = { width: 1280, height: 720, fps: 30, clips: [clip] };
	for (const extra of [{ zoomRegions: [] }, { audioTracks: [] }, { background: "blue" }]) {
		assert.throws(() => timeline({ ...value, ...extra }), /Unsupported timeline fields/);
	}
	for (const extra of [{ speed: 2 }, { zoom: 1.5 }, { sourceUrl: "https://example.invalid/" }]) {
		assert.throws(
			() => timeline({ ...value, clips: [{ ...clip, ...extra }] }),
			/Unsupported clip fields/,
		);
	}
});
test("malformed clip entries return domain errors instead of internal exceptions", () => {
	for (const clip of [null, [], "video", 5]) {
		assert.throws(
			() => timeline({ width: 1280, height: 720, fps: 30, clips: [clip] }),
			DomainError,
		);
	}
});
test("stored versions allow only known metadata and preserve the same strict clip contract", () => {
	const value = {
		width: 1280,
		height: 720,
		fps: 30,
		clips: [{ assetType: "original", assetId: "video", startMs: 0, endMs: 1000 }],
		workspaceId: "a",
		projectId: "p",
		createdBy: "alice",
		fingerprint: "hash",
		createdAt: {},
	};
	assert.equal(timeline(value, true).clips.length, 1);
	assert.throws(() => timeline(value), /Unsupported timeline fields/);
	assert.throws(
		() => timeline({ ...value, transitions: [] }, true),
		/Unsupported timeline fields/,
	);
});
test("customers can reject unlicensed assets without affirming rights", () => {
	assert.deepEqual(assetDecision({ approved: false }), {
		approved: false,
		licenseReviewed: false,
		usageRightsConfirmed: false,
	});
	assert.deepEqual(
		assetDecision({ approved: true, licenseReviewed: true, usageRightsConfirmed: true }),
		{ approved: true, licenseReviewed: true, usageRightsConfirmed: true },
	);
	assert.throws(() => assetDecision({ approved: true }), /Review the license/);
	assert.throws(() => assetDecision({ approved: "false" }), /explicit decision/);
});
test("outbox ignores foreign pipelines and settled jobs in an existing collection", () => {
	const job = {
		pipeline: "cpu-mix-v1",
		status: "queued",
		workspaceId: "a",
		kind: "analyze",
		targetId: "video",
	};
	assert.deepEqual(dispatchPayload("a", "job", job), { workspaceId: "a", jobId: "job" });
	assert.equal(dispatchPayload("a", "job", { ...job, pipeline: "other-product" }), null);
	assert.equal(dispatchPayload("a", "job", { ...job, status: "succeeded" }), null);
	assert.throws(() => dispatchPayload("b", "job", job), /workspace/);
	assert.throws(() => dispatchPayload("a", "job", { ...job, kind: "unknown" }), /job kind/);
	assert.throws(
		() => dispatchPayload("a", "job", { ...job, targetId: "../other" }),
		/identifier/,
	);
});
test("cancel and download guards refuse another pipeline even in the same workspace", () => {
	assert.throws(
		() => assertStudioJob({ workspaceId: "a", pipeline: "other", kind: "render" }, "a"),
		/CPU Mix pipeline/,
	);
	assert.throws(
		() => assertStudioJob({ workspaceId: "b", pipeline: "cpu-mix-v1", kind: "render" }, "a"),
		/workspace/,
	);
});
