import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:https", () => ({ get: vi.fn() }));
vi.mock("./bundledSpeech", () => ({ getBundledSpeechStatus: async () => ({ available: false }) }));
vi.mock("../constants", async () => {
	const fs = await import("node:fs/promises");
	const os = await import("node:os");
	const path = await import("node:path");
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jsox-whisper-download-"));
	return {
		WHISPER_MODEL_DIR: dir,
		WHISPER_SMALL_MODEL_PATH: path.join(dir, "ggml-small.bin"),
		WHISPER_MODEL_DOWNLOAD_URL: "https://model.invalid/model.bin",
	};
});

import { get } from "node:https";
import { WHISPER_MODEL_DIR, WHISPER_SMALL_MODEL_PATH } from "../constants";
import {
	cancelWhisperModelDownload,
	downloadWhisperSmallModel,
	getWhisperSmallModelStatus,
} from "./whisper";

function response() {
	const stream = new PassThrough() as PassThrough & {
		statusCode: number;
		headers: Record<string, string>;
	};
	stream.statusCode = 200;
	stream.headers = { "content-length": "4" };
	vi.mocked(get).mockImplementation((_url, options, callback) => {
		const request = new EventEmitter() as EventEmitter & { destroy: (e: Error) => void };
		request.destroy = (error) => {
			stream.destroy(error);
			request.emit("error", error);
		};
		const signal = (options as { signal: AbortSignal }).signal;
		signal.addEventListener(
			"abort",
			() => request.destroy(Object.assign(new Error("Canceled"), { name: "AbortError" })),
			{ once: true },
		);
		queueMicrotask(() => callback!(stream as never));
		return request as never;
	});
	return stream;
}
function owner(id: number) {
	return Object.assign(new EventEmitter(), {
		id,
		isDestroyed: () => false,
		send: vi.fn(),
	}) as unknown as Electron.WebContents;
}
afterAll(async () => {
	await fs.rm(WHISPER_MODEL_DIR, { recursive: true, force: true });
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(WHISPER_SMALL_MODEL_PATH, { force: true });
	await fs.rm(`${WHISPER_SMALL_MODEL_PATH}.download`, { force: true });
});

describe("explicit speech model downloads", () => {
	it("discloses the actual destination without starting a network request", async () => {
		const status = await getWhisperSmallModelStatus();
		expect(status).toMatchObject({ exists: false, downloadPath: WHISPER_SMALL_MODEL_PATH });
		expect(get).not.toHaveBeenCalled();
	});
	it("publishes the model only after all bytes have been written", async () => {
		const stream = response();
		const client = owner(10);
		const job = downloadWhisperSmallModel(client);
		await vi.waitFor(() => expect(get).toHaveBeenCalled());
		stream.write(Buffer.from([1, 2]));
		await expect(fs.access(WHISPER_SMALL_MODEL_PATH)).rejects.toThrow();
		stream.end(Buffer.from([3, 4]));
		await expect(job).resolves.toBe(WHISPER_SMALL_MODEL_PATH);
		expect([...(await fs.readFile(WHISPER_SMALL_MODEL_PATH))]).toEqual([1, 2, 3, 4]);
		expect(client.send).toHaveBeenLastCalledWith(
			"whisper-small-model-download-progress",
			expect.objectContaining({ status: "downloaded", progress: 100 }),
		);
	});
	it("only lets the owning window cancel and removes partial data before allowing retry", async () => {
		vi.mocked(get).mockClear();
		const stream = response();
		const client = owner(20);
		const job = downloadWhisperSmallModel(client);
		const rejected = expect(job).rejects.toMatchObject({ name: "AbortError" });
		await vi.waitFor(() => expect(get).toHaveBeenCalled());
		stream.write(Buffer.from([1]));
		expect(cancelWhisperModelDownload(99)).toBe(false);
		await expect(downloadWhisperSmallModel(owner(99))).rejects.toThrow("already running");
		expect(cancelWhisperModelDownload(20)).toBe(true);
		await rejected;
		await expect(fs.access(WHISPER_SMALL_MODEL_PATH)).rejects.toThrow();
		await expect(fs.access(`${WHISPER_SMALL_MODEL_PATH}.download`)).rejects.toThrow();
		expect(cancelWhisperModelDownload(20)).toBe(false);
		expect(client.send).toHaveBeenLastCalledWith(
			"whisper-small-model-download-progress",
			expect.objectContaining({ status: "idle" }),
		);
		vi.mocked(get).mockClear();
		const next = response();
		const retry = downloadWhisperSmallModel(client);
		await vi.waitFor(() => expect(get).toHaveBeenCalled());
		next.end(Buffer.from([1, 2, 3, 4]));
		await expect(retry).resolves.toBe(WHISPER_SMALL_MODEL_PATH);
	});
});
