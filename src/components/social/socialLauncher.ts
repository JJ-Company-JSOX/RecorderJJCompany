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

/** Platforms in the order they are offered; Instagram signs in through Facebook. */
export const SOCIAL_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "x"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
