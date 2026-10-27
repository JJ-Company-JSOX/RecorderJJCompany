import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
	packaged: true,
	marker: false,
	clientMarker: false,
	checkForUpdates: vi.fn(),
	showMessageBox: vi.fn(async () => ({ response: 0 })),
	existsSync: vi.fn(),
}));
vi.mock("node:fs", () => ({
	default: { existsSync: fixture.existsSync, mkdirSync: vi.fn(), appendFileSync: vi.fn() },
}));
vi.mock("electron", () => ({
	app: {
		get isPackaged() {
			return fixture.packaged;
		},
		getVersion: () => "1.4.0",
	},
	BrowserWindow: class {},
	dialog: { showMessageBox: fixture.showMessageBox },
}));
vi.mock("electron-updater", () => ({
	autoUpdater: { checkForUpdates: fixture.checkForUpdates },
}));
vi.mock("./appPaths", () => ({ USER_DATA_PATH: "test-user-data" }));
vi.mock("./appSettingsStore", () => ({ readAppSetting: vi.fn(), writeAppSetting: vi.fn() }));

const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, "resourcesPath");
beforeEach(() => {
	vi.resetModules();
	vi.stubEnv("RECORDLY_DISABLE_AUTO_UPDATES", "");
	Object.defineProperty(process, "resourcesPath", {
		value: "test-resources",
		configurable: true,
	});
	fixture.packaged = true;
	fixture.marker = false;
	fixture.clientMarker = false;
	fixture.existsSync.mockImplementation((file: string) =>
		file.endsWith("offline-ai-preview.txt")
			? fixture.marker
			: file.endsWith("complete-client.txt")
				? fixture.clientMarker
				: false,
	);
	fixture.checkForUpdates.mockClear();
	fixture.showMessageBox.mockClear();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
	if (resourcesDescriptor) Object.defineProperty(process, "resourcesPath", resourcesDescriptor);
	else Reflect.deleteProperty(process, "resourcesPath");
});

it("disables updates on direct offline preview launches without launcher environment variables", async () => {
	fixture.marker = true;
	const updater = await import("./updater");
	expect(updater.isAutoUpdateFeatureEnabled()).toBe(false);
	updater.setupAutoUpdates(
		() => null,
		() => true,
	);
	await updater.checkForAppUpdates(() => null, { manual: true });
	expect(fixture.showMessageBox).toHaveBeenCalledWith(
		expect.objectContaining({ detail: expect.stringContaining("complete package updates") }),
	);
	expect(fixture.checkForUpdates).not.toHaveBeenCalled();
});

it("retains the normal update feature in generic packages and development builds", async () => {
	expect((await import("./updater")).isAutoUpdateFeatureEnabled()).toBe(true);
	vi.resetModules();
	fixture.packaged = false;
	fixture.marker = true;
	expect((await import("./updater")).isAutoUpdateFeatureEnabled()).toBe(true);
});

it("keeps a complete ZIP client away from the generic NSIS update feed", async () => {
	fixture.clientMarker = true;
	const updater = await import("./updater");
	expect(updater.isAutoUpdateFeatureEnabled()).toBe(false);
	await updater.checkForAppUpdates(() => null);
	expect(fixture.checkForUpdates).not.toHaveBeenCalled();
});

it("retains the explicit environment opt-out for every edition", async () => {
	vi.stubEnv("RECORDLY_DISABLE_AUTO_UPDATES", "1");
	expect((await import("./updater")).isAutoUpdateFeatureEnabled()).toBe(false);
});
