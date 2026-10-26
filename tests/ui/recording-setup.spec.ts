import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function setup(page: Page, options = { chinese: false, selected: false }) {
	await installDesktopBridge(page);
	await page.addInitScript(({ chinese, selected }) => {
		localStorage.setItem("recordly.locale", chinese ? "zh-CN" : "en");
		const storedPreferences: Record<string, unknown> = {};
		let selection = selected
			? {
					id: "screen:1:0",
					name: "Display 1",
					display_id: "1",
					thumbnail: null,
					appIcon: null,
				}
			: null;
		Object.assign(window.electronAPI, {
			getPlatform: async () => "win32",
			hudOverlaySetSetupVisible: (visible: boolean) => {
				document.documentElement.dataset.setupVisible = String(visible);
			},
			getSelectedSource: async () => selection,
			getRecordingPreferences: async () => ({
				success: true,
				microphoneEnabled: false,
				systemAudioEnabled: false,
				webcamEnabled: false,
			}),
			setRecordingPreferences: async (preferences: Record<string, unknown>) => {
				Object.assign(storedPreferences, preferences);
				document.documentElement.dataset.preferences = JSON.stringify(storedPreferences);
				return { success: true };
			},
			getSources: async (options: { types: string[] }) => {
				document.documentElement.dataset.sourceType = options.types[0];
				return [
					{
						id: `${options.types[0]}:1:0`,
						name: options.types[0] === "screen" ? "Display 1" : "Notes",
						display_id: "1",
						thumbnail: null,
						appIcon: null,
					},
				];
			},
			selectSource: async (source: typeof selection) => {
				selection = source;
				document.documentElement.dataset.selected = source?.id;
				return source;
			},
			pickCaptureTarget: async () => {
				document.documentElement.dataset.legacyPickerCalled = "true";
				return { success: false, canceled: true };
			},
		});
		navigator.mediaDevices.enumerateDevices = async () => [
			{
				deviceId: "mic-1",
				kind: "audioinput",
				label: "USB microphone",
				groupId: "usb",
				toJSON: () => ({}),
			},
			{
				deviceId: "camera-1",
				kind: "videoinput",
				label: "Integrated camera",
				groupId: "camera",
				toJSON: () => ({}),
			},
		];
	}, options);
	await page.goto("/?windowType=hud-overlay");
}

test("native system audio startup failure is visible while screen recording remains available", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getPlatform = async () => "win32";
		window.electronAPI.getCountdownDelay = async () => ({ success: true, delay: 0 });
		window.electronAPI.isNativeWindowsCaptureAvailable = async () => ({ available: true });
		window.electronAPI.startNativeScreenRecording = async (_source, options) => {
			document.documentElement.dataset.systemAudioRequested = String(
				options?.capturesSystemAudio,
			);
			return { success: true, systemAudioUnavailable: true };
		};
		window.electronAPI.setRecordingState = async (active) => {
			document.documentElement.dataset.captureActive = String(active);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await page.getByTitle("Record", { exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-system-audio-requested", "true");
	await expect(
		page.getByText("System audio could not be captured.", { exact: false }),
	).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-capture-active", "true");
});

test("screen selection is filtered, explicit, and enables recording only after confirmation", async ({
	page,
}) => {
	await setup(page);
	const record = page.getByRole("button", { name: "Start recording", exact: true });
	await expect(record).toBeDisabled();
	await page.getByRole("button", { name: "Full screen Choose a display" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-source-type", "screen");
	await expect(record).toBeDisabled();
	await page.getByRole("button", { name: "Display 1", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-selected", "screen:1:0");
	await expect(record).toBeEnabled();
	await expect(page.locator("html")).not.toHaveAttribute("data-legacy-picker-called");
});

test("window mode enumerates windows and offers retry after a failed selection", async ({
	page,
}) => {
	await setup(page);
	await page.evaluate(() => {
		window.electronAPI.selectSource = async () => {
			throw new Error("Window closed");
		};
	});
	await page.getByRole("button", { name: "Window Focus on one app" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-source-type", "window");
	await page.getByRole("button", { name: "Notes", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Could not select");
	await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeDisabled();
	await page.evaluate(() => {
		window.electronAPI.selectSource = async (source) => source;
	});
	await page.getByRole("button", { name: "Notes", exact: true }).click();
	await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
});

test("source enumeration failure can be refreshed without losing the previous source", async ({
	page,
}) => {
	await setup(page, { chinese: false, selected: true });
	await page.evaluate(() => {
		window.electronAPI.getSources = async () => {
			throw new Error("Permission denied");
		};
	});
	await page.getByRole("button", { name: "Full screen Choose a display" }).click();
	await expect(page.getByRole("alert")).toContainText("Could not load");
	await page.evaluate(() => {
		window.electronAPI.getSources = async () => [];
	});
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(page.getByText("No sources found.", { exact: false })).toBeVisible();
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
});

test("device settings use the existing recording preferences", async ({ page }) => {
	await setup(page);
	await expect(page.getByText("Computer sound is off.", { exact: false })).toBeVisible();
	await page.getByRole("combobox", { name: "Microphone", exact: true }).selectOption("mic-1");
	await page.getByRole("combobox", { name: "System audio", exact: true }).selectOption("on");
	await expect(
		page.getByText("Records sound from the default output device.", { exact: false }),
	).toBeVisible();
	await expect
		.poll(async () =>
			JSON.parse((await page.locator("html").getAttribute("data-preferences")) ?? "{}"),
		)
		.toMatchObject({
			microphoneEnabled: true,
			microphoneDeviceId: "mic-1",
			systemAudioEnabled: true,
		});
	await page.getByRole("combobox", { name: "Microphone", exact: true }).selectOption("off");
	await expect
		.poll(async () =>
			JSON.parse((await page.locator("html").getAttribute("data-preferences")) ?? "{}"),
		)
		.toMatchObject({ microphoneEnabled: false });
});

test("Chinese Windows setup uses original artwork and hides unsupported modes", async ({
	page,
}) => {
	await setup(page, { chinese: true, selected: true });
	await expect(page.getByRole("heading", { name: "选择你的录制方式" })).toBeVisible();
	await expect(page.getByRole("button", { name: "全屏录制 选择要录制的显示器" })).toBeVisible();
	await expect(
		page.getByRole("button", { name: /选取区域|Device|Teleprompter|FocuSee/ }),
	).toHaveCount(0);
	await expect(page.getByRole("combobox", { name: "摄像头", exact: true })).toHaveValue("off");
	await page.screenshot({ path: "test-results/recording-setup-zh.png", animations: "disabled" });
});

test("setup remains usable in the compact native fallback viewport", async ({ page }) => {
	await page.setViewportSize({ width: 860, height: 540 });
	await setup(page, { chinese: true, selected: true });
	await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeInViewport();
	await expect(page.getByRole("combobox", { name: "系统声音", exact: true })).toBeInViewport();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
		true,
	);
	await page.screenshot({
		path: "test-results/recording-setup-compact.png",
		animations: "disabled",
	});
});

test("opening a local video reuses the file picker and editor navigation", async ({ page }) => {
	await setup(page);
	await page.evaluate(() => {
		window.electronAPI.openVideoFilePicker = async () => ({
			success: true,
			path: "/clips/demo.mp4",
		});
		window.electronAPI.setCurrentVideoPath = async (path) => {
			document.documentElement.dataset.openedVideo = path;
			return { success: true };
		};
		window.electronAPI.switchToEditor = async () => {
			document.documentElement.dataset.editorOpened = "true";
		};
	});
	await page.getByRole("button", { name: "Import video Edit an existing recording" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-opened-video", "/clips/demo.mp4");
	await expect(page.locator("html")).toHaveAttribute("data-editor-opened", "true");
});

test("canceling an import releases setup controls and allows screen selection again", async ({
	page,
}) => {
	await setup(page);
	await page.evaluate(() => {
		window.electronAPI.openVideoFilePicker = () => {
			document.documentElement.dataset.importDialogOpened = "true";
			return new Promise((resolve) => {
				window.addEventListener(
					"test-file-dialog-canceled",
					() => resolve({ success: false, canceled: true }),
					{ once: true },
				);
			});
		};
	});
	const importVideo = page.getByRole("button", {
		name: "Import video Edit an existing recording",
	});
	const fullScreen = page.getByRole("button", { name: "Full screen Choose a display" });
	await importVideo.click();
	await expect(importVideo).toBeDisabled();
	await expect(fullScreen).toBeDisabled();
	await expect(page.locator("html")).toHaveAttribute("data-import-dialog-opened", "true");
	await page.evaluate(() => window.dispatchEvent(new Event("test-file-dialog-canceled")));
	await expect(importVideo).toBeEnabled();
	await expect(fullScreen).toBeEnabled();
	await fullScreen.click();
	await page.getByRole("button", { name: "Display 1", exact: true }).click();
	await expect(page.getByRole("group", { name: "Ready to record", exact: true })).toBeVisible();
});

test("confirming a source opens the compact ready bar until settings are explicitly reopened", async ({
	page,
}) => {
	await setup(page);
	await page.getByRole("button", { name: "Full screen Choose a display" }).click();
	await page.getByRole("button", { name: "Display 1", exact: true }).click();
	const ready = page.getByRole("group", { name: "Ready to record", exact: true });
	await expect(ready).toBeVisible();
	await expect(page.getByRole("button", { name: "Full screen Choose a display" })).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-setup-visible", "false");
	await expect(ready.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
	await ready.getByRole("button", { name: "Microphone", exact: false }).click();
	await expect(ready.getByRole("button", { name: "Microphone", exact: false })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await ready.getByRole("button", { name: "Recording settings", exact: true }).click();
	await expect(page.getByRole("button", { name: "Full screen Choose a display" })).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-setup-visible", "true");
});

test("Start on the ready bar runs the existing countdown and cancellation keeps the bar ready", async ({
	page,
}) => {
	await setup(page);
	await page.evaluate(() => {
		let finish: ((result: { success: boolean; cancelled: boolean }) => void) | undefined;
		window.electronAPI.isNativeWindowsCaptureAvailable = async () => ({ available: false });
		window.electronAPI.startCountdown = async () => {
			document.documentElement.dataset.countdownStarted = "true";
			return new Promise((resolve) => {
				finish = resolve;
			});
		};
		window.electronAPI.cancelCountdown = async () => {
			finish?.({ success: false, cancelled: true });
			return { success: true };
		};
	});
	await page.getByRole("button", { name: "Full screen Choose a display" }).click();
	await page.getByRole("button", { name: "Display 1", exact: true }).click();
	const ready = page.getByRole("group", { name: "Ready to record", exact: true });
	await expect(ready).toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-countdown-started");
	await page.screenshot({ path: "test-results/recording-ready-bar.png", animations: "disabled" });
	await ready.getByRole("button", { name: "Start recording", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-countdown-started", "true");
	await ready.getByRole("button", { name: "Cancel countdown", exact: true }).click();
	await expect(ready.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
	await expect(page.getByRole("button", { name: "Full screen Choose a display" })).toHaveCount(0);
});

test("ready panel remains readable and clickable at desktop and narrow fallback sizes, and Back preserves settings", async ({
	page,
}) => {
	await setup(page);
	await page.getByRole("button", { name: "Full screen Choose a display" }).click();
	await page.getByRole("button", { name: "Display 1", exact: true }).click();
	const ready = page.getByRole("group", { name: "Ready to record", exact: true });
	await ready.getByRole("button", { name: /^Microphone/ }).click();
	await expect(ready.getByRole("button", { name: /^Microphone/ })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(ready).toHaveCSS("background-color", "rgb(23, 27, 34)");
	for (const width of [1440, 860, 560, 420]) {
		await page.setViewportSize({ width, height: width >= 1440 ? 540 : 320 });
		await expect(ready).toBeInViewport();
		for (const label of [
			"Back",
			"Start recording",
			"Recording settings",
			"Hide recorder",
			"Close recorder",
		]) {
			const button = ready.getByRole("button", { name: label, exact: true });
			await expect(button).toBeInViewport();
			expect(
				await button.evaluate((el) => el.getBoundingClientRect().height),
			).toBeGreaterThanOrEqual(44);
			await expect
				.poll(() =>
					button.evaluate((el) => {
						const r = el.getBoundingClientRect();
						return el.contains(
							document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
						);
					}),
				)
				.toBe(true);
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.screenshot({ path: "/tmp/recordly-ready-panel.png", animations: "disabled" });
	await ready.getByRole("button", { name: "Back", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-setup-visible", "true");
	await expect(page.getByRole("combobox", { name: "Microphone", exact: true })).toHaveValue(
		"mic-1",
	);
	await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
});

test("Back cancels countdown before returning to setup without starting capture", async ({
	page,
}) => {
	await setup(page);
	await page.evaluate(() => {
		let finish: (result: { success: boolean; cancelled: boolean }) => void;
		window.electronAPI.isNativeWindowsCaptureAvailable = async () => ({ available: false });
		window.electronAPI.startCountdown = async () => {
			document.documentElement.dataset.countdownStarted = "true";
			return new Promise((resolve) => {
				finish = resolve;
			});
		};
		window.electronAPI.cancelCountdown = async () => {
			document.documentElement.dataset.countdownCanceled = "true";
			finish?.({ success: false, cancelled: true });
			return { success: true };
		};
		window.electronAPI.setRecordingState = async (active) => {
			document.documentElement.dataset.captureActive = String(active);
		};
	});
	await page.getByRole("button", { name: "Full screen Choose a display" }).click();
	await page.getByRole("button", { name: "Display 1", exact: true }).click();
	const ready = page.getByRole("group", { name: "Ready to record", exact: true });
	await ready.getByRole("button", { name: "Start recording", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-countdown-started", "true");
	await ready.getByRole("button", { name: "Back", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-countdown-canceled", "true");
	await expect(
		page.getByRole("region", { name: "Choose what to record", exact: true }),
	).toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-capture-active", "true");
});

test("creative request is staged only after successful media import", async ({ page }) => {
	await setup(page);
	await page.evaluate(() => {
		const get = window.electronAPI.getAppSetting;
		window.electronAPI.getAppSetting = (key) => {
			const v = sessionStorage.getItem(`intent:${key}`);
			return v ? JSON.parse(v) : get(key);
		};
		window.electronAPI.setAppSetting = (key, value) => {
			sessionStorage.setItem(`intent:${key}`, JSON.stringify(value));
			return true;
		};
		window.electronAPI.openVideoFilePicker = async () => ({
			success: true,
			path: "/clips/product.mp4",
		});
		window.electronAPI.setCurrentVideoPath = async () => ({ success: true });
		window.electronAPI.switchToEditor = async () => {
			document.documentElement.dataset.intentEditorOpened = "true";
		};
	});
	await page
		.getByLabel("What are you creating? (optional)", { exact: true })
		.fill("Introduce my product in a 30-second sales story.");
	await expect
		.poll(() =>
			page.evaluate(() => sessionStorage.getItem("intent:recordly.story.nextIntent.v1")),
		)
		.toBeNull();
	await page
		.getByRole("button", { name: "Import video Edit an existing recording", exact: true })
		.click();
	await expect(page.locator("html")).toHaveAttribute("data-intent-editor-opened", "true");
	await expect
		.poll(() =>
			page.evaluate(() =>
				JSON.parse(sessionStorage.getItem("intent:recordly.story.nextIntent.v1") ?? "null"),
			),
		)
		.toMatchObject({
			prompt: "Introduce my product in a 30-second sales story.",
			sourcePath: "/clips/product.mp4",
		});
});
