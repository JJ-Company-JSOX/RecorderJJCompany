import type { GIF_SIZE_PRESETS, GifSizePreset } from "./types";

/** Calculate output dimensions without loading the GIF encoder or frame renderer. */
export function calculateOutputDimensions(
	sourceWidth: number,
	sourceHeight: number,
	sizePreset: GifSizePreset,
	sizePresets: typeof GIF_SIZE_PRESETS,
): { width: number; height: number } {
	const preset = sizePresets[sizePreset];
	const maxHeight = preset.maxHeight;

	if (sourceHeight <= maxHeight || sizePreset === "original") {
		return { width: sourceWidth, height: sourceHeight };
	}

	const aspectRatio = sourceWidth / sourceHeight;
	const newHeight = maxHeight;
	const newWidth = Math.round(newHeight * aspectRatio);

	// Some encoders require even dimensions.
	return {
		width: newWidth % 2 === 0 ? newWidth : newWidth + 1,
		height: newHeight % 2 === 0 ? newHeight : newHeight + 1,
	};
}
