import { useSyncExternalStore } from "react";

export type PreviewQuality = "balanced" | "full";
const KEY = "recordly.previewQuality";
const listeners = new Set<() => void>();
let quality: PreviewQuality = "balanced";
try {
	if (localStorage.getItem(KEY) === "full") quality = "full";
} catch {
	/* Storage is optional. */
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
