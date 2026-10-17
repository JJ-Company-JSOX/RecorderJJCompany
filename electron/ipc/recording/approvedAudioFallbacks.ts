import { rememberApprovedLocalReadPath, resolveApprovedLocalMediaPath } from "../project/manager";
import { getCompanionAudioFallbackInfo } from "./diagnostics";

/** Discover only tracks belonging to a video the user has already selected. */
export async function getApprovedCompanionAudioFallbackInfo(videoPath: string) {
	// Probing a renderer-supplied path must not approve arbitrary files or
	// companion symlinks before the user selects their source video.
	const approvedVideoPath = await resolveApprovedLocalMediaPath(videoPath);
	if (!approvedVideoPath) {
		return {
			success: false,
			paths: [],
			startDelayMsByPath: {},
			error: "Video is unavailable or not approved.",
		};
	}
	await rememberApprovedLocalReadPath(approvedVideoPath);
	const { paths, startDelayMsByPath } = await getCompanionAudioFallbackInfo(approvedVideoPath);
	const resolved = await Promise.all(
		paths.map((fallbackPath) => resolveApprovedLocalMediaPath(fallbackPath)),
	);
	const approvedPaths = paths.filter((_, index) => resolved[index] !== null);
	return {
		success: true,
		paths: approvedPaths,
		startDelayMsByPath: Object.fromEntries(
			Object.entries(startDelayMsByPath).filter(([audioPath]) =>
				approvedPaths.includes(audioPath),
			),
		),
	};
}
