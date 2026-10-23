import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const ffmpegBase = [
	"-hide_banner",
	"-loglevel",
	"error",
	"-nostdin",
	"-protocol_whitelist",
	"file,pipe",
];

export type Size = { width: number; height: number };
/** A rectangle in source video pixels. */
export type Rect = { x: number; y: number; w: number; h: number };
export type GraySample = { timeMs: number; gray: Uint8Array };

/** Grid used to compare frames cheaply: what changed and when the screen settled. */
export const GRAY_W = 96;
export const GRAY_H = 54;
/** One low-resolution sample every 250 ms (fps=4). */
export const SAMPLE_MS = 250;

/**
 * Seeks so that time t means what the editor shows at t, also for variable-frame-rate
 * recordings, where a frame is only written when the screen changes. An accurate input seek
 * drops the frame that is still on screen at the seek point, so decoding starts at the
 * keyframe before it instead, keeps real timestamps from the start of the file, and the fps
 * filter (start_time + round=up) then picks for each tick the latest frame at or before it.
 */
const seekTo = (timeMs: number) => [
	"-noaccurate_seek",
	"-ss",
	(timeMs / 1000).toFixed(3),
	"-copyts",
	"-start_at_zero",
];
const ticksFrom = (timeMs: number) =>
	`fps=${1000 / SAMPLE_MS}:start_time=${(timeMs / 1000).toFixed(3)}:round=up`;
/** A PNG of at most 1280x960 is well under this; raw RGB of the same size is 3.7 MB. */
const MAX_FRAME_BYTES = 16_000_000;

const evenUp = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const evenDown = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const isPng = (b: Buffer) =>
	b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** Width and height of the first video stream, in pixels. */
export async function videoSize(
	ffprobePath: string,
	videoPath: string,
	signal: AbortSignal,
): Promise<Size> {
	const { stdout } = await exec(
		ffprobePath,
		[
			"-v",
			"error",
			"-protocol_whitelist",
			"file,pipe",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height",
			"-of",
			"json",
			videoPath,
		],
		{ timeout: 30_000, maxBuffer: 64_000, windowsHide: true, signal },
	);
	const stream = (JSON.parse(stdout) as { streams?: { width?: unknown; height?: unknown }[] })
		.streams?.[0];
	const pixels = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 16;
	if (!stream || !pixels(stream.width) || !pixels(stream.height) || stream.width > 16_384)
		throw Error("No readable video stream");
	return { width: stream.width, height: stream.height };
}

/**
 * A w x h rectangle centred on (cx, cy) in pixels, moved inside the frame. Coordinates are
 * even so 4:2:0 video crops exactly.
 */
export function rectAround(size: Size, cx: number, cy: number, w: number, h: number): Rect {
	const rw = Math.min(evenDown(size.width), evenUp(w));
	const rh = Math.min(evenDown(size.height), evenUp(h));
	const even = (n: number) => Math.floor(n / 2) * 2;
	const place = (centre: number, extent: number, limit: number) =>
		Math.max(0, Math.min(even(centre - extent / 2), even(limit - extent)));
	return { x: place(cx, rw, size.width), y: place(cy, rh, size.height), w: rw, h: rh };
}

/** The largest size within the limits that keeps the rectangle's shape. Never enlarges. */
export function fitSize(rect: Rect, maxW: number, maxH: number, maxArea = maxW * maxH): Size {
	const scale = Math.min(1, maxW / rect.w, maxH / rect.h, Math.sqrt(maxArea / (rect.w * rect.h)));
	return { width: evenDown(rect.w * scale), height: evenDown(rect.h * scale) };
}

/**
 * One frame at `timeMs`, cropped to `rect` in source pixels and scaled to `out` with an area
 * filter (sharp text, no ringing). PNG is lossless; "rgb" returns raw RGB24 for OCR. `marker` is
 * a box in output pixels drawn only on the PNG, so OCR always sees the untouched pixels.
 */
export async function grabFrame(options: {
	ffmpegPath: string;
	videoPath: string;
	timeMs: number;
	rect: Rect;
	out: Size;
	format: "png" | "rgb";
	marker?: Rect;
	signal: AbortSignal;
}): Promise<Buffer> {
	const { rect, out, marker } = options;
	const timeMs = Math.max(0, options.timeMs);
	const filters = [
		ticksFrom(timeMs),
		`crop=${rect.w}:${rect.h}:${rect.x}:${rect.y}`,
		`scale=${out.width}:${out.height}:flags=area`,
	];
	if (marker && options.format === "png")
		filters.push(
			`drawbox=x=${marker.x}:y=${marker.y}:w=${marker.w}:h=${marker.h}:color=red@0.9:t=2`,
		);
	const { stdout } = await exec(
		options.ffmpegPath,
		[
			...ffmpegBase,
			...seekTo(timeMs),
			"-i",
			options.videoPath,
			"-map",
			"0:v:0",
			"-frames:v",
			"1",
			"-vf",
			filters.join(","),
			"-threads",
			"2",
			...(options.format === "png"
				? ["-f", "image2pipe", "-c:v", "png"]
				: ["-pix_fmt", "rgb24", "-f", "rawvideo"]),
			"pipe:1",
		],
		{
			encoding: "buffer",
			maxBuffer: MAX_FRAME_BYTES,
			timeout: 30_000,
			windowsHide: true,
			signal: options.signal,
		},
	);
	const valid =
		options.format === "png" ? isPng(stdout) : stdout.length === out.width * out.height * 3;
	if (!valid) throw Error("Could not decode a frame");
	return stdout;
}

/**
 * Streams small grayscale samples (every SAMPLE_MS) for one time span in a single ffmpeg run.
 * Memory is bounded by the span length, never by the length of the video.
 */
export function graySamples(
	ffmpegPath: string,
	videoPath: string,
	span: { startMs: number; endMs: number },
	signal: AbortSignal,
): Promise<GraySample[]> {
	const startMs = Math.max(0, span.startMs);
	const frame = GRAY_W * GRAY_H;
	const limit = (Math.ceil((span.endMs - startMs) / SAMPLE_MS) + 2) * frame;
	return new Promise((resolve, reject) => {
		const child = spawn(
			ffmpegPath,
			[
				...ffmpegBase,
				...seekTo(startMs),
				"-i",
				videoPath,
				"-map",
				"0:v:0",
				// Timestamps stay absolute (see seekTo), so the span ends at an absolute time too.
				"-to",
				(span.endMs / 1000).toFixed(3),
				"-vf",
				// Sample i is what the editor shows at start + i * SAMPLE_MS.
				`${ticksFrom(startMs)},scale=${GRAY_W}:${GRAY_H}:flags=area,format=gray`,
				"-threads",
				"2",
				"-f",
				"rawvideo",
				"pipe:1",
			],
			{ windowsHide: true, signal, stdio: ["ignore", "pipe", "ignore"] },
		);
		const chunks: Buffer[] = [];
		let bytes = 0;
		// Decoding is the cost, so the time limit grows with the span (a few seconds per moment).
		const timer = setTimeout(() => child.kill(), 30_000 + 2 * (span.endMs - startMs));
		child.stdout.on("data", (chunk: Buffer) => {
			if (bytes >= limit) return;
			chunks.push(chunk);
			bytes += chunk.length;
			if (bytes >= limit) child.kill();
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", () => {
			clearTimeout(timer);
			if (signal.aborted) return reject(signal.reason);
			const raw = Buffer.concat(chunks).subarray(0, limit);
			const samples: GraySample[] = [];
			for (let i = 0; (i + 1) * frame <= raw.length; i++)
				samples.push({
					timeMs: startMs + i * SAMPLE_MS,
					gray: new Uint8Array(raw.subarray(i * frame, (i + 1) * frame)),
				});
			resolve(samples);
		});
	});
}
