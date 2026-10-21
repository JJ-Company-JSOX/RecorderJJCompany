import type { GoogleClient } from "./youtube";

/**
 * The OAuth apps the developer registers once per platform and builds into Recordly, so
 * customers only sign in with their own accounts. Set at build time in `.env`, or at run
 * time with RECORDLY_YOUTUBE_CLIENT_ID / RECORDLY_YOUTUBE_CLIENT_SECRET.
 */
export function youtubeClient(): GoogleClient | null {
	const id = (
		process.env.RECORDLY_YOUTUBE_CLIENT_ID ||
		import.meta.env.VITE_YOUTUBE_CLIENT_ID ||
		""
	).trim();
	const secret = (
		process.env.RECORDLY_YOUTUBE_CLIENT_SECRET ||
		import.meta.env.VITE_YOUTUBE_CLIENT_SECRET ||
		""
	).trim();
	return id.endsWith(".apps.googleusercontent.com") ? { id, secret: secret || undefined } : null;
}
