import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openStudio(page: Page) {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
	});
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "AI Studio", exact: true }).click();
	const studio = page.getByRole("region", { name: "AI Studio", exact: true });
	await studio.getByLabel("Studio language").selectOption("en");
	return studio;
}

test("local video, per-item review and disclosures complete preparation without any upload", async ({
	page,
}) => {
	const studio = await openStudio(page);
	const external: string[] = [];
	page.on("request", (request) => {
		if (
			/^https?:/.test(request.url()) &&
			new URL(request.url()).origin !== "http://127.0.0.1:5178"
		)
			external.push(request.url());
	});
	await studio
		.getByLabel("Choose video locally", { exact: true })
		.setInputFiles(path.resolve("tests/ui/fixtures/filmstrip.mp4"));
	await expect
		.poll(() => studio.locator("video").evaluate((video: HTMLVideoElement) => video.duration))
		.toBe(6);
	await expect(studio.getByRole("status")).toHaveCount(0);
	const prepare = studio.getByRole("button", { name: "Complete local preparation", exact: true });
	await expect(prepare).toBeDisabled();
	await studio.getByRole("textbox").fill("请联系 alex@example.com, telefon +60 12-345 6789");
	await studio.getByRole("button", { name: "Check text locally", exact: true }).click();
	await expect(studio.getByRole("checkbox", { name: /I reviewed this candidate/ })).toHaveCount(
		2,
	);
	for (const checkbox of await studio.getByRole("checkbox").all()) {
		await checkbox.check();
	}
	await expect(prepare).toBeEnabled();
	await prepare.click();
	await expect(studio.getByRole("status")).toContainText("Nothing uploaded");
	await studio.getByRole("checkbox", { name: /I understand the planned Gemini/ }).uncheck();
	await expect(studio.getByRole("status")).toHaveCount(0);
	await expect(prepare).toBeDisabled();
	// Text edits invalidate the scan and every acknowledgement.
	await studio.getByRole("textbox").fill("new content");
	expect(await studio.locator('input[type="checkbox"]:checked').count()).toBe(0);
	await expect(studio.getByRole("heading", { name: /Sensitive-data candidates/ })).toHaveCount(0);
	await expect(page.locator('input[type="email"]')).toHaveCount(0);
	expect(external).toEqual([]);
});

test("redaction changes only pasted text, file replacement resets, leaving clears private state", async ({
	page,
}) => {
	const studio = await openStudio(page);
	const fileInput = studio.getByLabel("Choose video locally", { exact: true });
	await fileInput.setInputFiles(path.resolve("tests/ui/fixtures/filmstrip.mp4"));
	await studio.getByRole("textbox").fill("token=alex@example.com");
	await studio.getByRole("button", { name: "Check text locally", exact: true }).click();
	await studio
		.getByRole("button", { name: "Remove detected text and check again", exact: true })
		.click();
	await expect(studio.getByRole("textbox")).toHaveValue("[REDACTED]");
	await expect(studio.getByText("No supported patterns found.", { exact: false })).toBeVisible();
	await expect(studio.locator("video")).toHaveCount(1);
	await studio.getByLabel("Studio language").selectOption("zh");
	await studio.evaluate((element) => {
		element.scrollTop = 0;
	});
	await page.screenshot({
		path: "test-results/ai-studio-preflight-zh.png",
		animations: "disabled",
	});
	await studio.getByLabel("Studio language").selectOption("en");
	await fileInput.setInputFiles({
		name: "wrong.exe",
		mimeType: "application/octet-stream",
		buffer: Buffer.from("bad"),
	});
	await expect(studio.getByRole("alert")).toHaveText("Choose an MP4, MOV or WebM file.");
	await expect(studio.getByRole("textbox")).toHaveValue("");
	await expect(studio.locator("video")).toHaveCount(0);
	await studio.getByRole("textbox").fill("not retained alex@example.com");
	await page
		.getByRole("complementary", { name: "Library navigation" })
		.getByRole("button", { name: "Home", exact: true })
		.click();
	await page.getByRole("button", { name: "AI Studio", exact: true }).click();
	await expect(page.getByRole("region", { name: "AI Studio" }).getByRole("textbox")).toHaveValue(
		"",
	);
	const stored = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
	expect(stored).not.toContain("alex@example.com");
});

test("Chinese / English / Malay UI, invalid media and candidate overflow fail closed", async ({
	page,
}) => {
	const studio = await openStudio(page);
	await studio.getByLabel("Studio language").selectOption("zh");
	await expect(studio.getByRole("heading", { level: 1 })).toHaveText("AI Studio · 上传准备");
	await studio.getByLabel("Studio language").selectOption("ms");
	await expect(studio.getByRole("heading", { level: 1 })).toHaveText(
		"AI Studio · persediaan muat naik",
	);
	await studio.getByLabel("Studio language").selectOption("en");
	await studio
		.getByLabel("Choose video locally", { exact: true })
		.setInputFiles({
			name: "fake.mp4",
			mimeType: "video/mp4",
			buffer: Buffer.from("not a video"),
		});
	await expect(studio.getByRole("alert")).toContainText("Cannot decode");
	await studio.getByRole("textbox").fill("a@example.com ".repeat(101));
	await studio.getByRole("button", { name: "Check text locally", exact: true }).click();
	await expect(studio.getByText(/Inspection incomplete/)).toBeVisible();
	await expect(
		studio.getByRole("button", { name: "Complete local preparation", exact: true }),
	).toBeDisabled();
});
