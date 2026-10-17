import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	exec: vi.fn(),
	sources: vi.fn(),
	mac: vi.fn(),
	dip: vi.fn(),
}));
vi.mock("electron", () => ({ systemPreferences: { getMediaAccessStatus: () => "granted" } }));
vi.mock("node:util", () => ({ promisify: () => mocks.exec }));
vi.mock("./cursor/bounds", () => ({
	getNativeMacWindowsFrontToBack: mocks.mac,
}));
vi.mock("./register/sources", () => ({ getDesktopSources: mocks.sources }));
vi.mock("./utils", () => ({
	parseWindowId: (id?: string) => Number(id?.split(":")[1]),
	getScreen: () => ({ screenToDipRect: mocks.dip }),
}));
import { listCapturePickerWindows } from "./capturePickerSources";
const platform = process.platform;
afterEach(() => Object.defineProperty(process, "platform", { value: platform }));
beforeEach(() => {
	vi.resetAllMocks();
	mocks.sources.mockResolvedValue([
		{ id: "window:101:0", name: "Front" },
		{ id: "window:102:0", name: "Back" },
	]);
});
describe("capture picker source adapters", () => {
	it("keeps Linux window selection on its source list without X11 helper probes", async () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		await expect(listCapturePickerWindows()).rejects.toThrow("Use the source list on Linux");
		expect(mocks.exec).not.toHaveBeenCalled();
	});
	it("matches Windows handles to real capture IDs and converts physical bounds to DIP", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		mocks.exec.mockResolvedValue({
			stdout: JSON.stringify([
				{ id: 999, x: 0, y: 0, width: 20, height: 20 },
				{ id: 101, x: -1600, y: 0, width: 800, height: 600 },
			]),
		});
		mocks.dip.mockReturnValue({ x: -800, y: 0, width: 400, height: 300 });
		expect(await listCapturePickerWindows()).toEqual([
			{
				id: "window:101:0",
				appName: "",
				title: "Front",
				display_id: undefined,
				x: -800,
				y: 0,
				width: 400,
				height: 300,
			},
		]);
		expect(mocks.dip).toHaveBeenCalledWith(null, expect.objectContaining({ x: -1600 }));
		const [, args, options] = mocks.exec.mock.calls[0];
		expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
		expect(Buffer.from(args[3], "base64").toString("utf16le")).toContain(
			'DllImport("user32.dll")',
		);
		expect(options).toMatchObject({ windowsHide: true, timeout: 10000 });
	});
	// Machine policy can disable Add-Type even when Electron screen capture is
	// available. Screen picks must still work without optional window bounds.
	it("keeps full-screen picking available when the Windows geometry helper fails", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		mocks.exec.mockRejectedValue(
			Object.assign(new Error("command failed"), { stderr: "Add-Type blocked" }),
		);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			await expect(listCapturePickerWindows()).resolves.toEqual([]);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("full-screen selection"),
				"Add-Type blocked",
			);
		} finally {
			warn.mockRestore();
		}
	});
	it("skips the Windows helper when Electron exposes no capturable windows", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		mocks.sources.mockResolvedValue([]);
		await expect(listCapturePickerWindows()).resolves.toEqual([]);
		expect(mocks.exec).not.toHaveBeenCalled();
	});
	it("ignores malformed geometry entries instead of failing the picker", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		mocks.exec.mockResolvedValue({
			stdout: JSON.stringify([null, "bad", { id: 101, width: -1 }]),
		});
		await expect(listCapturePickerWindows()).resolves.toEqual([]);
	});
	it("excludes Recordly's own macOS windows and invalid geometry", async () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		mocks.mac.mockResolvedValue([
			{ id: "window:1:0", ownerPid: process.pid, x: 0, y: 0, width: 10, height: 10 },
			{ id: "window:2:0", ownerPid: 99, name: "Other", x: 0, y: 0, width: 400, height: 300 },
			{ id: "window:3:0", width: Number.NaN },
		]);
		expect((await listCapturePickerWindows()).map((entry) => entry.id)).toEqual(["window:2:0"]);
	});
});
