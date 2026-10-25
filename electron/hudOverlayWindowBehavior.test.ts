import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
	listeners: new Map<string, (...args: unknown[]) => unknown>(),
	windows: [] as unknown[],
	screen: {
		getPrimaryDisplay: vi.fn(),
		getDisplayMatching: vi.fn(),
		on: vi.fn(),
		removeListener: vi.fn(),
	},
}));
vi.mock("node:module", async (original) => {
	const actual = await original<typeof import("node:module")>();
	return {
		...actual,
		createRequire: (url: string) => {
			const require = actual.createRequire(url);
			return (name: string) =>
				name === "electron" ? { screen: fixture.screen } : require(name);
		},
	};
});
vi.mock("./appPaths", () => ({ USER_DATA_PATH: "/tmp/recordly-window-behavior-fixture" }));
vi.mock("./rendererServer", () => ({ getPackagedRendererBaseUrl: () => null }));
vi.mock("electron", async () => {
	const { EventEmitter } = await import("node:events");
	class Window extends EventEmitter {
		webContents = Object.assign(new EventEmitter(), {
			isDestroyed: () => false,
			send: vi.fn(),
		});
		visible = false;
		destroyed = false;
		top: boolean;
		bounds: Record<string, number>;
		setIgnoreMouseEvents = vi.fn();
		setContentProtection = vi.fn();
		setVisibleOnAllWorkspaces = vi.fn();
		moveTop = vi.fn();
		minimize = vi.fn();
		setAlwaysOnTop = vi.fn((top: boolean) => {
			this.top = top;
		});
		loadFile = vi.fn();
		loadURL = vi.fn();
		constructor(public options: Record<string, unknown>) {
			super();
			this.top = Boolean(options.alwaysOnTop);
			this.bounds = Object.fromEntries(
				["x", "y", "width", "height"].map((key) => [key, Number(options[key])]),
			);
			fixture.windows.push(this);
		}
		setBounds(bounds: Record<string, number>) {
			this.bounds = bounds;
		}
		getBounds() {
			return this.bounds;
		}
		isDestroyed() {
			return this.destroyed;
		}
		isVisible() {
			return this.visible;
		}
		isAlwaysOnTop() {
			return this.top;
		}
		showInactive() {
			this.visible = true;
			this.emit("show");
		}
		show() {
			this.showInactive();
		}
		close() {
			this.destroyed = true;
			this.visible = false;
			this.emit("closed");
		}
	}
	return {
		app: { isReady: () => true },
		BrowserWindow: Window,
		ipcMain: {
			on: (name: string, listener: (...args: unknown[]) => unknown) =>
				fixture.listeners.set(name, listener),
			handle: vi.fn(),
			removeListener: vi.fn(),
		},
	};
});

import {
	createHudOverlayWindow,
	getHudOverlayWindow,
	reassertHudOverlayMousePassthrough,
	setHudOverlayRecordingActive,
} from "./windows";

const platform = process.platform;
const workArea = { x: -1920, y: 40, width: 1920, height: 1040 };
beforeEach(() => {
	vi.useFakeTimers();
	Object.defineProperty(process, "platform", { value: "win32" });
	fixture.screen.getPrimaryDisplay.mockReturnValue({ workArea });
	fixture.screen.getDisplayMatching.mockReturnValue({ workArea });
	vi.clearAllMocks();
});
afterEach(() => {
	getHudOverlayWindow()?.close();
	vi.clearAllTimers();
	vi.useRealTimers();
	Object.defineProperty(process, "platform", { value: platform });
});

describe("Windows recording setup window interaction", () => {
	it("opens the full setup as a bounded, non-topmost, clickable window", () => {
		const win = createHudOverlayWindow();
		expect(win.isAlwaysOnTop()).toBe(false);
		expect(win.getBounds().width).toBeLessThan(workArea.width);
		expect(win.getBounds().height).toBeLessThan(workArea.height);
		fixture.listeners.get("hud-overlay-set-ignore-mouse")!({ sender: win.webContents }, true);
		expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
	});
	it("does not raise setup above other applications when bounds are refreshed", () => {
		const win = createHudOverlayWindow();
		fixture.listeners.get("hud-overlay-renderer-ready")!();
		vi.mocked(win.moveTop).mockClear();
		fixture.listeners.get("hud-overlay-set-setup-visible")!({ sender: win.webContents }, true);
		expect(win.moveTop).not.toHaveBeenCalled();
	});
	it("restores overlay behavior for the ready bar and keeps active recording above apps", () => {
		const win = createHudOverlayWindow();
		fixture.listeners.get("hud-overlay-set-setup-visible")!({ sender: win.webContents }, false);
		const immediateMouseUpdates = vi.mocked(win.setIgnoreMouseEvents).mock.calls.length;
		vi.advanceTimersByTime(60);
		expect(vi.mocked(win.setIgnoreMouseEvents).mock.calls.length).toBeGreaterThan(
			immediateMouseUpdates,
		);
		expect(win.isAlwaysOnTop()).toBe(true);
		expect(win.getBounds()).toEqual(workArea);
		fixture.listeners.get("hud-overlay-set-ignore-mouse")!({ sender: win.webContents }, true);
		expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
		setHudOverlayRecordingActive(true);
		fixture.listeners.get("hud-overlay-set-setup-visible")!({ sender: win.webContents }, true);
		expect(win.isAlwaysOnTop()).toBe(true);
	});
	it("returns to interactive setup even after Windows mouse forwarding is reset", () => {
		const win = createHudOverlayWindow();
		fixture.listeners.get("hud-overlay-set-setup-visible")!({ sender: win.webContents }, false);
		fixture.listeners.get("hud-overlay-set-setup-visible")!({ sender: win.webContents }, true);
		reassertHudOverlayMousePassthrough();
		vi.advanceTimersByTime(60);
		expect(win.isAlwaysOnTop()).toBe(false);
		expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
	});
});
