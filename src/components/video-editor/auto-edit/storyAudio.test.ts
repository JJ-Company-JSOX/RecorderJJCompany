import { describe, expect, it, vi } from "vitest";
import type { CaptionCue } from "../types";
import {
	mergeStorySourceCaptions,
	mergeStorySpeechEvidence,
	transcribeStoryAudio,
	type StoryAudioApi,
	type StoryAudioProgress,
} from "./storyAudio";
const cue = (patch: Partial<CaptionCue> = {}): CaptionCue => ({
	id: "caption-1",
	startMs: 1200,
	endMs: 2400,
	text: "Original speech",
	words: [
		{ text: "Original", startMs: 1200, endMs: 1700 },
		{ text: "speech", startMs: 1800, endMs: 2400, leadingSpace: true },
	],
	...patch,
});
function setup() {
	const unsubscribe = vi.fn();
	let progress: ((value: StoryAudioProgress) => void) | undefined;
	const api = {
		getBundledSpeechStatus: vi.fn(async () => ({ available: true })),
		getWhisperSmallModelStatus: vi.fn(async () => ({
			success: true,
			exists: false,
			path: null as string | null,
		})),
		generateAutoCaptions: vi.fn(async () => ({ success: true, cues: [cue()] })),
		cancelAutoCaptionGeneration: vi.fn(async () => ({ success: true, cancelled: true })),
		onAutoCaptionProgress: vi.fn((callback) => {
			progress = callback;
			return unsubscribe;
		}),
	} satisfies StoryAudioApi;
	return { api, unsubscribe, progress: (value: StoryAudioProgress) => progress?.(value) };
}
const options = (api: StoryAudioApi) => ({
	api,
	videoPath: "C:\\approved\\recording.mp4",
	language: "en",
	consent: true,
	existingCaptions: [],
});
describe("explicit original-audio story recognition", () => {
	it("reuses bundled speech without downloads, preserves source word times and reports real stages", async () => {
		const test = setup(),
			stages = vi.fn();
		test.api.generateAutoCaptions.mockImplementation(async () => {
			test.progress({ phase: "transcribing" });
			return { success: true, cues: [cue()] };
		});
		const result = await transcribeStoryAudio({ ...options(test.api), onStage: stages });
		expect(test.api.generateAutoCaptions).toHaveBeenCalledWith({
			videoPath: "C:\\approved\\recording.mp4",
			language: "en",
			whisperModelPath: "",
			whisperExecutablePath: undefined,
		});
		expect(test.api.getWhisperSmallModelStatus).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			success: true,
			recognizedCues: [cue()],
			mergedCues: [cue()],
			addedCount: 1,
			preservedCount: 0,
		});
		expect(stages.mock.calls).toEqual([
			["checking-model"],
			["preparing"],
			["transcribing", undefined],
		]);
		expect(test.unsubscribe).toHaveBeenCalledOnce();
	});
	it("uses an already installed small model when bundled speech is unavailable", async () => {
		const test = setup();
		test.api.getBundledSpeechStatus.mockResolvedValue({ available: false });
		test.api.getWhisperSmallModelStatus.mockResolvedValue({
			success: true,
			exists: true,
			path: "C:\\models\\small.bin",
		});
		expect((await transcribeStoryAudio(options(test.api))).success).toBe(true);
		expect(test.api.generateAutoCaptions).toHaveBeenCalledWith(
			expect.objectContaining({ whisperModelPath: "C:\\models\\small.bin" }),
		);
	});
	it("honors a selected existing speech model/executable without starting model lookup", async () => {
		const test = setup();
		await transcribeStoryAudio({
			...options(test.api),
			whisperModelPath: "selected.bin",
			whisperExecutablePath: "whisper-cli.exe",
		});
		expect(test.api.getBundledSpeechStatus).not.toHaveBeenCalled();
		expect(test.api.getWhisperSmallModelStatus).not.toHaveBeenCalled();
		expect(test.api.generateAutoCaptions).toHaveBeenCalledWith(
			expect.objectContaining({
				whisperModelPath: "selected.bin",
				whisperExecutablePath: "whisper-cli.exe",
			}),
		);
	});
	it("does not load models or touch media before explicit consent and a valid source", async () => {
		const test = setup();
		expect(await transcribeStoryAudio({ ...options(test.api), consent: false })).toMatchObject({
			success: false,
			reason: "consent-required",
		});
		expect(await transcribeStoryAudio({ ...options(test.api), videoPath: "" })).toMatchObject({
			success: false,
			reason: "missing-source",
		});
		expect(test.api.getBundledSpeechStatus).not.toHaveBeenCalled();
		expect(test.api.generateAutoCaptions).not.toHaveBeenCalled();
	});
	it("provides a missing-model fallback without downloading or transcribing", async () => {
		const test = setup();
		test.api.getBundledSpeechStatus.mockResolvedValue({ available: false });
		expect(await transcribeStoryAudio(options(test.api))).toMatchObject({
			success: false,
			reason: "missing-model",
		});
		expect(test.api.generateAutoCaptions).not.toHaveBeenCalled();
	});
	it("preserves manually edited captions and returns independent recognized evidence", async () => {
		const test = setup(),
			edited = cue({ text: "User correction", words: undefined });
		const result = await transcribeStoryAudio({
			...options(test.api),
			existingCaptions: [edited],
		});
		expect(result).toMatchObject({
			success: true,
			mergedCues: [edited],
			recognizedCues: [cue()],
			addedCount: 0,
			preservedCount: 1,
		});
		if (result.success) {
			result.recognizedCues[0].words![0].text = "mutated";
			result.mergedCues[0].text = "mutated";
		}
		expect(edited.text).toBe("User correction");
		await expect(test.api.generateAutoCaptions.mock.results[0].value).resolves.toMatchObject({
			cues: [cue()],
		});
	});
	it("distinguishes backend no-audio, no-speech and busy outcomes without guessing from text", async () => {
		for (const errorCode of ["no-audio", "no-speech", "busy", "not-approved"]) {
			const test = setup();
			test.api.generateAutoCaptions.mockResolvedValue({
				success: false,
				errorCode,
				message: "Backend detail",
			} as never);
			expect(await transcribeStoryAudio(options(test.api))).toMatchObject({
				success: false,
				reason: errorCode,
				details: "Backend detail",
			});
		}
		const test = setup();
		test.api.generateAutoCaptions.mockResolvedValue({ success: true, cues: [] });
		expect(await transcribeStoryAudio(options(test.api))).toMatchObject({
			success: false,
			reason: "no-speech",
		});
	});
	it("cancels an in-flight recognition once and ignores late results/progress", async () => {
		const test = setup(),
			controller = new AbortController(),
			stages = vi.fn();
		let finish!: (value: { success: boolean; cues: CaptionCue[] }) => void;
		test.api.generateAutoCaptions.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const request = transcribeStoryAudio({
			...options(test.api),
			signal: controller.signal,
			onStage: stages,
		});
		await vi.waitFor(() => expect(test.api.generateAutoCaptions).toHaveBeenCalledOnce());
		controller.abort();
		expect(await request).toMatchObject({ success: false, reason: "cancelled" });
		expect(test.api.cancelAutoCaptionGeneration).toHaveBeenCalledOnce();
		expect(test.unsubscribe).toHaveBeenCalledOnce();
		const stageCount = stages.mock.calls.length;
		test.progress({ phase: "complete", cueCount: 1 });
		expect(stages).toHaveBeenCalledTimes(stageCount);
		finish({ success: true, cues: [cue()] });
		await Promise.resolve();
		expect(test.api.cancelAutoCaptionGeneration).toHaveBeenCalledOnce();
	});
	it("rejects work already cancelled or whose generation/source changed before completion", async () => {
		const test = setup(),
			controller = new AbortController();
		controller.abort();
		expect(
			await transcribeStoryAudio({ ...options(test.api), signal: controller.signal }),
		).toMatchObject({ success: false, reason: "cancelled" });
		expect(test.api.generateAutoCaptions).not.toHaveBeenCalled();
		let current = true;
		test.api.generateAutoCaptions.mockImplementation(async () => {
			current = false;
			return { success: true, cues: [cue()] };
		});
		expect(
			await transcribeStoryAudio({ ...options(test.api), isCurrent: () => current }),
		).toMatchObject({ success: false, reason: "stale" });
	});
	it("rejects malformed or invalid source timestamps without producing editable state", async () => {
		for (const invalid of [
			[cue({ startMs: -1 })],
			[cue({ words: [{ text: "bad", startMs: NaN, endMs: 4000 }] })],
			[cue(), cue()],
			[cue({ endMs: 86400001 })],
		]) {
			const test = setup();
			test.api.generateAutoCaptions.mockResolvedValue({ success: true, cues: invalid });
			expect(await transcribeStoryAudio(options(test.api))).toMatchObject({
				success: false,
				reason: "invalid-result",
			});
		}
	});
});
it("appends nonoverlapping source captions, handles ID collisions and clones words", () => {
	const existing = [cue({ startMs: 0, endMs: 500 })],
		recognized = [cue()];
	const merged = mergeStorySourceCaptions(existing, recognized);
	expect(merged).toHaveLength(2);
	expect(new Set(merged.map((c) => c.id)).size).toBe(2);
	expect(merged[1]).toMatchObject({ startMs: 1200, endMs: 2400, text: "Original speech" });
	merged[1].words![0].text = "mutated";
	expect(recognized[0].words![0].text).toBe("Original");
});

it("keeps manual source text in its bound clip while permitting original ASR on another repeated use", () => {
	const corrected = cue({ text: "Edited first use", words: undefined, clipId: "first" });
	const result = mergeStorySpeechEvidence(
		[corrected, cue({ id: "narration-story-1", text: "Generated story", clipId: "second" })],
		[cue()],
		[
			{ id: "first", startMs: 0, endMs: 5000, sourceStartMs: 0, speed: 1 },
			{ id: "second", startMs: 10000, endMs: 15000, sourceStartMs: 0, speed: 1 },
		],
	);
	expect(result).toHaveLength(2);
	expect(result[0]).toMatchObject({ text: "Edited first use", clipId: "first" });
	expect(result[1]).toMatchObject({ text: "Original speech", clipId: "second" });
});
it("uses manual unbound source subtitles instead of reintroducing unedited ASR", () => {
	const corrected = cue({ text: "Manual text", words: undefined });
	expect(
		mergeStorySpeechEvidence(
			[corrected],
			[cue()],
			[
				{ id: "first", startMs: 0, endMs: 5000, sourceStartMs: 0, speed: 1 },
				{ id: "second", startMs: 10000, endMs: 15000, sourceStartMs: 0, speed: 1 },
			],
		),
	).toEqual([corrected]);
});
