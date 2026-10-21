import fs from "node:fs/promises";
import path from "node:path";

/** Platforms Recordly posts to directly, each through the developer's own registered app. */
export const PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const isPlatform = (value: unknown): value is Platform =>
	PLATFORMS.includes(value as Platform);

/** Platforms whose API can publish at a later time. */
export const SCHEDULING_PLATFORMS = new Set<Platform>(["youtube"]);

export type Visibility = "public" | "private";
export type PublishRequest = {
	videoPath: string;
	accounts: Array<{ platform: Platform; id: string }>;
	text: string;
	title: string;
	visibility: Visibility;
	when: "now" | "schedule";
	/** ISO 8601, required when scheduling. */
	date?: string;
	madeWithAi: boolean;
	/** TikTok's required choices, made by the customer for each post (no defaults). */
	tiktok?: TikTokChoices;
};

export type TikTokChoices = {
	privacy: string;
	allowComment: boolean;
	allowDuet: boolean;
	allowStitch: boolean;
	/** Promoting the creator's own business. */
	yourBrand: boolean;
	/** Paid partnership with another brand. */
	brandedContent: boolean;
};

/** A video ready to post: what every platform adapter receives. */
export type VideoPost = Omit<PublishRequest, "accounts">;

export function parsePublishRequest(input: unknown): PublishRequest {
	const value = (input ?? {}) as Record<string, unknown>;
	const accounts = Array.isArray(value.accounts) ? value.accounts : [];
	if (
		accounts.length > 20 ||
		!accounts.every(
			(a) => a && isPlatform(a.platform) && typeof a.id === "string" && a.id.length <= 200,
		)
	)
		throw new Error("Invalid accounts");
	if (typeof value.text !== "string" || value.text.length > 5000) throw new Error("Invalid text");
	if (typeof value.title !== "string" || value.title.length > 200)
		throw new Error("Invalid title");
	if (value.visibility !== "public" && value.visibility !== "private")
		throw new Error("Invalid visibility");
	if (value.when !== "now" && value.when !== "schedule") throw new Error("Invalid publish time");
	return {
		videoPath: String(value.videoPath),
		accounts: accounts.map((a) => ({ platform: a.platform, id: a.id })),
		text: value.text,
		title: value.title,
		visibility: value.visibility,
		when: value.when,
		date: typeof value.date === "string" ? value.date : undefined,
		madeWithAi: value.madeWithAi === true,
		tiktok: parseTikTok(value.tiktok),
	};
}

function parseTikTok(value: unknown): TikTokChoices | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Record<string, unknown>;
	if (typeof v.privacy !== "string" || !/^[A-Z_]{1,40}$/.test(v.privacy)) return undefined;
	return {
		privacy: v.privacy,
		allowComment: v.allowComment === true,
		allowDuet: v.allowDuet === true,
		allowStitch: v.allowStitch === true,
		yourBrand: v.yourBrand === true,
		brandedContent: v.brandedContent === true,
	};
}

/** Problems to fix before anything is uploaded. */
export function publishProblems(request: PublishRequest) {
	const problems: string[] = [];
	if (!request.accounts.length) problems.push("Choose at least one account.");
	const platforms = new Set(request.accounts.map((a) => a.platform));
	if (platforms.has("youtube") && request.title.trim().length < 2)
		problems.push("YouTube needs a title of at least 2 characters.");
	if (platforms.has("x") && [...request.text].length > 280)
		problems.push("X allows at most 280 characters of text.");
	if (platforms.has("tiktok") && !request.tiktok)
		problems.push("Choose who can see the TikTok video.");
	if (request.tiktok?.brandedContent && request.tiktok.privacy === "SELF_ONLY")
		problems.push("Branded content on TikTok cannot be private.");
	if (
		(platforms.has("facebook") || platforms.has("instagram")) &&
		request.visibility === "private"
	)
		problems.push("Facebook Page and Instagram posts are always public.");
	if (request.when === "schedule") {
		const time = Date.parse(request.date ?? "");
		if (!Number.isFinite(time) || time < Date.now() + 60_000)
			problems.push("Choose a schedule time at least one minute from now.");
		const unscheduled = [...platforms].filter((p) => !SCHEDULING_PLATFORMS.has(p));
		if (unscheduled.length)
			problems.push(`Scheduling is not available for: ${unscheduled.join(", ")}.`);
	}
	return problems;
}

/** The exported video must be a real MP4 file on disk. */
export async function checkVideoFile(videoPath: unknown) {
	if (typeof videoPath !== "string" || !path.isAbsolute(videoPath) || !/\.mp4$/i.test(videoPath))
		throw new Error("Choose an exported MP4 video.");
	const stat = await fs.stat(videoPath).catch(() => null);
	if (!stat?.isFile() || stat.size === 0) throw new Error("The video file is missing or empty.");
	return { path: videoPath, bytes: stat.size };
}
