import { useSyncExternalStore } from "react";
import { loadAppSetting, saveAppSetting } from "./appSettings";

export type PreviewQuality = "balanced" | "full";
const KEY = "recordly.previewQuality";
const listeners = new Set<() => void>();
let quality: PreviewQuality = "balanced";
const savedQuality = loadAppSetting<unknown>(KEY);
if (savedQuality === "full" || savedQuality === "balanced") {
	quality = savedQuality;
} else {
	try {
		const legacyQuality = localStorage.getItem(KEY);
		if (legacyQuality === "full" || legacyQuality === "balanced") {
			quality = legacyQuality;
			saveAppSetting(KEY, legacyQuality);
		}
	} catch {
		/* Browser storage is an optional fallback. */
	}
}

// Only the preview backing store is scaled. Source media and export dimensions are untouched.
export function getPreviewResolution(
	width: number,
	height: number,
	dpr: number,
	mode: PreviewQuality,
) {
	const density = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
	if (mode === "full") return density;
	return Math.min(1, density, 1280 / Math.max(1, width, height));
}

export function setPreviewQuality(next: PreviewQuality) {
	quality = next;
	saveAppSetting(KEY, next);
	try {
		localStorage.setItem(KEY, next);
	} catch {
		/* Storage is optional. */
	}
	for (const listener of listeners) listener();
}

export function usePreviewQuality() {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => quality,
		() => "balanced" as PreviewQuality,
	);
}
