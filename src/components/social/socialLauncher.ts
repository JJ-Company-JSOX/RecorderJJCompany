const OPEN_SOCIAL = "recordly:open-social";

/** Opens the Social media page of the dashboard, optionally with a just-exported video. */
export function openSocialPublisher(videoPath?: string) {
	window.dispatchEvent(new CustomEvent<string | undefined>(OPEN_SOCIAL, { detail: videoPath }));
}

export function onOpenSocialPublisher(handler: (videoPath?: string) => void) {
	const listener = (event: Event) => handler((event as CustomEvent<string | undefined>).detail);
	window.addEventListener(OPEN_SOCIAL, listener);
	return () => window.removeEventListener(OPEN_SOCIAL, listener);
}

/** Video platforms Recordly can post to, matching the main process list. */
export const VIDEO_PLATFORMS = new Set([
	"youtube",
	"tiktok",
	"instagram",
	"instagram-standalone",
	"facebook",
	"x",
	"threads",
	"linkedin",
	"linkedin-page",
	"bluesky",
]);
export const LINKABLE_PLATFORMS = [
	"youtube",
	"tiktok",
	"instagram",
	"facebook",
	"x",
	"threads",
	"linkedin",
] as const;
export const POSTIZ_CLOUD_URL = "https://api.postiz.com/public/v1";
