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
		window.electronAPI.getDirectSocialStatus = async () => ({
			platforms: { youtube: false },
			accounts: [],
		});
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
	// A build without the developer's YouTube app says so instead of offering a broken button.
	await expect(social.getByRole("button", { name: "Connect YouTube" })).toBeDisabled();
	await expect(
		social.getByText("YouTube posting is not set up in this build yet."),
	).toBeVisible();

	await social.getByLabel("API key", { exact: true }).fill("bad-key");
	await social.getByRole("button", { name: "Connect", exact: true }).click();
	await expect(social.getByRole("alert")).toContainText("did not accept");
	// Customers choose the paid cloud or the cheaper open-source server.
	await expect(social.getByText(/from US\$29 a month/)).toBeVisible();
	await social.getByRole("radio", { name: /Open-source Postiz server/ }).check();
	await social.getByLabel("Postiz address").fill("https://postiz.mycompany.com");
	await page.screenshot({ path: "test-results/social-choose-server.png" });
	await social.getByLabel("API key", { exact: true }).fill("good-key");
	await social.getByRole("button", { name: "Connect", exact: true }).click();
	await expect(social.locator("[data-social-connected]")).toContainText(
		"https://postiz.mycompany.com",
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
	await expect(social.getByText("Posted. 2 posts created.")).toBeVisible();
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

test("customers connect YouTube with their own Google account and post with no server", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const record = (key: string, value: unknown) => {
			document.documentElement.dataset[key] = JSON.stringify(value);
		};
		const account = {
			platform: "youtube" as const,
			id: "g-1",
			name: "Jsox Studio",
			email: "studio@example.com",
		};
		let accounts: (typeof account)[] = [];
		let finishSignIn = () => undefined as void;
		window.electronAPI.getSocialConfig = async () => ({ baseUrl: null, hasKey: false });
		window.electronAPI.getDirectSocialStatus = async () => ({
			platforms: { youtube: true },
			accounts,
		});
		window.electronAPI.connectDirectSocial = () =>
			new Promise((resolve) => {
				// The customer finishes on Google's page in the browser.
				finishSignIn = () => {
					accounts = [account];
					resolve({ success: true, accounts });
				};
			});
		Object.assign(window, { finishSignIn: () => finishSignIn() });
		window.electronAPI.removeDirectSocial = async () => {
			accounts = [];
			return { success: true, accounts };
		};
		window.electronAPI.pickSocialVideo = async () => "C:\\Videos\\tutorial.mp4";
		window.electronAPI.checkSocialVideo = async (path) => ({
			success: true,
			path,
			bytes: 1048576,
		});
		window.electronAPI.onSocialPublishProgress = () => () => undefined;
		window.electronAPI.publishSocialPost = async (request) => {
			record("socialPublished", request);
			return {
				success: true,
				posts: [{ postId: "VID123", integration: "g-1", url: "https://youtu.be/VID123" }],
				failed: [],
			};
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]').first()).toBeVisible({ timeout: 60000 });
	await page.getByRole("button", { name: "Social", exact: true }).click();
	const social = page.locator("[data-social-panel]");
	await social.getByRole("button", { name: "Connect YouTube" }).click();
	await expect(social.getByText("Finish signing in in your browser…")).toBeVisible();
	await page.evaluate(() => (window as unknown as { finishSignIn: () => void }).finishSignIn());
	// The new account is listed and ticked, ready to post to.
	await expect(social.getByRole("checkbox", { name: /Jsox Studio/ })).toBeChecked();
	await social.getByRole("button", { name: "Choose MP4…" }).click();
	await social.getByLabel("Title (YouTube, TikTok, Facebook)").fill("Export a video");
	await social.getByLabel("Caption and hashtags").fill("How to export #tutorial");
	await page.screenshot({ path: "test-results/social-direct-youtube.png" });
	await social.getByRole("button", { name: "Post to 1 account" }).click();
	await expect(social.getByText("Posted. 1 post created.")).toBeVisible();
	await expect(social.getByRole("button", { name: "https://youtu.be/VID123" })).toBeVisible();
	const published = JSON.parse(
		(await page.locator("html").getAttribute("data-social-published")) ?? "{}",
	);
	expect(published.channels).toEqual([{ id: "g-1", identifier: "youtube", via: "direct" }]);
	await social.getByRole("button", { name: "Remove" }).click();
	await expect(social.getByRole("checkbox", { name: /Jsox Studio/ })).toHaveCount(0);
});
