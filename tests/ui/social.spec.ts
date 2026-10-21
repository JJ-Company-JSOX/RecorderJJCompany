import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.beforeEach(() => test.setTimeout(150000));

test("Social page connects Postiz, lists accounts and posts the video to the ticked ones", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		let config: { baseUrl: string | null; hasKey: boolean } = { baseUrl: null, hasKey: false };
		const record = (key: string, value: unknown) => {
			document.documentElement.dataset[key] = JSON.stringify(value);
		};
		window.electronAPI.getSocialConfig = async () => config;
		window.electronAPI.saveSocialConfig = async (baseUrl, apiKey) => {
			if (apiKey !== "good-key")
				return { success: false, error: "Postiz did not accept the API key." };
			config = { baseUrl, hasKey: true };
			return { success: true, baseUrl };
		};
		window.electronAPI.clearSocialConfig = async () => {
			config = { baseUrl: null, hasKey: false };
			return { success: true };
		};
		window.electronAPI.listSocialChannels = async () => ({
			success: true,
			channels: [
				{ id: "yt-1", name: "Jsox Tutorials", identifier: "youtube", disabled: false },
				{ id: "tt-1", name: "jsox.my", identifier: "tiktok", disabled: false },
				{ id: "pin-1", name: "Boards", identifier: "pinterest", disabled: false },
			],
		});
		window.electronAPI.connectSocialChannel = async (identifier) => {
			record("socialLinked", identifier);
			return { success: true };
		};
		window.electronAPI.pickSocialVideo = async () => "C:\\Videos\\tutorial.mp4";
		window.electronAPI.checkSocialVideo = async (path) => ({
			success: true,
			path,
			bytes: 5242880,
		});
		window.electronAPI.onSocialPublishProgress = () => () => undefined;
		window.electronAPI.cancelSocialPublish = async () => undefined;
		window.electronAPI.publishSocialPost = async (request) => {
			record("socialPublished", request);
			return {
				success: true,
				posts: request.channels.map((c) => ({ postId: `p-${c.id}`, integration: c.id })),
			};
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]').first()).toBeVisible({ timeout: 60000 });
	await page.getByRole("button", { name: "Social", exact: true }).click();
	const social = page.locator("[data-social-panel]");
	await expect(social).toBeVisible();
	// Recordly accounts stay off unless the build turns them on.
	await expect(social.getByText(/Recordly accounts are not set up/)).toBeVisible();

	await social.getByLabel("API key").fill("bad-key");
	await social.getByRole("button", { name: "Connect", exact: true }).click();
	await expect(social.getByRole("alert")).toContainText("did not accept");
	await social.getByLabel("API key").fill("good-key");
	await social.getByRole("button", { name: "Connect", exact: true }).click();
	await expect(social.locator("[data-social-connected]")).toContainText(
		"https://api.postiz.com/public/v1",
	);

	// Pinterest is listed but cannot take a video post.
	await expect(social.getByRole("checkbox")).toHaveCount(4);
	await expect(social.getByText("Cannot post video")).toBeVisible();
	await social.getByRole("button", { name: "TikTok", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-social-linked", '"tiktok"');

	await social.getByLabel("Page language").selectOption("zh");
	await expect(social.getByRole("heading", { name: "社交媒体" })).toBeVisible();
	await social.getByLabel("页面语言").selectOption("en");

	const post = social.getByRole("button", { name: /^Post to/ });
	await social.getByRole("checkbox", { name: /Jsox Tutorials/ }).check();
	await social.getByRole("checkbox", { name: /jsox\.my/ }).check();
	await expect(post).toBeDisabled();
	await social.getByRole("button", { name: "Choose MP4…" }).click();
	await expect(social.locator("[data-social-video]")).toHaveText("tutorial.mp4 · 5.0 MiB");
	// YouTube needs a title.
	await expect(post).toBeDisabled();
	await social.getByLabel("Title (YouTube, TikTok, Facebook)").fill("Export a video");
	await social.getByLabel("Caption and hashtags").fill("How to export #tutorial");
	await social.getByLabel("Who can see it").selectOption("private");
	await expect(post).toHaveText("Post to 2 accounts");
	await page.screenshot({ path: "test-results/social-page.png" });
	await post.click();
	await expect(social.getByText("Sent to Postiz. 2 posts created.")).toBeVisible();
	const published = JSON.parse(
		(await page.locator("html").getAttribute("data-social-published")) ?? "{}",
	);
	expect(published).toMatchObject({
		videoPath: "C:\\Videos\\tutorial.mp4",
		channels: [
			{ id: "yt-1", identifier: "youtube" },
			{ id: "tt-1", identifier: "tiktok" },
		],
		title: "Export a video",
		text: "How to export #tutorial",
		visibility: "private",
		when: "now",
		madeWithAi: true,
	});
});
