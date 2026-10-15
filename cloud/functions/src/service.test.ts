// State-transition contract tests with an in-memory transport. These do NOT
// validate Firestore retry/isolation semantics or replace the Rules emulator suite.
import test from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { StudioService } from "./service.js";

type Data = Record<string, unknown>;
class Reference {
	readonly id: string;
	constructor(
		readonly db: MemoryDatabase,
		readonly path: string,
	) {
		this.id = path.split("/").at(-1)!;
	}
	collection(name: string) {
		return new MemoryCollection(this.db, `${this.path}/${name}`);
	}
	async get() {
		return this.db.snapshot(this);
	}
}
class MemoryCollection {
	constructor(
		readonly db: MemoryDatabase,
		readonly path: string,
	) {}
	doc(name = `generated-${++this.db.nextId}`) {
		return new Reference(this.db, `${this.path}/${name}`);
	}
}
class MemoryTransaction {
	private writes: (() => void)[] = [];
	constructor(readonly db: MemoryDatabase) {}
	async get(ref: Reference) {
		assert.equal(this.writes.length, 0, "all transaction reads must precede writes");
		return this.db.snapshot(ref);
	}
	create(ref: Reference, value: Data) {
		this.writes.push(() => {
			assert(!this.db.data.has(ref.path));
			this.db.data.set(ref.path, value);
		});
	}
	set(ref: Reference, value: Data, options?: { merge: boolean }) {
		this.writes.push(() =>
			this.db.data.set(ref.path, {
				...(options?.merge ? this.db.data.get(ref.path) : {}),
				...value,
			}),
		);
	}
	update(ref: Reference, value: Data) {
		this.writes.push(() => {
			assert(this.db.data.has(ref.path));
			this.db.data.set(ref.path, { ...this.db.data.get(ref.path), ...value });
		});
	}
	commit() {
		for (const write of this.writes) write();
	}
}
class MemoryDatabase {
	data = new Map<string, Data>();
	nextId = 0;
	transactions = 0;
	beforeTransaction?: (count: number) => void;
	collection(name: string) {
		return new MemoryCollection(this, name);
	}
	doc(path: string) {
		return new Reference(this, path);
	}
	snapshot(ref: Reference) {
		const value = this.data.get(ref.path);
		return { ref, exists: value !== undefined, data: () => (value ? { ...value } : undefined) };
	}
	async runTransaction<T>(fn: (transaction: MemoryTransaction) => Promise<T>) {
		this.beforeTransaction?.(++this.transactions);
		const tx = new MemoryTransaction(this),
			result = await fn(tx);
		tx.commit();
		return result;
	}
}
function setup() {
	const db = new MemoryDatabase();
	db.data.set("workspaces/a/members/alice", { role: "owner", active: true });
	db.data.set("workspaces/a/videos/video", {
		workspaceId: "a",
		status: "ready",
		consent: { cloudProcessing: true, gemini: true, sensitivityReviewed: true },
	});
	return { db, service: new StudioService(db as unknown as Firestore) };
}
test("rejecting incomplete stock metadata persists a negative rights decision", async () => {
	const { db, service } = setup();
	db.data.set("workspaces/a/brollSuggestions/stock", { workspaceId: "a" });
	await service.approveAsset("a", "alice", { suggestionId: "stock", approved: false });
	const decision = db.data.get("workspaces/a/assetApprovals/stock")!;
	assert.equal(decision.approved, false);
	assert.equal(decision.licenseReviewed, false);
	assert.equal(decision.usageRightsConfirmed, false);
	await assert.rejects(
		service.approveAsset("a", "alice", {
			suggestionId: "stock",
			approved: true,
			licenseReviewed: true,
			usageRightsConfirmed: true,
		}),
		/Unsupported stock provider/,
	);
	assert.equal(db.data.get("workspaces/a/assetApprovals/stock")?.revision, 1);
});
test("a forged provenance URL cannot become approved", async () => {
	const { db, service } = setup();
	db.data.set("workspaces/a/brollSuggestions/stock", {
		workspaceId: "a",
		provider: "pexels",
		providerAssetId: "1",
		sourceUrl: "https://pexels.com.evil.invalid/video/1",
		licenseUrl: "https://www.pexels.com/license/",
		termsVersion: "test",
	});
	await assert.rejects(
		service.approveAsset("a", "alice", {
			suggestionId: "stock",
			approved: true,
			licenseReviewed: true,
			usageRightsConfirmed: true,
		}),
		/provenance/,
	);
	assert(!db.data.has("workspaces/a/assetApprovals/stock"));
});
test("cancel leaves foreign pipeline documents and their accounting unchanged", async () => {
	const { db, service } = setup();
	const original = {
		workspaceId: "a",
		pipeline: "unrelated-product",
		kind: "render",
		status: "queued",
		quotaPath: "unrelated/quota",
		reservedUnits: 999,
	};
	db.data.set("workspaces/a/exportJobs/foreign", original);
	await assert.rejects(service.cancelJob("a", "alice", "foreign"), /CPU Mix pipeline/);
	assert.deepEqual(db.data.get("workspaces/a/exportJobs/foreign"), original);
	assert(!db.data.has("workspaces/a/aiUsageRecords/foreign"));
});
test("membership revoked after initial authorization blocks the committing write", async () => {
	const { db, service } = setup();
	db.beforeTransaction = (count) => {
		// First transaction is the rate counter; second is the project mutation.
		if (count === 2)
			db.data.set("workspaces/a/members/alice", { role: "owner", active: false });
	};
	await assert.rejects(service.createMix("a", "alice", "Project"), /access denied/);
	assert(![...db.data.keys()].some((key) => key.startsWith("workspaces/a/aiMixProjects/")));
});
test("latest analysis wins and replaying an older request cannot steal its pointer", async () => {
	const { db, service } = setup();
	const first = await service.queueJob(
		"a",
		"alice",
		{ requestId: "first", videoId: "video" },
		"analyze",
	);
	const second = await service.queueJob(
		"a",
		"alice",
		{ requestId: "second", videoId: "video" },
		"analyze",
	);
	await service.queueJob("a", "alice", { requestId: "first", videoId: "video" }, "analyze");
	assert.notEqual(first.jobId, second.jobId);
	assert.equal(db.data.get("workspaces/a/videos/video")?.analysisJobId, second.jobId);
	await service.cancelJob("a", "alice", first.jobId);
	const quotaPath = db.data.get(`workspaces/a/exportJobs/${first.jobId}`)!.quotaPath;
	assert(typeof quotaPath === "string");
	assert.equal(db.data.get(quotaPath)?.reserved, 10);
	await service.cancelJob("a", "alice", first.jobId);
	assert.equal(db.data.get(quotaPath)?.reserved, 10);
});
test("saved timeline metadata passes render validation while desktop effects fail explicitly", async () => {
	const { db, service } = setup();
	const { projectId } = await service.createMix("a", "alice", "Demo");
	const timeline = {
		width: 1280,
		height: 720,
		fps: 30,
		clips: [{ assetType: "original", assetId: "video", startMs: 0, endMs: 1000 }],
	};
	await assert.rejects(
		service.saveTimeline("a", "alice", {
			projectId,
			requestId: "bad",
			expectedVersion: null,
			timeline: { ...timeline, zoomRegions: [] },
		}),
		/Unsupported timeline fields/,
	);
	const { versionId } = await service.saveTimeline("a", "alice", {
		projectId,
		requestId: "good",
		expectedVersion: null,
		timeline,
	});
	const { jobId } = await service.queueJob(
		"a",
		"alice",
		{ requestId: "render", versionId },
		"render",
	);
	assert.equal(db.data.get(`workspaces/a/exportJobs/${jobId}`)?.pipeline, "cpu-mix-v1");
	const clips = db.data.get(`workspaces/a/timelineVersions/${versionId}`)?.clips;
	assert(Array.isArray(clips));
	assert.equal(clips.length, 1);
});
