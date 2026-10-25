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
