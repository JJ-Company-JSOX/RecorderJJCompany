import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ value: null as unknown, writable: true }));
vi.mock("@/lib/appSettings", () => ({
	loadAppSetting: () => storage.value,
	saveAppSetting: (_key: string, value: unknown) => {
		if (!storage.writable) return false;
		storage.value = value;
		return true;
	},
}));
import {
	consumeStoryIntent,
	discardStoryIntent,
	refreshStoryIntent,
	stageStoryIntent,
} from "./storyIntent";
const now = 100000000;
beforeEach(() => {
	storage.value = null;
	storage.writable = true;
});
describe("launcher creative request handoff", () => {
	it("keeps a brief typed before a recording longer than 30 minutes", () => {
		const id = stageStoryIntent("Introduce the product", undefined, now);
		for (let minute = 1; minute <= 45; minute++) refreshStoryIntent(id, now + minute * 60_000);
		expect(consumeStoryIntent("C:/rec/long.mp4", now + 46 * 60_000)?.brief.topic).toBe(
			"Introduce the product",
		);
	});
	it("does not bring back a request that was consumed or replaced", () => {
		const id = stageStoryIntent("First recording", undefined, now);
		expect(consumeStoryIntent("C:/rec/a.mp4", now + 1000)).not.toBeNull();
		refreshStoryIntent(id, now + 2000);
		expect(storage.value).toBeNull();
		const old = stageStoryIntent("Old request", undefined, now);
		stageStoryIntent("Newer import", "C:/rec/b.mp4", now + 10);
		refreshStoryIntent(old, now + 20);
		expect((storage.value as { prompt: string }).prompt).toBe("Newer import");
	});
	it("moves a confirmed media request into a new story workspace exactly once", () => {
		const id = stageStoryIntent(
			" Introduce my offline product to first-time customers. ",
			"C:\\Video\\demo.mp4",
			now,
		);
		expect(id).toBeTruthy();
		const workspace = consumeStoryIntent("c:/video/DEMO.mp4", now + 1000);
		expect(workspace).toMatchObject({
			storyMode: true,
			approved: false,
			draft: null,
			brief: {
				topic: "Introduce my offline product to first-time customers.",
				facts: "",
				notes: "",
			},
		});
		expect(storage.value).toBeNull();
		expect(consumeStoryIntent("c:/video/demo.mp4", now + 2000)).toBeNull();
	});
	it("does not attach an imported video's request to unrelated media", () => {
		stageStoryIntent("A product introduction", "/chosen/demo.mp4", now);
		expect(consumeStoryIntent("/unrelated/demo.mp4", now)).toBeNull();
		expect(consumeStoryIntent("/chosen/demo.mp4", now)?.storyMode).toBe(true);
	});
	it("accepts an activated recording request when its finalized path becomes available", () => {
		stageStoryIntent("A narrated demonstration", undefined, now);
		expect(consumeStoryIntent("C:\\recordings\\new.mp4", now + 5000)?.brief.topic).toBe(
			"A narrated demonstration",
		);
	});
	it("an explicit cancel discards only its own token and preserves a newer request", () => {
		const first = stageStoryIntent("First recording", undefined, now);
		const second = stageStoryIntent("New import", "/new.mp4", now);
		discardStoryIntent(first);
		expect(consumeStoryIntent("/new.mp4", now)?.brief.topic).toBe("New import");
		stageStoryIntent("Canceled recording", undefined, now);
		const pending = storage.value as { id: string };
		discardStoryIntent(pending.id);
		expect(storage.value).toBeNull();
		expect(second).not.toBe(first);
	});
	it("rejects expired, future and malformed requests rather than starting AI or changing a project", () => {
		stageStoryIntent("Expired", undefined, now);
		expect(consumeStoryIntent("/new.mp4", now + 30 * 60 * 1000 + 1)).toBeNull();
		stageStoryIntent("Future", undefined, now);
		expect(consumeStoryIntent("/new.mp4", now - 1)).toBeNull();
		storage.value = { version: 1, id: "bad", createdAt: now, prompt: "x".repeat(2001) };
		expect(consumeStoryIntent("/new.mp4", now)).toBeNull();
	});
	it("bounds the prompt and leaves a failed storage write unclaimed", () => {
		stageStoryIntent("x".repeat(3000), undefined, now);
		expect(consumeStoryIntent("/new.mp4", now)?.brief.topic).toHaveLength(2000);
		stageStoryIntent("Cannot consume yet", undefined, now);
		storage.writable = false;
		expect(consumeStoryIntent("/new.mp4", now)).toBeNull();
	});
	it("empty confirmed input clears an older pending request", () => {
		stageStoryIntent("Old request", undefined, now);
		expect(stageStoryIntent("   ", "/other.mp4", now)).toBeNull();
		expect(storage.value).toBeNull();
	});
});
