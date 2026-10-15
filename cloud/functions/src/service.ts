import { FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import {
	check,
	assetDecision,
	assertStudioJob,
	consent,
	DomainError,
	EMBEDDING_DIMENSIONS,
	EMBEDDING_MODEL,
	id,
	keywords,
	MAX_VIDEO_BYTES,
	stableId,
	text,
	timeline,
	STUDIO_PIPELINE,
	providerPage,
} from "./domain.js";
const roles = ["viewer", "editor", "owner"];
export class StudioService {
	constructor(public db: Firestore) {}
	workspace(ws: string) {
		return this.db.collection("workspaces").doc(id(ws));
	}
	async member(ws: string, uid: string, edit = false) {
		const snapshot = await this.workspace(ws).collection("members").doc(uid).get();
		const data = snapshot.data();
		this.authorizeMember(data, edit);
		return data;
	}
	private authorizeMember(data: FirebaseFirestore.DocumentData | undefined, edit: boolean) {
		if (
			!data ||
			data.active !== true ||
			!roles.includes(data.role) ||
			(edit && data.role === "viewer")
		)
			throw new DomainError("permission-denied", "Workspace access denied");
	}
	private async transactionMember(tx: Transaction, ws: string, uid: string, edit = true) {
		// The transaction retries if membership is revoked before a write commits.
		this.authorizeMember(
			(await tx.get(this.workspace(ws).collection("members").doc(uid))).data(),
			edit,
		);
	}
	async rate(ws: string, uid: string) {
		const minute = Math.floor(Date.now() / 60000),
			ref = this.workspace(ws)
				.collection("_rateLimits")
				.doc(stableId(uid, String(minute)));
		await this.db.runTransaction(async (tx) => {
			const old = await tx.get(ref);
			if ((old.data()?.count ?? 0) >= 30)
				throw new DomainError("resource-exhausted", "30 requests per minute exceeded");
			tx.set(ref, {
				count: (old.data()?.count ?? 0) + 1,
				uid,
				expiresAt: Timestamp.fromMillis((minute + 2) * 60000),
			});
		});
	}
	audit(tx: Transaction, ws: string, uid: string, action: string, target: string) {
		tx.create(this.workspace(ws).collection("auditLogs").doc(), {
			uid,
			action,
			target,
			createdAt: FieldValue.serverTimestamp(),
		});
	}
	async createWorkspace(uid: string, name: unknown) {
		const ws = stableId(uid, "personal-workspace"),
			ref = this.workspace(ws),
			label = text(name, 80);
		await this.rate(ws, uid);
		await this.db.runTransaction(async (tx) => {
			if ((await tx.get(ref)).exists) return;
			tx.create(ref, {
				name: label,
				createdBy: uid,
				createdAt: FieldValue.serverTimestamp(),
				schemaVersion: 1,
			});
			tx.create(ref.collection("members").doc(uid), {
				role: "owner",
				active: true,
				joinedAt: FieldValue.serverTimestamp(),
			});
			tx.set(
				this.db.collection("users").doc(uid),
				{
					createdAt: FieldValue.serverTimestamp(),
					workspaceIds: FieldValue.arrayUnion(ws),
				},
				{ merge: true },
			);
			this.audit(tx, ws, uid, "workspace.created", ws);
		});
		return { workspaceId: ws };
	}
	async createVideo(ws: string, uid: string, input: Record<string, unknown>) {
		await this.member(ws, uid, true);
		await this.rate(ws, uid);
		const requestId = id(input.requestId),
			name = text(input.name, 160),
			sizeBytes = input.sizeBytes;
		check(
			Number.isSafeInteger(sizeBytes) &&
				Number(sizeBytes) > 0 &&
				Number(sizeBytes) <= MAX_VIDEO_BYTES,
			"Video must be 1..500 MiB",
		);
		check(
			typeof input.contentType === "string" &&
				["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"].includes(
					String(input.contentType),
				),
			"Unsupported content type",
		);
		const allowed = consent(input.consent);
		const videoId = stableId(uid, requestId),
			ref = this.workspace(ws).collection("videos").doc(videoId),
			storagePath = `workspaces/${ws}/originals/${videoId}/source`;
		const uploadQuota = this.workspace(ws)
			.collection("_uploadQuotas")
			.doc(stableId(uid, new Date().toISOString().slice(0, 10)));
		const fingerprint = stableId(name, String(sizeBytes), String(input.contentType));
		await this.db.runTransaction(async (tx) => {
			await this.transactionMember(tx, ws, uid);
			const [old, budget] = await Promise.all([tx.get(ref), tx.get(uploadQuota)]);
			if (old.exists) {
				check(
					old.data()?.fingerprint === fingerprint,
					"Request ID reused with different upload",
				);
				return;
			}
			if ((budget.data()?.bytes ?? 0) + Number(sizeBytes) > 2 * 1024 ** 3)
				throw new DomainError("resource-exhausted", "Daily upload allowance exceeded");
			tx.set(uploadQuota, {
				uid,
				bytes: (budget.data()?.bytes ?? 0) + Number(sizeBytes),
				expiresAt: Timestamp.fromMillis(Date.now() + 3 * 86400000),
			});
			tx.create(ref, {
				name,
				sizeBytes,
				contentType: input.contentType,
				createdBy: uid,
				workspaceId: ws,
				status: "uploading",
				storagePath,
				fingerprint,
				consent: {
					...allowed,
					disclosureVersion: "cloud-analysis-v1",
					receivedAt: Timestamp.now(),
				},
				createdAt: FieldValue.serverTimestamp(),
			});
			this.audit(tx, ws, uid, "video.upload-authorized", videoId);
		});
		return { videoId, storagePath, maxBytes: MAX_VIDEO_BYTES };
	}
	async createMix(ws: string, uid: string, name: unknown) {
		await this.member(ws, uid, true);
		await this.rate(ws, uid);
		const ref = this.workspace(ws).collection("aiMixProjects").doc();
		await this.db.runTransaction(async (tx) => {
			await this.transactionMember(tx, ws, uid);
			tx.create(ref, {
				name: text(name, 100),
				createdBy: uid,
				workspaceId: ws,
				currentVersion: null,
				createdAt: FieldValue.serverTimestamp(),
			});
			this.audit(tx, ws, uid, "mix.created", ref.id);
		});
		return { projectId: ref.id };
	}
	async approveAsset(ws: string, uid: string, input: Record<string, unknown>) {
		await this.member(ws, uid, true);
		await this.rate(ws, uid);
		const suggestionId = id(input.suggestionId);
		const decision = assetDecision(input);
		const root = this.workspace(ws),
			suggestion = root.collection("brollSuggestions").doc(suggestionId),
			ref = root.collection("assetApprovals").doc(suggestionId);
		await this.db.runTransaction(async (tx) => {
			await this.transactionMember(tx, ws, uid);
			const [candidate, previous] = await Promise.all([tx.get(suggestion), tx.get(ref)]);
			const asset = candidate.data();
			check(asset && asset.workspaceId === ws, "Suggestion not found");
			if (decision.approved) {
				check(
					asset.provider === "pexels" || asset.provider === "pixabay",
					"Unsupported stock provider",
				);
				check(
					typeof asset.licenseUrl === "string" &&
						typeof asset.sourceUrl === "string" &&
						providerPage(asset.provider, asset.licenseUrl) &&
						providerPage(asset.provider, asset.sourceUrl),
					"Missing or invalid asset provenance",
				);
				text(asset.providerAssetId, 100);
				text(asset.termsVersion, 100);
			}
			// An incomplete/unlicensed suggestion can always be rejected. Never invent a positive rights attestation.
			const provenance = Object.fromEntries(
				["licenseUrl", "sourceUrl", "provider", "providerAssetId", "termsVersion"].map(
					(key) => [key, typeof asset[key] === "string" ? asset[key] : null],
				),
			);
			const revision = (previous.data()?.revision ?? 0) + 1;
			tx.set(ref, {
				workspaceId: ws,
				suggestionId,
				...decision,
				approvedBy: uid,
				...provenance,
				revision,
				decidedAt: FieldValue.serverTimestamp(),
			});
			this.audit(
				tx,
				ws,
				uid,
				input.approved ? "asset.approved" : "asset.rejected",
				suggestionId,
			);
		});
		return { suggestionId, approved: input.approved };
	}
	async saveTimeline(ws: string, uid: string, input: Record<string, unknown>) {
		await this.member(ws, uid, true);
		await this.rate(ws, uid);
		const projectId = id(input.projectId),
			requestId = id(input.requestId),
			value = timeline(input.timeline);
		check(
			input.expectedVersion === null || typeof input.expectedVersion === "string",
			"Expected version is required",
		);
		if (input.expectedVersion !== null) id(input.expectedVersion);
		const versionId = stableId(projectId, uid, requestId),
			root = this.workspace(ws),
			project = root.collection("aiMixProjects").doc(projectId),
			version = root.collection("timelineVersions").doc(versionId);
		const fingerprint = stableId(JSON.stringify(value));
		await this.db.runTransaction(async (tx) => {
			await this.transactionMember(tx, ws, uid);
			const [p, v] = await Promise.all([tx.get(project), tx.get(version)]);
			check(p.exists, "Mix project missing");
			if (v.exists) {
				check(
					v.data()?.fingerprint === fingerprint,
					"Request ID reused for another timeline",
				);
				return;
			}
			if (p.data()?.currentVersion !== input.expectedVersion)
				throw new DomainError("aborted", "Timeline changed; reload before saving");
			const assets = await Promise.all(
				value.clips.map((clip) =>
					tx.get(
						root
							.collection(clip.assetType === "broll" ? "assetApprovals" : "videos")
							.doc(clip.assetId),
					),
				),
			);
			assets.forEach((snapshot, i) => {
				const data = snapshot.data();
				check(data && data.workspaceId === ws, "Asset outside workspace or missing");
				if (value.clips[i].assetType === "broll")
					check(
						data.approved === true &&
							data.licenseReviewed === true &&
							data.usageRightsConfirmed === true,
						"B-roll requires current approval",
					);
				else check(data.status === "ready", "Original video must finish analysis");
			});
			tx.create(version, {
				workspaceId: ws,
				projectId,
				createdBy: uid,
				createdAt: FieldValue.serverTimestamp(),
				fingerprint,
				...value,
			});
			tx.update(project, {
				currentVersion: versionId,
				updatedAt: FieldValue.serverTimestamp(),
			});
			this.audit(tx, ws, uid, "timeline.version-created", versionId);
		});
		return { versionId };
	}
	async queueJob(
		ws: string,
		uid: string,
		input: Record<string, unknown>,
		kind: "analyze" | "render",
	) {
		await this.member(ws, uid, true);
		await this.rate(ws, uid);
		const requestId = id(input.requestId),
			targetId = id(kind === "render" ? input.versionId : input.videoId),
			root = this.workspace(ws),
			jobId = stableId(ws, uid, kind, requestId),
			ref = root.collection("exportJobs").doc(jobId);
		const daily = root
				.collection("_quotas")
				.doc(stableId(uid, new Date().toISOString().slice(0, 10))),
			units = kind === "analyze" ? 10 : 5;
		await this.db.runTransaction(async (tx) => {
			await this.transactionMember(tx, ws, uid);
			const [existing, budget, target] = await Promise.all([
				tx.get(ref),
				tx.get(daily),
				tx.get(
					root
						.collection(kind === "render" ? "timelineVersions" : "videos")
						.doc(targetId),
				),
			]);
			if (existing.exists) {
				assertStudioJob(existing.data(), ws);
				check(
					existing.data()?.targetId === targetId && existing.data()?.kind === kind,
					"Idempotency key reused",
				);
				return;
			}
			check(target.exists && target.data()?.workspaceId === ws, "Job target missing");
			if (kind === "analyze")
				check(
					target.data()?.consent?.cloudProcessing === true &&
						target.data()?.consent?.sensitivityReviewed === true &&
						target.data()?.consent?.gemini === true &&
						["uploading", "ready", "failed"].includes(target.data()?.status),
					"Cloud consent missing",
				);
			if ((budget.data()?.reserved ?? 0) + units > 100)
				throw new DomainError("resource-exhausted", "Daily processing quota exceeded");
			if (kind === "render") {
				const value = timeline(target.data(), true);
				const approvals = await Promise.all(
					value.clips
						.filter((c) => c.assetType === "broll")
						.map((c) => tx.get(root.collection("assetApprovals").doc(c.assetId))),
				);
				check(
					approvals.every(
						(a) =>
							a.data()?.approved === true &&
							a.data()?.licenseReviewed === true &&
							a.data()?.usageRightsConfirmed === true,
					),
					"An asset approval was revoked",
				);
			}
			tx.set(daily, {
				uid,
				reserved: (budget.data()?.reserved ?? 0) + units,
				expiresAt: Timestamp.fromMillis(Date.now() + 3 * 86400000),
			});
			tx.create(ref, {
				workspaceId: ws,
				createdBy: uid,
				kind,
				pipeline: STUDIO_PIPELINE,
				targetId,
				status: "queued",
				attempts: 0,
				cancelRequested: false,
				reservedUnits: units,
				quotaPath: daily.path,
				createdAt: FieldValue.serverTimestamp(),
			});
			if (kind === "analyze") tx.update(target.ref, { analysisJobId: jobId });
			tx.create(root.collection("aiUsageRecords").doc(jobId), {
				uid,
				jobId,
				workspaceId: ws,
				kind,
				reservedUnits: units,
				status: "reserved",
				actualCostUsd: null,
				estimatedCostUsd: null,
				costStatus: "unpriced",
				createdAt: FieldValue.serverTimestamp(),
			});
			this.audit(tx, ws, uid, "job.queued", jobId);
		});
		return { jobId };
	}
	async cancelJob(ws: string, uid: string, jobId: string) {
		await this.member(ws, uid, true);
		await this.rate(ws, uid);
		const root = this.workspace(ws),
			ref = root.collection("exportJobs").doc(id(jobId));
		await this.db.runTransaction(async (tx) => {
			await this.transactionMember(tx, ws, uid);
			const job = await tx.get(ref);
			assertStudioJob(job.data(), ws);
			if (["succeeded", "failed", "canceled"].includes(job.data()?.status)) return;
			if (job.data()?.status === "queued") {
				const data = job.data()!,
					quota = this.db.doc(data.quotaPath);
				const budget = await tx.get(quota);
				tx.update(quota, {
					reserved: Math.max(0, (budget.data()?.reserved ?? 0) - data.reservedUnits),
				});
				tx.update(ref, {
					cancelRequested: true,
					status: "canceled",
					updatedAt: FieldValue.serverTimestamp(),
				});
				tx.set(
					root.collection("aiUsageRecords").doc(jobId),
					{
						status: "canceled",
						settled: true,
						refundedUnits: data.reservedUnits,
						updatedAt: FieldValue.serverTimestamp(),
					},
					{ merge: true },
				);
			} else tx.update(ref, { cancelRequested: true });
			this.audit(tx, ws, uid, "job.cancel-requested", jobId);
		});
		return { jobId };
	}
	async expireJob(ref: FirebaseFirestore.DocumentReference, cutoff: Timestamp) {
		return this.db.runTransaction(async (tx) => {
			const snapshot = await tx.get(ref),
				job = snapshot.data();
			if (
				!job ||
				job.pipeline !== "cpu-mix-v1" ||
				!["queued", "processing"].includes(job.status) ||
				job.createdAt.toMillis() >= cutoff.toMillis() ||
				(job.leaseUntil?.toMillis() ?? 0) > Date.now()
			)
				return false;
			const quota = this.db.doc(job.quotaPath),
				budget = await tx.get(quota);
			tx.update(quota, {
				reserved: Math.max(0, (budget.data()?.reserved ?? 0) - job.reservedUnits),
			});
			tx.update(ref, {
				status: job.cancelRequested ? "canceled" : "failed",
				errorCode: "dispatch-expired",
				updatedAt: FieldValue.serverTimestamp(),
			});
			tx.set(
				this.workspace(job.workspaceId).collection("aiUsageRecords").doc(ref.id),
				{
					status: job.cancelRequested ? "canceled" : "failed",
					settled: true,
					refundedUnits: job.reservedUnits,
					updatedAt: FieldValue.serverTimestamp(),
				},
				{ merge: true },
			);
			this.audit(tx, job.workspaceId, job.createdBy, "job.dispatch-expired", ref.id);
			return true;
		});
	}
	async reserveProvider(
		ws: string,
		uid: string,
		requestId: string,
		fingerprint: string,
		provider: string,
		model: string,
	) {
		const root = this.workspace(ws),
			usage = root.collection("aiUsageRecords").doc(stableId(ws, uid, provider, requestId)),
			quota = root
				.collection("_quotas")
				.doc(stableId(uid, new Date().toISOString().slice(0, 10)));
		const cached = await this.db.runTransaction(async (tx) => {
			await this.transactionMember(tx, ws, uid, false);
			const [old, budget] = await Promise.all([tx.get(usage), tx.get(quota)]);
			if (old.exists) {
				check(old.data()?.fingerprint === fingerprint, "Provider request ID reused");
				if (old.data()?.status === "completed") return old.data()?.result;
				throw new DomainError("already-exists", "Provider request is already reserved");
			}
			if ((budget.data()?.reserved ?? 0) + 1 > 100)
				throw new DomainError("resource-exhausted", "Daily AI quota exceeded");
			tx.set(quota, {
				uid,
				reserved: (budget.data()?.reserved ?? 0) + 1,
				expiresAt: Timestamp.fromMillis(Date.now() + 3 * 86400000),
			});
			tx.create(usage, {
				uid,
				workspaceId: ws,
				provider,
				model,
				fingerprint,
				reservedUnits: 1,
				quotaPath: quota.path,
				status: "reserved",
				actualCostUsd: null,
				estimatedCostUsd: null,
				costStatus: "unpriced",
				createdAt: FieldValue.serverTimestamp(),
			});
		});
		return { usage, cached };
	}
	async visibleResults(ws: string, documents: FirebaseFirestore.QueryDocumentSnapshot[]) {
		const ids = [...new Set(documents.map((doc) => doc.data().videoId))];
		const snapshots = await Promise.all(
			ids.map((video) => this.workspace(ws).collection("videos").doc(id(video)).get()),
		);
		const current = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.data()]));
		return documents.filter((doc) => {
			const video = current.get(doc.data().videoId);
			return video?.status === "ready" && video.analysisKey === doc.data().analysisKey;
		});
	}
	async keywordSearch(ws: string, uid: string, query: unknown) {
		await this.member(ws, uid);
		await this.rate(ws, uid);
		const tokens = keywords(text(query, 300)).slice(0, 5);
		if (!tokens.length) return [];
		const results = await this.workspace(ws)
			.collection("videoEmbeddings")
			.where("workspaceId", "==", ws)
			.where("keywords", "array-contains-any", tokens)
			.limit(20)
			.get();
		const ready = await this.visibleResults(ws, results.docs);
		return ready.map((doc) => ({
			id: doc.id,
			text: doc.data().text,
			videoId: doc.data().videoId,
			startMs: doc.data().startMs,
			endMs: doc.data().endMs,
		}));
	}
	async semanticSearch(
		ws: string,
		uid: string,
		query: unknown,
		embed: (value: string) => Promise<number[]>,
	) {
		await this.member(ws, uid);
		await this.rate(ws, uid);
		const vector = await embed(text(query, 300));
		check(
			vector.length === EMBEDDING_DIMENSIONS &&
				vector.every(Number.isFinite) &&
				vector.some((n) => n !== 0),
			"Embedding dimension mismatch",
		);
		const result = await this.workspace(ws)
			.collection("videoEmbeddings")
			.where("workspaceId", "==", ws)
			.where("model", "==", EMBEDDING_MODEL)
			.findNearest({
				vectorField: "embedding",
				queryVector: FieldValue.vector(vector),
				limit: 10,
				distanceMeasure: "COSINE",
				distanceResultField: "distance",
			})
			.get();
		const ready = await this.visibleResults(ws, result.docs);
		return ready.map((doc) => ({
			id: doc.id,
			text: doc.data().text,
			videoId: doc.data().videoId,
			startMs: doc.data().startMs,
			endMs: doc.data().endMs,
			distance: doc.data().distance,
		}));
	}
}
