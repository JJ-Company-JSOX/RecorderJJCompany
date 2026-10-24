import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingExportSave } from "./exportPersistence";
import { useExportDialogActions } from "./useExportDialogActions";

vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());

function harness() {
	const pending: PendingExportSave = {
		fileName: "export.mp4",
		tempFilePath: "/temp/completed.mp4",
	};
	const session = {
		pendingExportSaveRef: { current: pending as PendingExportSave | null },
		hasPendingExportSave: true,
		exportError: "ENOSPC: Choose another folder",
		setExportError: vi.fn(),
		setHasPendingExportSave: vi.fn(),
		setExportedFilePath: vi.fn(),
		setShowExportDropdown: vi.fn(),
	};
	const showExportSuccessToast = vi.fn();
	let actions!: ReturnType<typeof useExportDialogActions>;
	function Harness() {
		actions = useExportDialogActions({
			videoPath: "/video.mp4",
			videoPlaybackRef: { current: null },
			hasCaptionsForSidecar: false,
			settings: {} as Parameters<typeof useExportDialogActions>[0]["settings"],
			session: session as unknown as Parameters<typeof useExportDialogActions>[0]["session"],
			handleExport: vi.fn(),
			showExportSuccessToast,
		});
		return null;
	}
	renderToStaticMarkup(createElement(Harness));
	return { pending, session, actions, showExportSuccessToast };
}

describe("Save Again session recovery", () => {
	it("keeps a rejected save retryable and then saves the same completed render", async () => {
		const finalize = vi
			.fn()
			.mockRejectedValueOnce(new Error("EPERM: locked folder"))
			.mockResolvedValueOnce({ success: true, path: "/new-folder/output.mp4" });
		vi.stubGlobal("window", { electronAPI: { finalizeExportedVideo: finalize } });
		const { session, pending, actions, showExportSuccessToast } = harness();
		await expect(actions.handleRetrySaveExport()).resolves.toBeUndefined();
		expect(session.pendingExportSaveRef.current).toBe(pending);
		expect(session.setExportError).toHaveBeenLastCalledWith("EPERM: locked folder");
		await actions.handleRetrySaveExport();
		expect(session.pendingExportSaveRef.current).toBeNull();
		expect(session.setHasPendingExportSave).toHaveBeenCalledWith(false);
		expect(showExportSuccessToast).toHaveBeenCalledWith("/new-folder/output.mp4");
		expect(finalize.mock.calls[1]).toEqual(finalize.mock.calls[0]);
	});

	it("opens only one save dialog for rapid repeated retry clicks", async () => {
		let finish!: (result: { success: boolean; canceled: boolean }) => void;
		const finalize = vi.fn(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		vi.stubGlobal("window", { electronAPI: { finalizeExportedVideo: finalize } });
		const { actions, pending, session } = harness();
		const first = actions.handleRetrySaveExport();
		const second = actions.handleRetrySaveExport();
		expect(finalize).toHaveBeenCalledTimes(1);
		finish({ success: false, canceled: true });
		await Promise.all([first, second]);
		expect(session.pendingExportSaveRef.current).toBe(pending);
	});

	it("ignores a late save result after the pending render was replaced", async () => {
		let finish!: (result: { success: boolean; path: string }) => void;
		vi.stubGlobal("window", {
			electronAPI: {
				finalizeExportedVideo: () =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			},
		});
		const { session, actions, showExportSuccessToast } = harness();
		const saving = actions.handleRetrySaveExport();
		const replacement = { fileName: "next.mp4", tempFilePath: "/temp/next.mp4" };
		session.pendingExportSaveRef.current = replacement;
		finish({ success: true, path: "/old/output.mp4" });
		await saving;
		expect(session.pendingExportSaveRef.current).toBe(replacement);
		expect(session.setExportedFilePath).not.toHaveBeenCalled();
		expect(showExportSuccessToast).not.toHaveBeenCalled();
	});

	it("preserves the actual failure when reopening an export with pending media", () => {
		const { session, actions } = harness();
		actions.handleOpenExportDropdown();
		expect(session.setExportError).toHaveBeenCalledWith("ENOSPC: Choose another folder");
	});
});
