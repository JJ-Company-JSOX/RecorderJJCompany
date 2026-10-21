import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.beforeEach(() => test.setTimeout(150000));

test("customers connect their own accounts and post straight to each platform, no server", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const record = (key: string, value: unknown) => {
			document.documentElement.dataset[key] = JSON.stringify(value);
		};
		type Account = Awaited<
			ReturnType<typeof window.electronAPI.getSocialStatus>
		>["accounts"][number];
		const signIns: Record<string, Account[]> = {
			youtube: [
				{
					platform: "youtube",
					id: "g-1",
					name: "Jsox Studio",
					detail: "studio@example.com",
				},
			],
			tiktok: [{ platform: "tiktok", id: "t-1", name: "jsox.my" }],
		};
		let accounts: Account[] = [];
		let finishSignIn = () => undefined as void;
		window.electronAPI.getSocialStatus = async () => ({
			platforms: { youtube: true, tiktok: true, instagram: false, facebook: false, x: false },
			accounts,
		});
		window.electronAPI.connectSocial = (platform) =>
			new Promise((resolve) => {
				// The customer finishes on the platform's own page in the browser.
				finishSignIn = () => {
					accounts = [...accounts, ...signIns[platform]];
					resolve({ success: true, accounts });
				};
			});
		Object.assign(window, { finishSignIn: () => finishSignIn() });
		window.electronAPI.removeSocial = async (platform, id) => {
			accounts = accounts.filter((a) => !(a.platform === platform && a.id === id));
			return { success: true, accounts };
		};
		window.electronAPI.getSocialAccountOptions = async () => ({
			success: true,
			options: {
				nickname: "Jsox MY",
				privacyOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
				commentDisabled: false,
				duetDisabled: true,
				stitchDisabled: false,
			},
		});
		window.electronAPI.pickSocialVideo = async () => "C:\\Videos\\tutorial.mp4";
		window.electronAPI.checkSocialVideo = async (path) => ({
			success: true,
			path,
			bytes: 1048576,
		});
		window.electronAPI.onSocialPublishProgress = () => () => undefined;
		window.electronAPI.cancelSocialPublish = async () => undefined;
		window.electronAPI.publishSocialPost = async (request) => {
			record("socialPublished", request);
			return {
				success: true,
				posts: [
					{
						platform: "youtube",
						account: "Jsox Studio (youtube)",
						id: "VID123",
						url: "https://youtu.be/VID123",
					},
				],
				failed: [
					{
						account: "jsox.my (tiktok)",
						error: "TikTok is not allowing more posts from this account right now.",
					},
				],
			};
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]').first()).toBeVisible({ timeout: 60000 });
	await page.getByRole("button", { name: "Social", exact: true }).click();
	const social = page.locator("[data-social-panel]");
	await expect(social).toBeVisible();
	await expect(social.getByText(/Recordly accounts are not set up/)).toBeVisible();
	// No Postiz: each platform connects directly; unregistered ones say so.
	await expect(social.getByText(/Postiz/)).toHaveCount(0);
	await expect(social.getByRole("button", { name: "Connect X" })).toBeDisabled();
	await expect(
		social.getByText("Not set up in this build yet: Instagram, Facebook, X."),
	).toBeVisible();

	await social.getByRole("button", { name: "Connect YouTube" }).click();
	await expect(social.getByText("Finish signing in on the YouTube page…")).toBeVisible();
	await page.evaluate(() => (window as unknown as { finishSignIn: () => void }).finishSignIn());
	await expect(social.getByRole("checkbox", { name: /Jsox Studio/ })).toBeChecked();
	await social.getByRole("button", { name: "Connect TikTok" }).click();
	await page.evaluate(() => (window as unknown as { finishSignIn: () => void }).finishSignIn());
	await expect(social.getByRole("checkbox", { name: /jsox\.my/ })).toBeChecked();

	await social.getByRole("button", { name: "Choose MP4…" }).click();
	await social.getByLabel("Title (YouTube, Facebook)").fill("Export a video");
	await social.getByLabel("Caption and hashtags").fill("How to export #tutorial");
	const post = social.getByRole("button", { name: "Post to 2 accounts" });
	// TikTok's rules: the creator is named, privacy has no default, interactions start unticked.
	const tiktok = social.locator("[data-tiktok-settings]");
	await expect(tiktok.getByText("TikTok settings for Jsox MY")).toBeVisible();
	await expect(post).toBeDisabled();
	await expect(tiktok.getByRole("checkbox", { name: "Allow comments" })).not.toBeChecked();
	await expect(tiktok.getByRole("checkbox", { name: "Allow Duet" })).toBeDisabled();
	await tiktok.getByLabel("Who can see this TikTok video").selectOption("PUBLIC_TO_EVERYONE");
	await tiktok.getByRole("checkbox", { name: "Allow comments" }).check();
	await tiktok.getByRole("checkbox", { name: /Disclose video content/ }).check();
	await expect(post).toBeDisabled();
	await tiktok.getByRole("checkbox", { name: /Your brand/ }).check();
	await expect(
		tiktok.getByText("Your video will be labeled “Promotional content”."),
	).toBeVisible();
	await expect(tiktok.getByText(/Music Usage Confirmation/)).toBeVisible();
	await expect(post).toBeEnabled();

	await social.getByLabel("Page language").selectOption("zh");
	await expect(social.getByRole("heading", { name: "社交媒体" })).toBeVisible();
	await social.getByLabel("页面语言").selectOption("en");

	await page.screenshot({ path: "test-results/social-direct.png", fullPage: true });
	await post.click();
	await expect(social.getByText("Posted to 1 account.")).toBeVisible();
	await expect(
		social.getByRole("button", { name: "Jsox Studio (youtube): https://youtu.be/VID123" }),
	).toBeVisible();
	await expect(social.getByText(/jsox\.my \(tiktok\): TikTok is not allowing/)).toBeVisible();
	const published = JSON.parse(
		(await page.locator("html").getAttribute("data-social-published")) ?? "{}",
	);
	expect(published).toMatchObject({
		videoPath: "C:\\Videos\\tutorial.mp4",
		accounts: [
			{ platform: "youtube", id: "g-1" },
			{ platform: "tiktok", id: "t-1" },
		],
		title: "Export a video",
		text: "How to export #tutorial",
		visibility: "public",
		when: "now",
		madeWithAi: true,
		tiktok: {
			privacy: "PUBLIC_TO_EVERYONE",
			allowComment: true,
			allowDuet: false,
			allowStitch: false,
			yourBrand: true,
			brandedContent: false,
		},
	});
	await social.getByRole("button", { name: "Remove" }).first().click();
	await expect(social.getByRole("checkbox", { name: /Jsox Studio/ })).toHaveCount(0);
});
