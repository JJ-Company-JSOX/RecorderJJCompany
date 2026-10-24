/** Shared by the renderer and main process; keep this module independent of UI/runtime imports. */
export const PROJECT_VERSION = 2;
export const MIN_PROJECT_VERSION = 1;

export function isSupportedProjectVersion(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= MIN_PROJECT_VERSION &&
		value <= PROJECT_VERSION
	);
}
