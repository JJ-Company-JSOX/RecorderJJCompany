import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditPlan } from "../../../src/components/video-editor/auto-edit/plan";
import { inspectLocalModel, LocalPlanReviewer } from "./reviewer";

const mock = vi.hoisted(() => ({
	requests: [] as { hostname: string; port: number; path: string; body: string }[],
	remote: false,
	missingLicense: false,
	expanded: false,
	redirect: false,
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
						statusCode: mock.redirect ? 302 : 200,
						setEncoding: () => undefined,
						resume: () => undefined,
					});
					callback(res);
					const reply =
						options.path === "/api/tags"
							? {
									models: [
										{
											name: "local:latest",
											size: 1_000_000,
											...(mock.remote
												? { remote_host: "https://cloud.invalid" }
												: {}),
										},
									],
								}
							: options.path === "/api/show"
								? { model_info: {}, license: mock.missingLicense ? "" : "MIT" }
								: {
										message: {
											content: JSON.stringify({
												edits: [
													{
														id: "rule-1",
														startMs: mock.expanded ? 0 : 1100,
														endMs: 1900,
													},
												],
											}),
										},
									};
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
	mock.remote = false;
	mock.missingLicense = false;
	mock.expanded = false;
	mock.redirect = false;
});
const plan = (): EditPlan => ({
	version: 1,
	id: "plan",
	coordinateSpace: "timeline-ms",
	baseline: "private path /local/user.mp4 and transcript",
	warnings: [],
	reviewer: "rules",
	suggestions: [
		{
			id: "rule-1",
			kind: "annotation",
			reason: "transcript",
			startMs: 1000,
			endMs: 2000,
			text: "PRIVATE TRANSCRIPT",
		},
	],
});

describe("local-only model adapter (mock service, no inference claim)", () => {
	it("inspects installed size and license without downloading a model", async () => {
		expect(await inspectLocalModel("local")).toEqual({
			name: "local:latest",
			sizeBytes: 1_000_000,
			license: "MIT",
		});
		expect(mock.requests.map((r) => r.path)).toEqual(["/api/tags", "/api/show"]);
	});
	it("sends only rule IDs/types/times/reasons to a fixed loopback address", async () => {
		const original = plan(),
			next = await new LocalPlanReviewer().review(original, "local");
		expect(next.suggestions[0]).toMatchObject({
			startMs: 1100,
			endMs: 1900,
			text: "PRIVATE TRANSCRIPT",
		});
		expect(original.suggestions[0].startMs).toBe(1000);
		for (const request of mock.requests) {
			expect(request.hostname).toBe("127.0.0.1");
			expect(request.port).toBe(11434);
		}
		const body = mock.requests.find((r) => r.path === "/api/chat")!.body;
		expect(body).not.toContain("PRIVATE TRANSCRIPT");
		expect(body).not.toContain("/local/user.mp4");
		expect(body).not.toContain("baseline");
	});
	it.each([
		"remote-cloud",
		"model:cloud",
		"../bad name",
		"",
	])("rejects cloud/invalid model names before sending the plan: %s", async (model) => {
		await expect(new LocalPlanReviewer().review(plan(), model)).rejects.toThrow();
		expect(mock.requests).toHaveLength(0);
	});
	it("rejects a remote model alias even if its name looks local", async () => {
		mock.remote = true;
		await expect(new LocalPlanReviewer().review(plan(), "local")).rejects.toThrow();
		expect(mock.requests.some((r) => r.path === "/api/chat")).toBe(false);
	});
	it("rejects missing license metadata and never follows redirects", async () => {
		mock.missingLicense = true;
		await expect(inspectLocalModel("local")).rejects.toThrow();
		mock.redirect = true;
		await expect(inspectLocalModel("local")).rejects.toThrow();
		expect(mock.requests.some((r) => r.hostname !== "127.0.0.1")).toBe(false);
	});
	it("refuses AI expansion of the rule's evidence range", async () => {
		mock.expanded = true;
		await expect(new LocalPlanReviewer().review(plan(), "local")).rejects.toThrow("expanded");
	});
});
