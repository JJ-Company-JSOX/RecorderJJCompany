import { beforeEach, expect, it, vi } from "vitest";
import {
	emptyStoryBrief,
	type StoryRequest,
} from "../../../src/components/video-editor/auto-edit/story";
const fixture = vi.hoisted(() => ({
	inspect: vi.fn(),
	request: vi.fn(),
	grab: vi.fn(),
	size: vi.fn(),
}));
vi.mock("./reviewer", () => ({
	inspectLocalModel: fixture.inspect,
	localRequest: fixture.request,
}));
vi.mock("./frameGrab", () => ({
	videoSize: fixture.size,
	grabFrame: fixture.grab,
	fitSize: () => ({ width: 320, height: 180 }),
}));
import { generateLocalStory, parseStoryDraft } from "./story";
const request = (): StoryRequest => ({
	brief: {
		...emptyStoryBrief(),
		// Visual-path tests opt in explicitly; new user stories default to text only.
		analyzeVideo: true,
		topic: "Show my editor",
		facts: "Works offline",
		notes: "Product home screen",
	},
	videoPath: "PRIVATE_SOURCE.mp4",
	scenes: [{ id: "story-1", startMs: 0, endMs: 10000, sourceTimeMs: 12345 }],
});
const cue = {
	id: "story-1",
	stage: "Hook",
	title: "Edit offline",
	text: "Tell your story offline.",
};
beforeEach(() => {
	vi.clearAllMocks();
	fixture.inspect.mockResolvedValue({ capabilities: ["vision"] });
	fixture.size.mockResolvedValue({ width: 1920, height: 1080 });
	fixture.grab.mockResolvedValue(Buffer.from("sample-image"));
	fixture.request.mockResolvedValue({ message: { content: JSON.stringify({ cues: [cue] }) } });
});
const run = (r = request(), signal = new AbortController().signal) =>
	generateLocalStory({
		request: r,
		model: "local",
		language: "en",
		signal,
		ffmpegPath: "ffmpeg",
		ffprobePath: "ffprobe",
		approvedPath: "APPROVED.mp4",
		onProgress: vi.fn(),
	});
it("actually samples approved source times and supplies frames, facts and bounded slots to local AI", async () => {
	const draft = await run();
	expect(fixture.grab).toHaveBeenCalledWith(
		expect.objectContaining({
			videoPath: "APPROVED.mp4",
			timeMs: 12345,
			out: { width: 320, height: 180 },
		}),
	);
	const [route, body, , limit] = fixture.request.mock.calls[0];
	expect(route).toBe("/api/chat");
	expect(limit).toBe(3000000);
	expect(body).toMatchObject({ keep_alive: 0, options: { num_ctx: 8192, num_predict: 3072 } });
	expect(body.messages[1].images).toEqual([Buffer.from("sample-image").toString("base64")]);
	expect(JSON.stringify(body)).not.toContain("PRIVATE_SOURCE");
	expect(body.messages[0].content).toContain("not a mouse-click commentator");
	expect(draft.cues[0]).toEqual({ ...cue, startMs: 0, endMs: 10000 });
});
it("refuses visual analysis on a text model without touching media", async () => {
	fixture.inspect.mockResolvedValue({ capabilities: ["completion"] });
	await expect(run()).rejects.toThrow("cannot see video");
	expect(fixture.grab).not.toHaveBeenCalled();
	expect(fixture.request).not.toHaveBeenCalled();
});
it("allows explicit brief-only writing while making no claim to watch footage", async () => {
	const r = request();
	r.brief.analyzeVideo = false;
	await run(r);
	expect(fixture.grab).not.toHaveBeenCalled();
	const body = fixture.request.mock.calls[0][1];
	expect(body.messages[1].images).toBeUndefined();
	expect(body.messages[1].content).toContain("video was not analyzed");
});
it("rejects unknown, duplicate or incomplete story cues and binds times to the real slots", () => {
	for (const cues of [
		[],
		[cue, cue],
		[{ ...cue, id: "unknown" }],
		[{ ...cue, title: "a".repeat(61) }],
	])
		expect(() => parseStoryDraft(request(), { cues })).toThrow();
	expect(parseStoryDraft(request(), { cues: [{ ...cue, startMs: -100 }] }).cues[0].startMs).toBe(
		0,
	);
});
it("does not return late model output after cancellation", async () => {
	const controller = new AbortController();
	fixture.request.mockImplementation(async () => {
		controller.abort();
		return { message: { content: JSON.stringify({ cues: [cue] }) } };
	});
	await expect(run(request(), controller.signal)).rejects.toThrow();
});

it("sends edited subtitle evidence only with explicit consent and does not claim raw-audio analysis", async () => {
	const r = request();
	r.brief.analyzeVideo = false;
	r.brief.includeTranscript = true;
	r.transcript = [
		{ startMs: 500, endMs: 1500, text: "A feature actually described in the source subtitles" },
	];
	await run(r);
	const body = fixture.request.mock.calls[0][1];
	const content = JSON.parse(body.messages[1].content);
	expect(content.editedSubtitleEvidence).toEqual(r.transcript);
	expect(content.evidence).toContain("recorded audio were not analyzed");
	expect(body.messages[0].content).toContain("not audio you have listened to");
	expect(JSON.stringify(body)).not.toContain("PRIVATE_SOURCE");
});
it("rejects unconsented or stale subtitle data before media decoding or inference", async () => {
	const r = request();
	r.transcript = [{ startMs: 0, endMs: 500, text: "DO NOT SEND" }];
	await expect(run(r)).rejects.toThrow("subtitle consent");
	expect(fixture.inspect).not.toHaveBeenCalled();
	expect(fixture.request).not.toHaveBeenCalled();
	r.brief.includeTranscript = true;
	r.transcript[0].startMs = 20000;
	r.transcript[0].endMs = 22000;
	await expect(run(r)).rejects.toThrow("scene timing");
	expect(fixture.request).not.toHaveBeenCalled();
});
it("keeps existing brief-only requests free of subtitle evidence", async () => {
	const r = request();
	r.brief.analyzeVideo = false;
	await run(r);
	const content = JSON.parse(fixture.request.mock.calls[0][1].messages[1].content);
	expect(content.editedSubtitleEvidence).toBeUndefined();
});

it("sends desired narration seconds and conservative per-slot budgets without changing video times", async () => {
	const r = request();
	r.brief.targetSpeechSeconds = 30;
	r.brief.analyzeVideo = false;
	r.scenes = [
		{ id: "story-1", startMs: 0, endMs: 20000, sourceTimeMs: 10000 },
		{ id: "story-2", startMs: 25000, endMs: 65000, sourceTimeMs: 45000 },
	];
	fixture.request.mockResolvedValueOnce({
		message: { content: JSON.stringify({ cues: [cue, { ...cue, id: "story-2" }] }) },
	});
	const draft = await run(r);
	const payload = JSON.parse(fixture.request.mock.calls[0][1].messages[1].content);
	expect(payload.narrationTiming).toEqual({
		requestedSeconds: 30,
		footageSeconds: 60,
		budgetSeconds: 30,
	});
	expect(payload.slots.map((s: { maxChars: number }) => s.maxChars)).toEqual([110, 220]);
	expect(draft.cues.map((c) => [c.startMs, c.endMs])).toEqual([
		[0, 20000],
		[25000, 65000],
	]);
	expect(fixture.request.mock.calls[0][1].messages[0].content).toContain(
		"NOT an instruction to shorten",
	);
});
it("caps desired speech to a shorter real source instead of inventing a thirty-second output", async () => {
	const r = request();
	r.brief.targetSpeechSeconds = 30;
	r.scenes[0].endMs = 6000;
	const draft = await run(r);
	const payload = JSON.parse(fixture.request.mock.calls[0][1].messages[1].content);
	expect(payload.narrationTiming).toEqual({
		requestedSeconds: 30,
		footageSeconds: 6,
		budgetSeconds: 6,
	});
	expect(payload.slots[0]).toMatchObject({
		startMs: 0,
		endMs: 6000,
		speechSeconds: 6,
		maxChars: 66,
	});
	expect(draft.cues[0].endMs).toBe(6000);
});
it("allows a silent narration slot only where the actual speech character budget is zero", () => {
	const r = request();
	r.scenes[0].endMs = 1;
	expect(parseStoryDraft(r, { cues: [{ ...cue, text: "" }] }).cues[0]).toMatchObject({
		text: "",
		startMs: 0,
		endMs: 1,
	});
	expect(() => parseStoryDraft(request(), { cues: [{ ...cue, text: "" }] })).toThrow(
		"Invalid story cue",
	);
});
