import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	intersectRanges,
	type MediaEvidence,
	type Span,
} from "../../../src/components/video-editor/auto-edit/plan";

const exec = promisify(execFile);
type Probe = {
	format?: { duration?: string };
	streams: { index: number; codec_type: string; duration?: string; start_time?: string }[];
};

/** FFmpeg emits the true start timestamp retrospectively once the minimum duration is met. */
export function parseDetectedRanges(
	log: string,
	kind: "silence" | "freeze",
	durationMs: number,
): Span[] {
	const result: Span[] = [];
	let start: number | undefined;
	const pattern = new RegExp(`${kind}_(start|end):\\s*(-?[\\d.]+)`, "g");
	for (const match of log.matchAll(pattern)) {
		const value = Math.max(0, Math.min(durationMs, Number(match[2]) * 1000));
		if (!Number.isFinite(value)) continue;
		if (match[1] === "start") start = value;
		else if (start !== undefined) {
			if (value > start) result.push({ startMs: Math.ceil(start), endMs: Math.floor(value) });
			start = undefined;
		}
	}
	if (start !== undefined && durationMs > start)
		result.push({ startMs: Math.ceil(start), endMs: Math.floor(durationMs) });
	return result;
}

export async function analyzeLocalMedia(options: {
	videoPath: string;
	ffmpegPath: string;
	ffprobePath: string;
	companions?: { path: string; delayMs: number }[];
	signal?: AbortSignal;
}): Promise<MediaEvidence> {
	const run = async (binary: string, args: string[]) =>
		exec(binary, args, {
			timeout: 30 * 60_000,
			maxBuffer: 4 * 1024 * 1024,
			windowsHide: true,
			signal: options.signal,
		});
	const probe = async (file: string): Promise<Probe> => {
		const { stdout } = await run(options.ffprobePath, [
			"-v",
			"error",
			"-show_streams",
			"-show_format",
			"-of",
			"json",
			file,
		]);
		return JSON.parse(stdout);
	};
	const metadata = await probe(options.videoPath);
	const durationMs = Math.floor(Number(metadata.format?.duration) * 1000);
	if (
		!Number.isFinite(durationMs) ||
		durationMs <= 0 ||
		!metadata.streams.some((s) => s.codec_type === "video")
	)
		throw new Error("Cannot determine video duration");
	const video = await run(options.ffmpegPath, [
		"-hide_banner",
		"-nostdin",
		"-nostats",
		"-threads",
		"2",
		"-i",
		options.videoPath,
		"-map",
		"0:v:0",
		"-an",
		"-vf",
		"setpts=PTS-STARTPTS,freezedetect=n=0:d=1.5",
		"-filter_threads",
		"1",
		"-f",
		"null",
		"-",
	]);
	const staticRanges = parseDetectedRanges(video.stderr, "freeze", durationMs);
	let silentRanges: Span[] = [{ startMs: 0, endMs: durationMs }];
	let tracks = 0;
	const warnings: string[] = [];
	if (
		metadata.streams
			.filter((s) => s.codec_type === "video")
			.some((s) => Math.abs(Number(s.start_time ?? 0)) > 0.05)
	) {
		warnings.push("audio-offset-unverified");
		silentRanges = [];
	}
	for (const file of [{ path: options.videoPath, delayMs: 0 }, ...(options.companions ?? [])]) {
		const meta = file.path === options.videoPath ? metadata : await probe(file.path);
		for (const stream of meta.streams.filter((s) => s.codec_type === "audio")) {
			tracks++;
			// Nonzero container offsets need a demux-aware alignment path. Fail closed for now.
			if (Math.abs(Number(stream.start_time ?? 0)) > 0.05) {
				warnings.push("audio-offset-unverified");
				silentRanges = [];
				continue;
			}
			const audioDuration = Math.min(
				durationMs,
				Math.floor(Number(stream.duration ?? meta.format?.duration) * 1000),
			);
			if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
				warnings.push("audio-duration-unverified");
				silentRanges = [];
				continue;
			}
			const audio = await run(options.ffmpegPath, [
				"-hide_banner",
				"-nostdin",
				"-nostats",
				"-threads",
				"2",
				"-i",
				file.path,
				"-map",
				`0:${stream.index}`,
				"-vn",
				"-af",
				"asetpts=PTS-STARTPTS,silencedetect=n=-50dB:d=1.5",
				"-f",
				"null",
				"-",
			]);
			const ranges = parseDetectedRanges(audio.stderr, "silence", audioDuration).map((s) => ({
				startMs: s.startMs + file.delayMs,
				endMs: s.endMs + file.delayMs,
			}));
			silentRanges = intersectRanges(silentRanges, ranges);
		}
	}
	// No audio stream anywhere (video or linked mic/system files): the whole recording is silent.
	const noAudio = tracks === 0 && warnings.length === 0;
	return {
		durationMs,
		staticRanges,
		silentRanges: tracks || noAudio ? silentRanges : [],
		audioVerified: warnings.length === 0,
		...(noAudio ? { noAudio } : {}),
		warnings,
	};
}
