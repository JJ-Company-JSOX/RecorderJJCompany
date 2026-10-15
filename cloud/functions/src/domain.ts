import { createHash } from "node:crypto";
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;
export const STUDIO_PIPELINE = "cpu-mix-v1";
export class DomainError extends Error {
	constructor(
		public code:
			| "invalid-argument"
			| "permission-denied"
			| "resource-exhausted"
			| "aborted"
			| "already-exists",
		message: string,
	) {
		super(message);
	}
}
export function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new DomainError("invalid-argument", message);
}
export function id(value: unknown): string {
	check(typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value), "Invalid identifier");
	return value;
}
export function text(value: unknown, max = 500): string {
	check(
		typeof value === "string" && value.trim().length > 0 && value.length <= max,
		"Invalid text",
	);
	return value.trim();
}
export function stableId(...parts: string[]): string {
	return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
export function keywords(value: string): string[] {
	const clean = value.toLocaleLowerCase("en").normalize("NFKC");
	const words = clean.match(/[\p{L}\p{N}]+/gu) ?? [];
	const tokens = words.flatMap((word) =>
		/[\p{Script=Han}]/u.test(word)
			? Array.from(word).flatMap((_, i, chars) =>
					i + 1 < chars.length ? [chars.slice(i, i + 2).join("")] : [chars[i]],
				)
			: [word],
	);
	return [...new Set(tokens)].slice(0, 100);
}
export interface Clip {
	assetType: "original" | "broll";
	assetId: string;
	startMs: number;
	endMs: number;
}
export interface MixTimeline {
	width: 1280;
	height: 720;
	fps: 30;
	clips: Clip[];
}
export function timeline(input: unknown, stored = false): MixTimeline {
	check(!!input && typeof input === "object" && !Array.isArray(input), "Missing timeline");
	const fields = [
		"width",
		"height",
		"fps",
		"clips",
		...(stored ? ["workspaceId", "projectId", "createdBy", "createdAt", "fingerprint"] : []),
	];
	check(
		Object.keys(input).every((key) => fields.includes(key)),
		"Unsupported timeline fields; desktop effects must not be silently removed",
	);
	const value = input as MixTimeline;
	check(
		value.width === 1280 && value.height === 720 && value.fps === 30,
		"CPU preview exports use 1280x720 at 30 fps",
	);
	check(
		Array.isArray(value.clips) && value.clips.length > 0 && value.clips.length <= 100,
		"Timeline requires 1..100 clips",
	);
	let duration = 0;
	const clips = value.clips.map((clip) => {
		check(!!clip && typeof clip === "object" && !Array.isArray(clip), "Invalid clip");
		check(
			Object.keys(clip).every((key) =>
				["assetType", "assetId", "startMs", "endMs"].includes(key),
			),
			"Unsupported clip fields; desktop effects must not be silently removed",
		);
		check(clip.assetType === "original" || clip.assetType === "broll", "Invalid asset kind");
		id(clip.assetId);
		check(
			Number.isSafeInteger(clip.startMs) &&
				Number.isSafeInteger(clip.endMs) &&
				clip.startMs >= 0 &&
				clip.endMs > clip.startMs &&
				clip.endMs <= 600000,
			"Invalid clip range",
		);
		duration += clip.endMs - clip.startMs;
		return {
			assetType: clip.assetType,
			assetId: clip.assetId,
			startMs: clip.startMs,
			endMs: clip.endMs,
		};
	});
	check(duration <= 600000, "Preview exports are limited to 10 minutes");
	check(Buffer.byteLength(JSON.stringify(clips)) <= 200000, "Timeline document too large");
	return { width: 1280, height: 720, fps: 30, clips };
}

export function assetDecision(input: Record<string, unknown>) {
	check(input.approved === true || input.approved === false, "An explicit decision is required");
	if (input.approved)
		check(
			input.licenseReviewed === true && input.usageRightsConfirmed === true,
			"Review the license and confirm usage rights before approval",
		);
	return {
		approved: input.approved,
		licenseReviewed: input.licenseReviewed === true,
		usageRightsConfirmed: input.usageRightsConfirmed === true,
	};
}

export function assertStudioJob(
	job: unknown,
	workspaceId: string,
): asserts job is Record<string, unknown> {
	check(!!job && typeof job === "object" && !Array.isArray(job), "Job missing");
	const value = job as Record<string, unknown>;
	check(
		value.pipeline === STUDIO_PIPELINE && value.workspaceId === workspaceId,
		"Job outside CPU Mix pipeline or workspace",
	);
	check(value.kind === "analyze" || value.kind === "render", "Unsupported job kind");
}

/** Ignore unrelated documents in an existing shared collection without dispatching them. */
export function dispatchPayload(workspaceId: string, jobId: string, job: Record<string, unknown>) {
	if (job.pipeline !== STUDIO_PIPELINE || job.status !== "queued") return null;
	assertStudioJob(job, workspaceId);
	id(job.targetId);
	return { workspaceId: id(workspaceId), jobId: id(jobId) };
}
export const STOCK_HOSTS = {
	pexels: ["www.pexels.com", "pexels.com"],
	pixabay: ["pixabay.com", "www.pixabay.com"],
} as const;
export function providerPage(provider: "pexels" | "pixabay", url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.protocol === "https:" &&
			(STOCK_HOSTS[provider] as readonly string[]).includes(parsed.hostname) &&
			!parsed.username &&
			!parsed.password
		);
	} catch {
		return false;
	}
}
export interface CloudConsent {
	cloudProcessing: true;
	gemini: true;
	sensitivityReviewed: true;
}
export function consent(value: unknown): CloudConsent {
	const v = value as CloudConsent;
	check(
		v?.cloudProcessing === true && v?.gemini === true && v?.sensitivityReviewed === true,
		"Confirm cloud processing, Gemini disclosure and sensitive-data review first",
	);
	return { cloudProcessing: true, gemini: true, sensitivityReviewed: true };
}
