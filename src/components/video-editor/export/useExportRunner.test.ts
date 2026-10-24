import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportSettings } from "@/lib/exporter/types";
import type { ExportRunnerInput } from "./exportRunnerSupport";
import { useExportRunner } from "./useExportRunner";

const rendered = vi.hoisted(() => ({ export: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/exporter/gifExporter", () => ({
	GifExporter: class {
		export = rendered.export;
		cancel = rendered.cancel;
	},
}));
vi.mock("@/lib/exporter/modernVideoExporter", () => ({
	ModernVideoExporter: class {
		export = rendered.export;
		cancel = rendered.cancel;
	},
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function harness() {
	const session = {
		exportRunIdRef: { current: 0 },
		cancelledExportRunIdRef: { current: null },
		exporterRef: { current: null },
		pendingExportSaveRef: { current: null },
		setIsExporting: vi.fn(),
		setExportProgress: vi.fn(),
		setExportError: vi.fn(),
		setShowExportDropdown: vi.fn(),
		setExportedFilePath: vi.fn(),
		setHasPendingExportSave: vi.fn(),
		clearPendingExportSave: vi.fn(),
		markExportAsSaving: vi.fn(),
	};
	const input = {
		videoPath: "/input.mp4",
		videoPlaybackRef: { current: { video: { currentTime: 2 } } },
		isPlaying: false,
		appearance: { webcam: {} },
		timeline: { audioRegions: [], clipRegions: [], selectedClipId: null },
		exportSettings: {
			exportQuality: "medium",
			exportEncodingMode: "balanced",
			exportPipelineModel: "modern",
			mp4FrameRate: 30,
		},
		exportSession: session,
		audio: {},
		smokeExportConfig: { enabled: false },
		effectiveSpeedRegions: [],
		effectiveZoomRegions: [],
		effectiveCursorTelemetry: [],
		effectiveShowCursor: false,
		ensureSupportedMp4SourceDimensions: vi.fn().mockResolvedValue({ width: 160, height: 90 }),
		remountPreview: vi.fn(),
	} as unknown as ExportRunnerInput;
	let runner!: ReturnType<typeof useExportRunner>;
	function Harness() {
		runner = useExportRunner(input);
		return null;
	}
	renderToStaticMarkup(createElement(Harness));
	return { runner, session };
}

describe("rendered export save failures", () => {
	it.each([
		"gif",
		"mp4",
	] as const)("keeps %s output and the error dialog available after a save failure", async (format) => {
		rendered.export.mockResolvedValue({ success: true, blob: new Blob(["complete render"]) });
		const finalize = vi.fn().mockRejectedValue(new Error("EACCES: choose a writable folder"));
		vi.stubGlobal("window", {
			electronAPI: {
				openExportStream: async () => ({
					success: true,
					streamId: "stream",
					tempPath: "/temp/rendered",
				}),
				writeExportStreamChunk: async () => ({ success: true }),
				closeExportStream: async () => ({ success: true, tempPath: "/temp/rendered" }),
				finalizeExportedVideo: finalize,
			},
		});
		const { runner, session } = harness();
		await runner.handleExport({
			format,
			gifConfig:
				format === "gif"
					? { width: 160, height: 90, frameRate: 15, loop: true, sizePreset: "medium" }
					: undefined,
		} as ExportSettings);
		expect(session.pendingExportSaveRef.current).toMatchObject({
			tempFilePath: "/temp/rendered",
		});
		expect(session.setHasPendingExportSave).toHaveBeenLastCalledWith(true);
		expect(session.setExportError).toHaveBeenLastCalledWith("EACCES: choose a writable folder");
		expect(session.setShowExportDropdown).toHaveBeenLastCalledWith(true);
		expect(session.setIsExporting).toHaveBeenLastCalledWith(false);
		expect(rendered.export).toHaveBeenCalledTimes(1);
	});

	it("keeps a native MP4 temp file retryable when save IPC rejects", async () => {
		rendered.export.mockResolvedValue({ success: true, tempFilePath: "/temp/native.mp4" });
		vi.stubGlobal("window", {
			electronAPI: {
				finalizeExportedVideo: async () => {
					throw new Error("EPERM: destination locked");
				},
			},
		});
		const { runner, session } = harness();
		await runner.handleExport({ format: "mp4" } as ExportSettings);
		expect(session.pendingExportSaveRef.current).toMatchObject({
			tempFilePath: "/temp/native.mp4",
		});
		expect(session.setHasPendingExportSave).toHaveBeenLastCalledWith(true);
		expect(session.setExportError).toHaveBeenLastCalledWith("EPERM: destination locked");
		expect(session.setShowExportDropdown).toHaveBeenLastCalledWith(true);
	});
});
