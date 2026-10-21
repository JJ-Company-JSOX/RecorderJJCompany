import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditPlan } from "../../../src/components/video-editor/auto-edit/plan";
import type { ScreenEvent } from "./narrationFrames";
import { generateBundledNarration, LocalNarrationGenerator } from "./narrator";

const mock = vi.hoisted(() => ({
	requests: [] as { hostname: string; port: number; path: string; body: string }[],
	cues: [{ id: "rule-1", text: "Clicking here to zoom in on the detail." }] as unknown,
}));
vi.mock("node:http", () => ({
	default: {
		request: (
			options: { hostname: string; port: number; path: string },
			callback: (
				res: EventEmitter & {
					statusCode: number;
					setEncoding: () => void;
					resume: () => void;
				},
			) => void,
		) => {
			const req = new EventEmitter() as EventEmitter & {
				end: (body: string) => void;
				destroy: (error: Error) => void;
			};
			req.destroy = (error) => {
				req.emit("error", error);
				req.emit("close");
			};
			req.end = (body) => {
				mock.requests.push({ ...options, body });
				queueMicrotask(() => {
					const res = Object.assign(new EventEmitter(), {
						statusCode: 200,
						setEncoding: () => undefined,
						resume: () => undefined,
					});
					callback(res);
					const reply =
						options.path === "/api/tags"
							? { models: [{ name: "local:latest", size: 1_000_000 }] }
							: options.path === "/api/show"
								? { model_info: {}, license: "MIT" }
								: { message: { content: JSON.stringify({ cues: mock.cues }) } };
					res.emit("data", JSON.stringify(reply));
					res.emit("end");
					req.emit("close");
				});
			};
			return req;
		},
	},
}));

beforeEach(() => {
	mock.requests.length = 0;
	mock.cues = [{ id: "rule-1", text: "Clicking here to zoom in on the detail." }];
});

const plan = (): EditPlan => ({
	version: 1,
	id: "plan",
	coordinateSpace: "timeline-ms",
	baseline: "private path /local/user.mp4 and transcript PRIVATE_TRANSCRIPT",
	warnings: [],
	reviewer: "rules",
	suggestions: [
		{
			id: "rule-1",
			kind: "zoom",
			reason: "click",
			startMs: 1000,
			endMs: 2000,
			text: "PRIVATE_TRANSCRIPT_TEXT",
		},
	],
});

describe("local-only narration draft (mock service, no inference claim)", () => {
	it("drafts a narration cue per unblocked suggestion from a fixed loopback address", async () => {
		const draft = await new LocalNarrationGenerator().generate(plan(), "local");
		expect(draft.cues).toEqual([
			{
				id: "rule-1",
				startMs: 1000,
				endMs: 2000,
				text: "Clicking here to zoom in on the detail.",
			},
		]);
		for (const request of mock.requests) {
			expect(request.hostname).toBe("127.0.0.1");
			expect(request.port).toBe(11434);
		}
	});
	it("never sends suggestion text, transcript content or file paths to the model", async () => {
		await new LocalNarrationGenerator().generate(plan(), "local");
		const body = mock.requests.find((r) => r.path === "/api/chat")!.body;
		expect(body).not.toContain("PRIVATE_TRANSCRIPT");
		expect(body).not.toContain("/local/user.mp4");
		expect(body).not.toContain("baseline");
	});
	it("returns no cues when every suggestion is blocked", async () => {
		const blocked = plan();
		blocked.suggestions[0].blocked = "existing-zoom";
		const draft = await new LocalNarrationGenerator().generate(blocked, "local");
		expect(draft.cues).toEqual([]);
		expect(mock.requests.some((r) => r.path === "/api/chat")).toBe(false);
	});
	it("rejects a cue id the plan never offered", async () => {
		mock.cues = [{ id: "unknown-id", text: "Made up." }];
		await expect(new LocalNarrationGenerator().generate(plan(), "local")).rejects.toThrow();
	});
	it("rejects duplicate cues for the same id", async () => {
		mock.cues = [
			{ id: "rule-1", text: "First." },
			{ id: "rule-1", text: "Second." },
		];
		await expect(new LocalNarrationGenerator().generate(plan(), "local")).rejects.toThrow();
	});
	it("rejects empty or missing cue text", async () => {
		mock.cues = [{ id: "rule-1", text: "" }];
		await expect(new LocalNarrationGenerator().generate(plan(), "local")).rejects.toThrow();
	});
	it("rejects an invalid or missing model name before sending the plan", async () => {
		await expect(
			new LocalNarrationGenerator().generate(plan(), "model:cloud"),
		).rejects.toThrow();
		expect(mock.requests).toHaveLength(0);
	});
});

describe("bundled offline narration draft (Stage B: one coherent script)", () => {
	const twoSteps = (): EditPlan => ({
		...plan(),
		suggestions: [
			{ id: "click-1", kind: "caption", reason: "click", startMs: 4000, endMs: 5500 },
			{
				id: "speed-1",
				kind: "speed",
				reason: "silent-moving",
				startMs: 9000,
				endMs: 12000,
				speed: 2,
			},
		],
	});
	const events = new Map<string, ScreenEvent>([
		[
			"click-1",
			{
				kind: "action",
				clicked: "Save",
				element: "button",
				result: "Saved",
				confidence: "high",
				scope: "small",
			},
		],
	]);
	it("writes intro, linked steps and outro from the ordered events in one call", async () => {
		const complete = vi.fn(async () =>
			JSON.stringify({
				intro: "This video shows how to save.",
				s1: "First, click “Save”, and “Saved” appears.",
				s2: "Then this part plays faster.",
				outro: "That's it.",
			}),
		);
		const draft = await generateBundledNarration(twoSteps(), complete, "en", events, {
			style: "tutorial",
			timelineEndMs: 20000,
		});
		expect(draft.cues).toEqual([
			{ id: "intro", startMs: 0, endMs: 4000, text: "This video shows how to save." },
			{
				id: "click-1",
				startMs: 4000,
				endMs: 5500,
				text: "First, click “Save”, and “Saved” appears.",
			},
			{ id: "speed-1", startMs: 9000, endMs: 12000, text: "Then this part plays faster." },
			{ id: "outro", startMs: 9001, endMs: 20000, text: "That's it." },
		]);
		expect(complete).toHaveBeenCalledOnce();
		const [instruction, question, schema, maxTokens] = complete.mock.calls[0];
		expect(instruction).toContain("TUTORIAL");
		expect(JSON.parse(question)).toEqual([
			{ id: "s1", do: "click", target: "Save", after: "“Saved” appears", max_chars: 63 },
			{ id: "s2", do: "sped up", max_chars: 90 },
		]);
		expect(Object.keys((schema as { properties: object }).properties)).toEqual([
			"intro",
			"s1",
			"s2",
			"outro",
		]);
		expect(maxTokens).toBe(1536);
	});
	it("never sends suggestion text, transcript content or file paths through complete()", async () => {
		const complete = vi.fn(async () => JSON.stringify({}));
		await generateBundledNarration(plan(), complete);
		const [, question] = complete.mock.calls[0];
		expect(question).not.toContain("PRIVATE_TRANSCRIPT");
		expect(question).not.toContain("/local/user.mp4");
		expect(question).not.toContain("baseline");
	});
	it("asks Chinese lines to name English labels in Chinese, which the voice can read", async () => {
		const complete = vi.fn(async () => JSON.stringify({}));
		await generateBundledNarration(plan(), complete);
		const [instruction] = complete.mock.calls[0];
		expect(instruction).toContain("Simplified Chinese");
		expect(instruction).toContain("“设置（Settings）”");
	});
	it.each([
		["en", "plain English"],
		["ms", "Bahasa Melayu"],
	] as const)("writes %s lines when that language is chosen", async (language, expected) => {
		const complete = vi.fn(async () => JSON.stringify({}));
		await generateBundledNarration(plan(), complete, language);
		const [instruction] = complete.mock.calls[0];
		expect(instruction).toContain(expected);
		expect(instruction).not.toContain("Simplified Chinese");
	});
	it("uses an unreadable click only as a generic step and a screen note for other moments", async () => {
		const complete = vi.fn(async () => JSON.stringify({}));
		await generateBundledNarration(
			{
				...plan(),
				suggestions: [
					{ id: "click-1", kind: "caption", reason: "click", startMs: 1000, endMs: 2500 },
					{
						id: "moment-1",
						kind: "caption",
						reason: "vision",
						startMs: 9000,
						endMs: 10500,
					},
				],
			},
			complete,
			"en",
			new Map<string, ScreenEvent>([
				[
					"click-1",
					{
						kind: "action",
						clicked: "Sav",
						element: "button",
						result: "",
						confidence: "low",
						scope: "none",
					},
				],
				["moment-1", { kind: "screen", screen: "Settings page" }],
			]),
		);
		expect(JSON.parse(complete.mock.calls[0][1])).toEqual([
			{ id: "s1", do: "click", max_chars: 90 },
			{ id: "s2", do: "show", screen: "Settings page", max_chars: 56 },
		]);
	});
	it("returns no cues and never calls complete() when every suggestion is blocked", async () => {
		const blocked = plan();
		blocked.suggestions[0].blocked = "existing-zoom";
		const complete = vi.fn();
		const draft = await generateBundledNarration(blocked, complete);
		expect(draft.cues).toEqual([]);
		expect(complete).not.toHaveBeenCalled();
	});
	it("skips missing or empty lines and leaves no room for intro or outro when there is none", async () => {
		const complete = vi.fn(async () =>
			JSON.stringify({ intro: "Hi.", s1: "  ", outro: "Bye." }),
		);
		const draft = await generateBundledNarration(plan(), complete, "en", new Map(), {
			timelineEndMs: 3000,
		});
		expect(draft.cues).toEqual([]);
	});
	it("removes stray Chinese characters a small model leaks into Malay or English lines", async () => {
		const complete = vi.fn(async () =>
			JSON.stringify({ s1: "Nota dihantar secara elek舎tronik." }),
		);
		const draft = await generateBundledNarration(plan(), complete, "ms", new Map(), {
			timelineEndMs: 3000,
		});
		expect(draft.cues[0].text).toBe("Nota dihantar secara elektronik.");
	});
});
