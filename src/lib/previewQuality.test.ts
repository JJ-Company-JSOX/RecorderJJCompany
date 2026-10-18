import { afterEach, describe, expect, it, vi } from "vitest";
import { getPreviewResolution } from "./previewQuality";

// Read the external-store snapshot without needing a DOM or rendering React.
vi.mock("react", () => ({
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

const KEY = "recordly.previewQuality";
function browserStorage(values = new Map<string, string>()) {
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	};
}

describe("preview quality persistence", () => {
	it.each([
		"full",
		"balanced",
	] as const)("retains %s after restarting with an empty browser origin", async (mode) => {
		const settings = new Map<string, unknown>();
		vi.stubGlobal("electronAPI", {
			getAppSetting: (key: string) => settings.get(key),
			setAppSetting: (key: string, value: unknown) => {
				settings.set(key, value);
				return true;
			},
		});
		vi.stubGlobal("localStorage", browserStorage());
		const initial = await import("./previewQuality");
		initial.setPreviewQuality(mode);
		expect(settings.get(KEY)).toBe(mode);

		// The packaged app's next random localhost port has fresh localStorage,
		// but the Electron settings store stays with the same user profile.
		vi.resetModules();
		vi.stubGlobal("localStorage", browserStorage());
		const restarted = await import("./previewQuality");
		expect(restarted.usePreviewQuality()).toBe(mode);
	});

	it("migrates the existing browser preference and then prioritizes app settings", async () => {
		const settings = new Map<string, unknown>();
		vi.stubGlobal("electronAPI", {
			getAppSetting: (key: string) => settings.get(key),
			setAppSetting: (key: string, value: unknown) => {
				settings.set(key, value);
				return true;
			},
		});
		vi.stubGlobal("localStorage", browserStorage(new Map([[KEY, "full"]])));
		vi.resetModules();
		expect((await import("./previewQuality")).usePreviewQuality()).toBe("full");
		expect(settings.get(KEY)).toBe("full");

		settings.set(KEY, "balanced");
		vi.resetModules();
		expect((await import("./previewQuality")).usePreviewQuality()).toBe("balanced");
	});

	it("keeps browser-only persistence when the settings API is unavailable", async () => {
		vi.stubGlobal("electronAPI", undefined);
		vi.stubGlobal("localStorage", browserStorage());
		vi.resetModules();
		(await import("./previewQuality")).setPreviewQuality("full");
		vi.resetModules();
		expect((await import("./previewQuality")).usePreviewQuality()).toBe("full");
	});

	it("defaults safely when persisted values are invalid and storage is inaccessible", async () => {
		vi.stubGlobal("electronAPI", {
			getAppSetting: () => "invalid",
			setAppSetting: () => false,
		});
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw Error("Unavailable storage");
			},
			setItem: () => {
				throw Error("Unavailable storage");
			},
		});
		vi.resetModules();
		const preview = await import("./previewQuality");
		expect(preview.usePreviewQuality()).toBe("balanced");
		expect(() => preview.setPreviewQuality("full")).not.toThrow();
		expect(preview.usePreviewQuality()).toBe("full");
	});
});

describe("preview resolution budget", () => {
	it("caps high DPI preview work while retaining CSS geometry", () => {
		expect(getPreviewResolution(900, 500, 2, "balanced")).toBe(1);
		expect(getPreviewResolution(2560, 1440, 2, "balanced")).toBe(0.5);
	});
	it("allows full display density and handles invalid density", () => {
		expect(getPreviewResolution(900, 500, 2, "full")).toBe(2);
		expect(getPreviewResolution(0, 0, Number.NaN, "balanced")).toBe(1);
	});
});
