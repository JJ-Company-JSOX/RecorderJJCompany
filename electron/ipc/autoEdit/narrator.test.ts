import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditPlan } from "../../../src/components/video-editor/auto-edit/plan";
import { LocalNarrationGenerator } from "./narrator";

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
			{ id: "rule-1", startMs: 1000, endMs: 2000, text: "Clicking here to zoom in on the detail." },
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
