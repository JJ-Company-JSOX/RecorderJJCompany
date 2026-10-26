import { BrowserWindow, dialog } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
	root: "/tmp/recordly-dialog-fixture",
}));

vi.mock("electron", () => ({
	app: {
		once: vi.fn(),
		getPath: () => fixture.root,
		getAppPath: () => process.cwd(),
		isPackaged: false,
	},
	BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn(() => []) },
	dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
			fixture.handlers.set(channel, handler),
		on: vi.fn(),
	},
	shell: {},
}));
vi.mock("../utils", async (original) => ({
	...(await original<object>()),
	getRecordingsDir: async () => fixture.root,
}));
vi.mock("../project/manager", async (original) => ({
	...(await original<object>()),
	getProjectsDir: async () => fixture.root,
}));

import { registerCaptionHandlers } from "./captions";
import { registerProjectHandlers } from "./project";

const owner = {
	isDestroyed: vi.fn(() => false),
	isAlwaysOnTop: vi.fn(() => true),
	setAlwaysOnTop: vi.fn(),
	focus: vi.fn(),
	moveTop: vi.fn(),
	hide: vi.fn(),
};

beforeEach(() => {
	vi.clearAllMocks();
	fixture.handlers.clear();
	owner.isDestroyed.mockReturnValue(false);
	vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(owner as unknown as BrowserWindow);
	vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });
	vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: "" });
	registerCaptionHandlers();
	registerProjectHandlers();
});

describe("native file dialog ownership", () => {
	it.each([
		["open-video-file-picker", "Import Media or Recordly Project", [{ includeProjects: true }]],
		["open-audio-file-picker", "Select Audio File", []],
		["open-whisper-executable-picker", "Select Whisper Executable", []],
		["open-whisper-model-picker", "Select Whisper Model", []],
		["choose-recordings-directory", "Choose recordings folder", []],
		["load-project-file", "Open Recordly Project", []],
		[
			"save-project-file",
			"Save Recordly Project",
			[{ version: 2, videoPath: "/video.mp4", editor: {} }],
		],
	])("%s attaches its native dialog to the requesting window", async (channel, title, args) => {
		const sender = { id: 42 };
		const result = await fixture.handlers.get(channel as string)!(
			{ sender },
			...(args as unknown[]),
		);
		const show =
			channel === "save-project-file" ? dialog.showSaveDialog : dialog.showOpenDialog;
		expect(show).toHaveBeenCalledWith(owner, expect.objectContaining({ title }));
		expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(sender);
		expect(result).toMatchObject({ success: false, canceled: true });
		// Changing native HUD visibility/focus can break Windows mouse forwarding.
		expect(owner.setAlwaysOnTop).not.toHaveBeenCalled();
		expect(owner.focus).not.toHaveBeenCalled();
		expect(owner.moveTop).not.toHaveBeenCalled();
		expect(owner.hide).not.toHaveBeenCalled();
	});

	it.each([
		"missing",
		"destroyed",
	])("cancels instead of opening a detached dialog for a %s owner", async (kind) => {
		if (kind === "missing") vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);
		else owner.isDestroyed.mockReturnValue(true);
		const result = await fixture.handlers.get("open-video-file-picker")!({
			sender: { id: 42 },
		});
		expect(result).toEqual({ success: false, canceled: true });
		expect(dialog.showOpenDialog).not.toHaveBeenCalled();
		const saved = await fixture.handlers.get("save-project-file")!(
			{ sender: { id: 42 } },
			{ version: 2, videoPath: "/video.mp4", editor: {} },
		);
		expect(saved).toMatchObject({ success: false, canceled: true });
		expect(dialog.showSaveDialog).not.toHaveBeenCalled();
	});

	it("parents each dialog to its own sender in a multi-window session", async () => {
		const firstSender = { id: 1 };
		const secondSender = { id: 2 };
		const secondOwner = { isDestroyed: () => false };
		vi.mocked(BrowserWindow.fromWebContents).mockImplementation(
			(sender) => (sender === firstSender ? owner : secondOwner) as unknown as BrowserWindow,
		);
		await fixture.handlers.get("open-video-file-picker")!({ sender: firstSender });
		await fixture.handlers.get("open-audio-file-picker")!({ sender: secondSender });
		expect(dialog.showOpenDialog).toHaveBeenNthCalledWith(
			1,
			owner,
			expect.objectContaining({ title: "Select Video File" }),
		);
		expect(dialog.showOpenDialog).toHaveBeenNthCalledWith(
			2,
			secondOwner,
			expect.objectContaining({ title: "Select Audio File" }),
		);
	});
});
