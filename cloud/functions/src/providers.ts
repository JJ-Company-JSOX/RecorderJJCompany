import { check, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, providerPage, text } from "./domain.js";
async function json(url: string, headers: Record<string, string>, body?: unknown) {
	const response = await fetch(url, {
		method: body ? "POST" : "GET",
		headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(20000),
		redirect: "error",
	});
	if (!response.ok) throw Error(`Provider request failed (${response.status})`);
	const raw = await response.text();
	check(raw.length < 2_000_000, "Provider response too large");
	return JSON.parse(raw);
}
export async function embedQuery(value: string, key: string): Promise<number[]> {
	const result = await json(
		`https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`,
		{ "x-goog-api-key": key },
		{
			content: { parts: [{ text: value }] },
			taskType: "RETRIEVAL_QUERY",
			outputDimensionality: EMBEDDING_DIMENSIONS,
		},
	);
	const vector = result.embedding?.values;
	check(
		Array.isArray(vector) &&
			vector.length === EMBEDDING_DIMENSIONS &&
			vector.every((n: unknown) => typeof n === "number" && Number.isFinite(n)),
		"Invalid embedding",
	);
	return vector;
}
export interface StockSuggestion {
	provider: "pexels" | "pixabay";
	providerAssetId: string;
	sourceUrl: string;
	previewUrl: string;
	licenseUrl: string;
	termsVersion: string;
	durationMs: number;
	downloadUrl: string;
}
/** Search returns metadata only. Media bytes are downloaded only after a separate approval. */
export async function searchStock(
	provider: "pexels" | "pixabay",
	query: string,
	key: string,
): Promise<StockSuggestion[]> {
	const q = encodeURIComponent(text(query, 120));
	if (provider === "pexels") {
		const data = await json(`https://api.pexels.com/videos/search?query=${q}&per_page=5`, {
			Authorization: key,
		});
		return (data.videos ?? []).slice(0, 5).flatMap((video) => {
			if (!providerPage("pexels", video.url) || !Array.isArray(video.video_files)) return [];
			const file = video.video_files
				.filter((f) => f.file_type === "video/mp4" && f.width <= 1920)
				.sort((a, b) => b.width - a.width)[0];
			if (!file) return [];
			return [
				{
					provider,
					providerAssetId: String(video.id),
					sourceUrl: video.url,
					previewUrl: video.image,
					licenseUrl: "https://www.pexels.com/license/",
					termsVersion: "provider-terms-review-required",
					durationMs: Math.floor(Number(video.duration) * 1000),
					downloadUrl: file.link,
				},
			];
		});
	}
	// Pixabay's API requires the key in the query string. This URL must never be logged or returned.
	const data = await json(
		`https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${q}&per_page=5`,
		{},
	);
	return (data.hits ?? []).slice(0, 5).flatMap((video) => {
		if (!providerPage("pixabay", video.pageURL)) return [];
		const file = video.videos?.medium ?? video.videos?.small;
		if (!file?.url) return [];
		return [
			{
				provider,
				providerAssetId: String(video.id),
				sourceUrl: video.pageURL,
				previewUrl: video.videos?.tiny?.thumbnail ?? "",
				licenseUrl: "https://pixabay.com/service/license-summary/",
				termsVersion: "provider-terms-review-required",
				durationMs: Math.floor(Number(video.duration) * 1000),
				downloadUrl: file.url,
			},
		];
	});
}
