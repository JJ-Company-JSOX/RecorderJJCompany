import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
	initializeTestEnvironment,
	assertFails,
	assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";
import { ref, uploadBytes, getBytes } from "firebase/storage";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { StudioService } from "../lib/service.js";
let environment, adminApp, db, service;
const projectId = "demo-jsox";
before(async () => {
	for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) {
		assert.match(
			process.env[key] ?? "",
			/^(127\.0\.0\.1|localhost):[0-9]+$/,
			"Local emulator required; refusing a real cloud connection",
		);
	}

	environment = await initializeTestEnvironment({
		projectId,
		firestore: {
			rules: await readFile(new URL("../../firestore.rules", import.meta.url), "utf8"),
		},
		storage: { rules: await readFile(new URL("../../storage.rules", import.meta.url), "utf8") },
	});
	adminApp = initializeApp({ projectId }, "jsox-tests");
	db = getFirestore(adminApp);
	service = new StudioService(db);
	await db.doc("workspaces/a").set({ name: "A" });
	await db.doc("workspaces/b").set({ name: "B" });
	await db.doc("workspaces/a/members/alice").set({ role: "owner", active: true });
	await db.doc("workspaces/a/members/viewer").set({ role: "viewer", active: true });
	await db.doc("workspaces/b/members/bob").set({ role: "owner", active: true });
	await db
		.doc("workspaces/a/videos/video")
		.set({ workspaceId: "a", createdBy: "alice", status: "ready", analysisKey: "one" });
});
after(async () => {
	await environment?.cleanup();
	if (adminApp) await deleteApp(adminApp);
});
test("Firestore rules isolate workspaces, reject anonymous reads and protect server-owned states", async () => {
	const alice = environment.authenticatedContext("alice").firestore(),
		bob = environment.authenticatedContext("bob").firestore(),
		guest = environment.unauthenticatedContext().firestore();
	await assertSucceeds(getDoc(doc(alice, "workspaces/a/videos/video")));
	await assertFails(getDoc(doc(bob, "workspaces/a/videos/video")));
	await assertFails(getDoc(doc(guest, "workspaces/a/videos/video")));
	await assertFails(setDoc(doc(alice, "workspaces/a/assetApprovals/forged"), { approved: true }));
	await assertFails(
		setDoc(doc(alice, "workspaces/a/members/mallory"), { role: "owner", active: true }),
	);
	await assertFails(getDocs(collection(alice, "workspaces")));
});
test("Storage rules reject all direct uploads and deny direct export reads", async () => {
	const created = await service.createVideo("a", "alice", {
		requestId: "upload-1",
		name: "example.mp4",
		sizeBytes: 4,
		contentType: "video/mp4",
		consent: { cloudProcessing: true, gemini: true, sensitivityReviewed: true },
	});
	const alice = environment.authenticatedContext("alice").storage(),
		bob = environment.authenticatedContext("bob").storage();
	await assertFails(
		uploadBytes(ref(bob, created.storagePath), new Uint8Array(4), { contentType: "video/mp4" }),
	);
	await assertFails(
		uploadBytes(ref(alice, created.storagePath), new Uint8Array(5), {
			contentType: "video/mp4",
		}),
	);
	await assertFails(
		uploadBytes(ref(alice, created.storagePath), new Uint8Array(4), {
			contentType: "video/mp4",
			customMetadata: { firebaseStorageDownloadTokens: "public-token" },
		}),
	);
	await assertFails(
		uploadBytes(ref(alice, created.storagePath), new Uint8Array(4), {
			contentType: "video/mp4",
		}),
	);
	await assertFails(
		uploadBytes(ref(alice, created.storagePath), new Uint8Array(4), {
			contentType: "video/mp4",
		}),
	);
	await assertFails(getBytes(ref(alice, "workspaces/a/exports/job/export.mp4")));
	await environment.withSecurityRulesDisabled(async (context) => {
		await uploadBytes(ref(context.storage(), created.storagePath), new Uint8Array(4), {
			contentType: "video/mp4",
		});
	});
	await assertSucceeds(getBytes(ref(alice, created.storagePath)));
	await assertFails(getBytes(ref(bob, created.storagePath)));
});
test("server authorization blocks viewers and cross-tenant writes", async () => {
	await assert.rejects(service.createMix("a", "bob", "forged"), /access denied/);
	await assert.rejects(service.createMix("a", "viewer", "forged"), /access denied/);
});
test("asset approval, immutable timeline, conflict protection and render job idempotency use real transactions", async () => {
	await db.doc("workspaces/a/brollSuggestions/stock").set({
		workspaceId: "a",
		provider: "pexels",
		providerAssetId: "1",
		sourceUrl: "https://www.pexels.com/video/1/",
		licenseUrl: "https://www.pexels.com/license/",
		termsVersion: "test-policy",
	});
	const { projectId } = await service.createMix("a", "alice", "Mix");
	const value = {
		width: 1280,
		height: 720,
		fps: 30,
		clips: [{ assetType: "broll", assetId: "stock", startMs: 0, endMs: 1000 }],
	};
	await assert.rejects(
		service.saveTimeline("a", "alice", {
			projectId,
			requestId: "v1",
			expectedVersion: null,
			timeline: value,
		}),
		/missing/,
	);
	await service.approveAsset("a", "alice", {
		suggestionId: "stock",
		approved: true,
		licenseReviewed: true,
		usageRightsConfirmed: true,
	});
	const saved = await service.saveTimeline("a", "alice", {
		projectId,
		requestId: "v1",
		expectedVersion: null,
		timeline: value,
	});
	assert.deepEqual(
		await service.saveTimeline("a", "alice", {
			projectId,
			requestId: "v1",
			expectedVersion: null,
			timeline: value,
		}),
		saved,
	);
	await assert.rejects(
		service.saveTimeline("a", "alice", {
			projectId,
			requestId: "v2",
			expectedVersion: null,
			timeline: value,
		}),
		/Timeline changed/,
	);
	const jobs = await Promise.all([
		service.queueJob(
			"a",
			"alice",
			{ requestId: "render1", versionId: saved.versionId },
			"render",
		),
		service.queueJob(
			"a",
			"alice",
			{ requestId: "render1", versionId: saved.versionId },
			"render",
		),
	]);
	assert.equal(jobs[0].jobId, jobs[1].jobId);
	assert.equal((await db.collection("workspaces/a/exportJobs").get()).size, 1);
	assert.equal((await db.collection("workspaces/a/aiUsageRecords").get()).size, 1);
	await service.approveAsset("a", "alice", {
		suggestionId: "stock",
		approved: false,
		licenseReviewed: true,
		usageRightsConfirmed: true,
	});
	await assert.rejects(
		service.queueJob(
			"a",
			"alice",
			{ requestId: "render2", versionId: saved.versionId },
			"render",
		),
		/revoked/,
	);
});
test("provider operation IDs cannot reserve twice or rerun a pending paid call", async () => {
	const operation = await service.reserveProvider(
		"a",
		"alice",
		"semantic1",
		"query-hash",
		"gemini",
		"embedding",
	);
	await assert.rejects(
		service.reserveProvider("a", "alice", "semantic1", "query-hash", "gemini", "embedding"),
		/already reserved/,
	);
	await operation.usage.set({ status: "completed", result: { results: [] } }, { merge: true });
	assert.deepEqual(
		(
			await service.reserveProvider(
				"a",
				"alice",
				"semantic1",
				"query-hash",
				"gemini",
				"embedding",
			)
		).cached,
		{ results: [] },
	);
});
test("keyword search never returns another tenant or unfinished analysis generation", async () => {
	await db.doc("workspaces/a/videoEmbeddings/one").set({
		workspaceId: "a",
		videoId: "video",
		analysisKey: "one",
		keywords: ["save"],
		text: "Save",
		startMs: 0,
		endMs: 1000,
		embedding: FieldValue.vector(Array(768).fill(0.1)),
	});
	await db.doc("workspaces/a/videoEmbeddings/pending").set({
		workspaceId: "a",
		videoId: "video",
		analysisKey: "pending",
		keywords: ["save"],
		text: "not published",
		startMs: 0,
		endMs: 1000,
	});
	await db
		.doc("workspaces/b/videoEmbeddings/private")
		.set({ workspaceId: "b", videoId: "video", keywords: ["save"], text: "Bob private" });
	const results = await service.keywordSearch("a", "alice", "save");
	assert.equal(results.length, 1);
	assert.equal(results[0].text, "Save");
	await assert.rejects(service.keywordSearch("b", "alice", "save"), /access denied/);
});
