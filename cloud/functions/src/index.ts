import { FirestoreSearchEngine } from "./search.js";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret, defineString, defineBoolean } from "firebase-functions/params";
import { CloudTasksClient } from "@google-cloud/tasks";
import { StudioService } from "./service.js";
import { DomainError, check, id, stableId, text } from "./domain.js";
import { embedQuery, searchStock } from "./providers.js";
initializeApp();
const db = getFirestore(),
	service = new StudioService(db),
	search = new FirestoreSearchEngine(service);
const gemini = defineSecret("GEMINI_API_KEY"),
	pexels = defineSecret("PEXELS_API_KEY"),
	pixabay = defineSecret("PIXABAY_API_KEY");
const stockTermsReviewed = defineBoolean("STOCK_TERMS_REVIEWED", { default: false });
const region = defineString("STUDIO_REGION"),
	workerUrl = defineString("STUDIO_WORKER_URL"),
	queue = defineString("STUDIO_TASK_QUEUE"),
	workerIdentity = defineString("STUDIO_TASK_SERVICE_ACCOUNT"),
	bucketName = defineString("STUDIO_BUCKET");
function callable(
	fn: (data: Record<string, any>, uid: string) => Promise<unknown>,
	secrets: ReturnType<typeof defineSecret>[] = [],
) {
	return onCall(
		{ region, enforceAppCheck: true, secrets, maxInstances: 5, timeoutSeconds: 60 },
		async (request: CallableRequest) => {
			if (!request.auth)
				throw new HttpsError("unauthenticated", "Sign in to use cloud processing");
			try {
				check(
					request.data &&
						typeof request.data === "object" &&
						!Array.isArray(request.data),
					"Object payload required",
				);
				return await fn(request.data, request.auth.uid);
			} catch (error) {
				if (error instanceof DomainError)
					throw new HttpsError(error.code as any, error.message);
				throw new HttpsError(
					"internal",
					"Operation failed; no private provider details are returned",
				);
			}
		},
	);
}
export const createWorkspace = callable((data, uid) => service.createWorkspace(uid, data.name));
export const createVideoUpload = callable(async (data, uid) => {
	const upload = await service.createVideo(id(data.workspaceId), uid, data);
	const expiresAt = Date.now() + 15 * 60000;
	const [uploadUrl] = await getStorage()
		.bucket(bucketName.value())
		.file(upload.storagePath)
		.getSignedUrl({
			version: "v4",
			action: "write",
			expires: expiresAt,
			contentType: String(data.contentType),
			extensionHeaders: {
				"content-length": String(data.sizeBytes),
				"x-goog-if-generation-match": "0",
			},
		});
	return {
		...upload,
		uploadUrl,
		expiresAt,
		headers: { "Content-Type": data.contentType, "x-goog-if-generation-match": "0" },
	};
});
export const createMixProject = callable((data, uid) =>
	service.createMix(id(data.workspaceId), uid, data.name),
);
export const decideAsset = callable((data, uid) =>
	service.approveAsset(id(data.workspaceId), uid, data),
);
export const saveTimelineVersion = callable((data, uid) =>
	service.saveTimeline(id(data.workspaceId), uid, data),
);
export const analyzeVideo = callable(async (data, uid) => {
	const ws = id(data.workspaceId),
		videoId = id(data.videoId);
	await service.member(ws, uid, true);
	const video = (await service.workspace(ws).collection("videos").doc(videoId).get()).data();
	check(video, "Video missing");
	const [metadata] = await getStorage()
		.bucket(bucketName.value())
		.file(video.storagePath)
		.getMetadata();
	check(
		Number(metadata.size) === video.sizeBytes && metadata.contentType === video.contentType,
		"Uploaded object does not match upload slot",
	);
	return service.queueJob(ws, uid, data, "analyze");
});
export const renderMix = callable(async (data, uid) => {
	const ws = id(data.workspaceId);
	await service.member(ws, uid, true);
	const version = (
		await service.workspace(ws).collection("timelineVersions").doc(id(data.versionId)).get()
	).data();
	check(version, "Timeline missing");
	if (version.clips.some((clip: { assetType: string }) => clip.assetType === "broll"))
		check(
			stockTermsReviewed.value(),
			"Stock policy review is required before rendering B-roll",
		);
	return service.queueJob(ws, uid, data, "render");
});
export const cancelJob = callable((data, uid) =>
	service.cancelJob(id(data.workspaceId), uid, id(data.jobId)),
);
export const searchVideos = callable(
	async (data, uid) => {
		const ws = id(data.workspaceId);
		check(
			data.mode === "keyword" || data.mode === "semantic",
			"Search mode must be keyword or semantic",
		);
		if (data.mode === "keyword")
			return {
				results: await search.search({
					workspaceId: ws,
					uid,
					query: data.query,
					mode: "keyword",
				}),
			};
		check(
			data.geminiConsent === true && data.sensitivityReviewed === true,
			"Confirm Gemini query disclosure and sensitive-data review",
		);
		const query = text(data.query, 300);
		await service.member(ws, uid);
		const operation = await service.reserveProvider(
			ws,
			uid,
			id(data.requestId),
			stableId(query),
			"gemini",
			"gemini-embedding-001",
		);
		if (operation.cached) return operation.cached;
		const usage = operation.usage;
		const cache = service
			.workspace(ws)
			.collection("_queryEmbeddings")
			.doc(stableId("gemini-embedding-001", query));
		const results = await search.search({
			workspaceId: ws,
			uid,
			query,
			mode: "semantic",
			embed: async () => {
				const cached = (await cache.get()).data();
				if (cached && cached.expiresAt?.toMillis() > Date.now()) return cached.vector;
				const vector = await embedQuery(query, gemini.value());
				await cache.set({ vector, expiresAt: Timestamp.fromMillis(Date.now() + 3600000) });
				return vector;
			},
		});
		await usage.set(
			{
				status: "completed",
				inputCharacters: query.length,
				completedAt: FieldValue.serverTimestamp(),
				result: { results },
			},
			{ merge: true },
		);
		return { results };
	},
	[gemini],
);
export const findBroll = callable(
	async (data, uid) => {
		check(
			stockTermsReviewed.value(),
			"Review provider terms, attribution and cache/retention limits before enabling stock APIs",
		);
		const ws = id(data.workspaceId);
		await service.member(ws, uid, true);
		await service.rate(ws, uid);
		check(data.provider === "pexels" || data.provider === "pixabay", "Invalid stock provider");
		check(
			data.providerConsent === true && data.sensitivityReviewed === true,
			"Confirm provider disclosure and sensitive-data review",
		);
		const operation = await service.reserveProvider(
			ws,
			uid,
			id(data.requestId),
			stableId(data.provider, text(data.query, 120)),
			data.provider,
			"stock-search",
		);
		if (operation.cached) return operation.cached;
		const usage = operation.usage;
		const suggestions = await searchStock(
			data.provider,
			text(data.query, 120),
			data.provider === "pexels" ? pexels.value() : pixabay.value(),
		);
		const batch = db.batch(),
			root = service.workspace(ws);
		const output = [];
		for (const item of suggestions) {
			const suggestionId = stableId(data.provider, item.providerAssetId);
			batch.set(
				root.collection("brollSuggestions").doc(suggestionId),
				{ ...item, workspaceId: ws, updatedAt: FieldValue.serverTimestamp() },
				{ merge: true },
			);
			const { downloadUrl: _, ...publicItem } = item;
			output.push({ suggestionId, ...publicItem });
		}
		batch.set(
			usage,
			{
				status: "completed",
				inputCharacters: String(data.query).length,
				completedAt: FieldValue.serverTimestamp(),
				result: { suggestions: output },
			},
			{ merge: true },
		);
		await batch.commit();
		return { suggestions: output };
	},
	[pexels, pixabay],
);
export const getExportDownload = callable(async (data, uid) => {
	const ws = id(data.workspaceId);
	await service.member(ws, uid);
	await service.rate(ws, uid);
	const job = (
		await service.workspace(ws).collection("exportJobs").doc(id(data.jobId)).get()
	).data();
	check(
		job?.kind === "render" &&
			job.status === "succeeded" &&
			typeof job.outputPath === "string" &&
			job.outputPath.startsWith(`workspaces/${ws}/exports/`),
		"Export not available",
	);
	// Recheck every B-roll decision, even when the file was rendered earlier.
	const version = (
		await service.workspace(ws).collection("timelineVersions").doc(job.targetId).get()
	).data();
	check(version, "Timeline missing");
	for (const clip of version.clips ?? []) {
		if (clip.assetType === "broll") {
			const approval = (
				await service.workspace(ws).collection("assetApprovals").doc(clip.assetId).get()
			).data();
			check(
				approval?.approved === true &&
					approval.revision === job.approvalRevisions?.[clip.assetId],
				"Asset permission changed; render again",
			);
		}
	}
	const expiresAt = Date.now() + 5 * 60000;
	const [url] = await getStorage()
		.bucket(bucketName.value())
		.file(job.outputPath)
		.getSignedUrl({ version: "v4", action: "read", expires: expiresAt });
	return { url, expiresAt };
});
// Firestore job creation is the outbox: retrying this trigger never creates another task for the same job.
export const enqueueStudioJob = onDocumentCreated(
	{ document: "workspaces/{workspaceId}/exportJobs/{jobId}", region, retry: true },
	async (event) => {
		const snapshot = event.data;
		if (!snapshot || snapshot.data().status !== "queued") return;
		const client = new CloudTasksClient(),
			project = process.env.GCLOUD_PROJECT;
		check(project, "Project ID unavailable");
		const url = new URL(workerUrl.value());
		check(
			url.protocol === "https:" && !url.username && !url.password,
			"HTTPS worker URL required",
		);
		const parent = client.queuePath(project, region.value(), queue.value());
		try {
			await client.createTask({
				parent,
				task: {
					name: `${parent}/tasks/${event.params.jobId}`,
					dispatchDeadline: { seconds: 1800 },
					httpRequest: {
						httpMethod: "POST",
						url: `${url.origin}/jobs`,
						headers: { "Content-Type": "application/json" },
						body: Buffer.from(
							JSON.stringify({
								workspaceId: event.params.workspaceId,
								jobId: event.params.jobId,
							}),
						).toString("base64"),
						oidcToken: {
							serviceAccountEmail: workerIdentity.value(),
							audience: url.origin,
						},
					},
				},
			});
		} catch (error) {
			if ((error as { code?: number }).code !== 6) throw error;
		}
	},
);

export const reconcileExpiredJobs = onSchedule(
	{ schedule: "every 15 minutes", region, maxInstances: 1 },
	async () => {
		const cutoff = Timestamp.fromMillis(Date.now() - 3 * 3600000);
		const jobs = await db
			.collectionGroup("exportJobs")
			.where("pipeline", "==", "cpu-mix-v1")
			.where("status", "in", ["queued", "processing"])
			.where("createdAt", "<", cutoff)
			.limit(100)
			.get();
		for (const job of jobs.docs) await service.expireJob(job.ref, cutoff);
	},
);
