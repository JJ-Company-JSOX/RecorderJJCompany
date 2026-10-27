import type { GoogleClient } from "./youtube";

/**
 * The apps the developer registers once per platform and builds into Recordly, so
 * customers only sign in with their own accounts. Set at build time in `.env`, or at run
 * time with the matching RECORDLY_* variable (e.g. RECORDLY_YOUTUBE_CLIENT_ID).
 */
const setting = (name: string, built: string | undefined) =>
	(process.env[`RECORDLY_${name}`] || built || "").trim();

export function youtubeClient(): GoogleClient | null {
	const id = setting("YOUTUBE_CLIENT_ID", import.meta.env.VITE_YOUTUBE_CLIENT_ID);
	const secret = setting("YOUTUBE_CLIENT_SECRET", import.meta.env.VITE_YOUTUBE_CLIENT_SECRET);
	return id.endsWith(".apps.googleusercontent.com") ? { id, secret: secret || undefined } : null;
}

/** TikTok's token endpoint requires the client secret, so it is built in with the key. */
export function tiktokClient() {
	const key = setting("TIKTOK_CLIENT_KEY", import.meta.env.VITE_TIKTOK_CLIENT_KEY);
	const secret = setting("TIKTOK_CLIENT_SECRET", import.meta.env.VITE_TIKTOK_CLIENT_SECRET);
	return key && secret ? { key, secret } : null;
}

/** X "Native App": a public client, PKCE only, no secret. */
export function xClient() {
	const id = setting("X_CLIENT_ID", import.meta.env.VITE_X_CLIENT_ID);
	return id ? { id } : null;
}

/** Meta app id for Facebook Login's desktop flow; no secret is built in. */
export function metaAppId() {
	const id = setting("META_APP_ID", import.meta.env.VITE_META_APP_ID);
	return /^\d{5,30}$/.test(id) ? id : null;
}
