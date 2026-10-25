import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function setup(page: Page, holdInitial = false) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(
		page,
		(holdInitial) => {
			localStorage.setItem("recordly.locale", "en");
			window.electronAPI.getPlatform = async () => "win32";
			window.electronAPI.getRecordingPreferences = async () => ({
				success: true,
				microphoneEnabled: false,
				webcamEnabled: false,
				systemAudioEnabled: false,
			});
			window.electronAPI.setRecordingPreferences = async (preferences) => {
				document.documentElement.dataset.devicePreferences = JSON.stringify(preferences);
				return { success: true };
			};
			const device = (deviceId: string, kind: MediaDeviceKind, label: string) => ({
				deviceId,
				kind,
				label,
				groupId: "usb",
				toJSON: () => ({}),
			});
			let inventory = [
				device("mic-1", "audioinput", "USB microphone 1"),
				device("mic-2", "audioinput", "USB microphone 2"),
				device("camera-1", "videoinput", "USB camera 1"),
			];
			let calls = 0;
			navigator.mediaDevices.enumerateDevices = async () => {
				calls++;
				document.documentElement.dataset.deviceEnumerations = String(calls);
				const snapshot = inventory;
				if (calls === 1 && holdInitial)
					await new Promise<void>((resolve) =>
						window.addEventListener("test-finish-old-device-query", () => resolve(), {
							once: true,
						}),
					);
				else await new Promise((resolve) => setTimeout(resolve, 25));
				return snapshot;
			};
			window.addEventListener("test-device-hotplug", () => {
				inventory = [
					device("mic-3", "audioinput", "Replacement microphone"),
					device("camera-3", "videoinput", "Replacement camera"),
				];
				navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
			});
		},
		holdInitial,
	);
	await page.goto("/?windowType=hud-overlay");
	await expect(
		page.getByRole("region", { name: "Choose what to record", exact: true }),
	).toBeVisible();
}

test("microphone and camera share hardware queries on mount and hotplug; selecting a microphone does not enumerate again", async ({
	page,
}) => {
	await setup(page);
	const microphone = page.getByRole("combobox", { name: "Microphone", exact: true });
	const camera = page.getByRole("combobox", { name: "Camera", exact: true });
	await expect(microphone.locator('option[value="mic-2"]')).toHaveCount(1);
	await expect(camera.locator('option[value="camera-1"]')).toHaveCount(1);
	await expect(page.locator("html")).toHaveAttribute("data-device-enumerations", "1");
	await microphone.selectOption("mic-2");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(document.documentElement.dataset.devicePreferences ?? "{}")
						.microphoneDeviceId,
			),
		)
		.toBe("mic-2");
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	await expect(microphone).toHaveValue("mic-2");
	await expect(page.locator("html")).toHaveAttribute("data-device-enumerations", "1");
	await page.evaluate(() => window.dispatchEvent(new Event("test-device-hotplug")));
	await expect(microphone.locator('option[value="mic-3"]')).toHaveCount(1);
	await expect(camera.locator('option[value="camera-3"]')).toHaveCount(1);
	await expect(microphone.locator('option[value="mic-1"]')).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-device-enumerations", "2");
});

test("a slow pre-hotplug query cannot replace the newer microphone and camera inventory", async ({
	page,
}) => {
	await setup(page, true);
	await expect(page.locator("html")).toHaveAttribute("data-device-enumerations", "1");
	await page.evaluate(() => window.dispatchEvent(new Event("test-device-hotplug")));
	const microphone = page.getByRole("combobox", { name: "Microphone", exact: true });
	const camera = page.getByRole("combobox", { name: "Camera", exact: true });
	await expect(microphone.locator('option[value="mic-3"]')).toHaveCount(1);
	await expect(camera.locator('option[value="camera-3"]')).toHaveCount(1);
	await page.evaluate(() => window.dispatchEvent(new Event("test-finish-old-device-query")));
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	await expect(microphone.locator('option[value="mic-3"]')).toHaveCount(1);
	await expect(camera.locator('option[value="camera-3"]')).toHaveCount(1);
	await expect(microphone.locator('option[value="mic-1"]')).toHaveCount(0);
	await expect(camera.locator('option[value="camera-1"]')).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-device-enumerations", "2");
});
