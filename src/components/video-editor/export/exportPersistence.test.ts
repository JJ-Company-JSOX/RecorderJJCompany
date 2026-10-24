import { afterEach, describe, expect, it, vi } from "vitest";
import { saveExportBlob, savePendingExport } from "./exportPersistence";

afterEach(() => vi.unstubAllGlobals());

function streamBridge() {
	const bridge = {
		openExportStream: vi.fn().mockResolvedValue({
			success: true,
			streamId: "stream-1",
			tempPath: "/temp/rendered.mp4",
		}),
		writeExportStreamChunk: vi.fn().mockResolvedValue({ success: true }),
		closeExportStream: vi.fn().mockResolvedValue({
			success: true,
			tempPath: "/temp/rendered.mp4",
		}),
		finalizeExportedVideo: vi.fn(),
		saveExportedVideo: vi.fn(),
		writeExportedVideoToPath: vi.fn(),
	};
	vi.stubGlobal("window", { electronAPI: bridge });
	return bridge;
}

describe("completed export save recovery", () => {
	it.each([
		"mp4",
		"gif",
	])("retains the completed %s temp file when finalization rejects, without a second save dialog", async (extension) => {
		const api = streamBridge();
		api.finalizeExportedVideo.mockRejectedValue(new Error("EACCES: folder is read-only"));
		const blob = new Blob(["rendered media"]);
		const captions = { format: "srt" as const, cues: [{ startMs: 0, endMs: 100, text: "Hi" }] };

		const result = await saveExportBlob(blob, `final.${extension}`, null, captions);

		expect(result.saveResult).toMatchObject({
			success: false,
			message: expect.stringContaining("EACCES"),
		});
		expect(result.pendingSave).toEqual({
			fileName: `final.${extension}`,
			tempFilePath: "/temp/rendered.mp4",
			captionSidecar: captions,
		});
		expect(api.openExportStream).toHaveBeenCalledTimes(1);
		expect(api.finalizeExportedVideo).toHaveBeenCalledTimes(1);
		expect(api.saveExportedVideo).not.toHaveBeenCalled();
		expect(api.writeExportedVideoToPath).not.toHaveBeenCalled();
	});

	it("keeps legacy export bytes retryable when the save IPC rejects", async () => {
		const saveExportedVideo = vi.fn().mockRejectedValue(new Error("Save dialog unavailable"));
		vi.stubGlobal("window", { electronAPI: { saveExportedVideo } });
		const result = await saveExportBlob(new Blob(["complete GIF"]), "final.gif");
		expect(result.saveResult).toMatchObject({
			success: false,
			message: "Save dialog unavailable",
		});
		expect(new TextDecoder().decode(result.pendingSave.arrayBuffer)).toBe("complete GIF");
	});

	it("retries the same rendered media and captions after a canceled save", async () => {
		const api = streamBridge();
		api.finalizeExportedVideo
			.mockResolvedValueOnce({ success: false, canceled: true })
			.mockResolvedValueOnce({ success: true, path: "/chosen/output.mp4" });
		const captions = {
			format: "both" as const,
			cues: [{ startMs: 100, endMs: 300, text: "Keep me" }],
		};
		const originalBytes = new TextEncoder().encode("complete rendered MP4");
		const first = await saveExportBlob(new Blob([originalBytes]), "output.mp4", null, captions);
		expect(first.saveResult.canceled).toBe(true);
		expect(await savePendingExport(first.pendingSave)).toMatchObject({
			success: true,
			path: "/chosen/output.mp4",
		});
		expect(api.writeExportStreamChunk.mock.calls[0][2]).toEqual(originalBytes);
		expect(api.openExportStream).toHaveBeenCalledTimes(1);
		expect(api.finalizeExportedVideo.mock.calls[1][0]).toEqual(
			api.finalizeExportedVideo.mock.calls[0][0],
		);
	});

	it("aborts an incomplete stream without allocating an MP4 fallback buffer", async () => {
		const api = streamBridge();
		api.writeExportStreamChunk.mockResolvedValue({ success: false, error: "ENOSPC" });
		await expect(saveExportBlob(new Blob(["incomplete"]), "output.mp4")).rejects.toThrow(
			"temp-file streaming",
		);
		expect(api.closeExportStream).toHaveBeenCalledWith("stream-1", { abort: true });
		expect(api.finalizeExportedVideo).not.toHaveBeenCalled();
		expect(api.saveExportedVideo).not.toHaveBeenCalled();
	});
});
