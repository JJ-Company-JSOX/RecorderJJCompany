import { randomBytes } from "node:crypto";
import type { Platform, VideoPost } from "../publish";
import type { DirectAccount } from "./accounts";
import { metaAppId, tiktokClient, xClient, youtubeClient } from "./apps";
import {
	type MetaCredential,
	metaAccounts,
	metaExpired,
	metaLoginUrl,
	META_REDIRECT,
	parseMetaRedirect,
	postToFacebookPage,
	postToInstagram,
} from "./meta";
import { pkcePair, startLoopback } from "./oauth";
import {
	exchangeTiktokCode,
	postToTiktok,
	refreshTiktok,
	TIKTOK_REDIRECT_PATH,
	tiktokAuthUrl,
	tiktokCreatorInfo,
	tiktokUser,
} from "./tiktok";
import {
	exchangeXCode,
	postToX,
	refreshX,
	X_REDIRECT_PATH,
	X_REDIRECT_PORTS,
	xAuthUrl,
	xUser,
} from "./x";
import {
	exchangeYoutubeCode,
	uploadToYoutube,
	youtubeAccessToken,
	youtubeAuthUrl,
} from "./youtube";

export type ConnectContext = {
	/** Opens the platform's own sign-in page in the customer's browser. */
	openExternal: (url: string) => Promise<void>;
	/**
	 * Opens the platform's sign-in page in a Recordly window and resolves with the URL it
	 * finally redirects to (for flows that cannot redirect to 127.0.0.1, e.g. Facebook).
	 */
	signInWindow: (url: string, redirectPrefix: string, signal: AbortSignal) => Promise<string>;
	signal: AbortSignal;
};
export type PublishContext = Pick<ConnectContext, "signInWindow" | "signal"> & {
	/** The connected account being posted to (e.g. which Instagram account). */
	accountId: string;
};
export type Connected = { account: DirectAccount; credential: string };
export type Posted = { id: string; url?: string; credential?: string };

/** One social platform, posted to through the developer's registered app. */
export type PlatformAdapter = {
	/** False when this build has no app registered for the platform. */
	available(): boolean;
	connect(context: ConnectContext): Promise<Connected[]>;
	/** What the platform allows this account now (shown before posting); may rotate the credential. */
	options?(
		credential: string,
		signal: AbortSignal,
	): Promise<{ options: unknown; credential?: string }>;
	/** Posts the video; may return a rotated credential to store. */
	publish(credential: string, video: VideoPost, context: PublishContext): Promise<Posted>;
};

const notSetUp = (name: string) => new Error(`${name} posting is not set up in this build.`);

const youtube: PlatformAdapter = {
	available: () => Boolean(youtubeClient()),
	async connect({ openExternal, signal }) {
		const app = youtubeClient();
		if (!app) throw notSetUp("YouTube");
		const pkce = pkcePair();
		const loopback = await startLoopback(pkce.state, { signal });
		await openExternal(youtubeAuthUrl(app, loopback.redirectUri, pkce));
		const { account, refreshToken } = await exchangeYoutubeCode(
			app,
			await loopback.code,
			pkce.verifier,
			loopback.redirectUri,
		);
		return [
			{
				account: {
					platform: "youtube",
					id: account.id,
					name: account.name,
					detail: account.email,
					picture: account.picture,
				},
				credential: refreshToken,
			},
		];
	},
	async publish(credential, video, { signal }) {
		const app = youtubeClient();
		if (!app) throw notSetUp("YouTube");
		return uploadToYoutube(
			await youtubeAccessToken(app, credential),
			{
				videoPath: video.videoPath,
				title: video.title,
				description: video.text,
				visibility: video.visibility,
				publishAt:
					video.when === "schedule"
						? new Date(video.date as string).toISOString()
						: undefined,
				madeWithAi: video.madeWithAi,
			},
			{ signal },
		);
	},
};

const tiktok: PlatformAdapter = {
	available: () => Boolean(tiktokClient()),
	async connect({ openExternal, signal }) {
		const app = tiktokClient();
		if (!app) throw notSetUp("TikTok");
		const pkce = pkcePair("hex");
		const loopback = await startLoopback(pkce.state, { signal, path: TIKTOK_REDIRECT_PATH });
		await openExternal(tiktokAuthUrl(app, loopback.redirectUri, pkce));
		const tokens = await exchangeTiktokCode(
			app,
			await loopback.code,
			pkce.verifier,
			loopback.redirectUri,
		);
		const user = await tiktokUser(tokens.accessToken);
		return [
			{
				account: {
					platform: "tiktok",
					id: tokens.openId,
					name: user.name,
					picture: user.picture,
				},
				credential: tokens.refreshToken,
			},
		];
	},
	async options(credential) {
		const app = tiktokClient();
		if (!app) throw notSetUp("TikTok");
		const tokens = await refreshTiktok(app, credential);
		return {
			options: await tiktokCreatorInfo(tokens.accessToken),
			credential: tokens.refreshToken,
		};
	},
	async publish(credential, video, { signal }) {
		const app = tiktokClient();
		if (!app) throw notSetUp("TikTok");
		const tokens = await refreshTiktok(app, credential);
		const posted = await postToTiktok(tokens.accessToken, video, { signal });
		return { ...posted, credential: tokens.refreshToken };
	},
};

const x: PlatformAdapter = {
	available: () => Boolean(xClient()),
	async connect({ openExternal, signal }) {
		const app = xClient();
		if (!app) throw notSetUp("X");
		const pkce = pkcePair();
		const loopback = await startLoopback(pkce.state, {
			signal,
			path: X_REDIRECT_PATH,
			ports: X_REDIRECT_PORTS,
		});
		await openExternal(xAuthUrl(app.id, loopback.redirectUri, pkce));
		const tokens = await exchangeXCode(
			app.id,
			await loopback.code,
			pkce.verifier,
			loopback.redirectUri,
		);
		const user = await xUser(tokens.accessToken);
		return [
			{
				account: {
					platform: "x",
					id: user.id,
					name: user.name,
					detail: user.username ? `@${user.username}` : undefined,
					picture: user.picture,
				},
				credential: tokens.refreshToken,
			},
		];
	},
	async publish(credential, video, { signal }) {
		const app = xClient();
		if (!app) throw notSetUp("X");
		// Store the new single-use refresh token before anything else can fail.
		const tokens = await refreshX(app.id, credential);
		try {
			return {
				...(await postToX(tokens.accessToken, video, { signal })),
				credential: tokens.refreshToken,
			};
		} catch (error) {
			throw Object.assign(error as Error, { rotatedCredential: tokens.refreshToken });
		}
	},
};

/** One Facebook sign-in gives every Page the person manages and each linked Instagram account. */
async function metaSignIn(context: Pick<ConnectContext, "signInWindow" | "signal">) {
	const appId = metaAppId();
	if (!appId) throw notSetUp("Facebook and Instagram");
	const state = randomBytes(24).toString("base64url");
	const redirect = await context.signInWindow(
		metaLoginUrl(appId, state),
		META_REDIRECT,
		context.signal,
	);
	return parseMetaRedirect(redirect, state);
}

/** Renews an expired Meta sign-in through the sign-in window. */
async function freshMeta(
	credential: string,
	context: Pick<ConnectContext, "signInWindow" | "signal">,
) {
	const stored = JSON.parse(credential) as MetaCredential;
	if (!metaExpired(stored)) return { current: stored, renewed: undefined };
	const { token, expiresAt } = await metaSignIn(context);
	const current = { ...stored, token, expiresAt };
	return { current, renewed: JSON.stringify(current) };
}

const metaConnect = async (context: ConnectContext): Promise<Connected[]> => {
	const { token, expiresAt } = await metaSignIn(context);
	const pages = await metaAccounts(token);
	if (!pages.length)
		throw new Error(
			"No Facebook Page was found. Recordly posts to Pages you manage, and to Instagram professional accounts linked to them.",
		);
	return pages.flatMap((page) => {
		const credential = (pageId: string) =>
			JSON.stringify({ token, expiresAt, pageId } satisfies MetaCredential);
		const instagram = page.instagram_business_account;
		return [
			{
				account: {
					platform: "facebook" as const,
					id: page.id,
					name: page.name,
					detail: page.category,
					picture: page.picture?.data?.url,
				},
				credential: credential(page.id),
			},
			...(instagram
				? [
						{
							account: {
								platform: "instagram" as const,
								id: instagram.id,
								name: instagram.username ? `@${instagram.username}` : page.name,
								detail: page.name,
								picture: instagram.profile_picture_url,
							},
							credential: credential(page.id),
						},
					]
				: []),
		];
	});
};

const facebook: PlatformAdapter = {
	available: () => Boolean(metaAppId()),
	connect: metaConnect,
	async publish(credential, video, context) {
		const appId = metaAppId();
		if (!appId) throw notSetUp("Facebook");
		const { current, renewed } = await freshMeta(credential, context);
		return {
			...(await postToFacebookPage(appId, current, video, context)),
			credential: renewed,
		};
	},
};

const instagram: PlatformAdapter = {
	available: () => Boolean(metaAppId()),
	connect: metaConnect,
	async publish(credential, video, context) {
		const { current, renewed } = await freshMeta(credential, context);
		return {
			...(await postToInstagram(context.accountId, current, video, context)),
			credential: renewed,
		};
	},
};

export const ADAPTERS: Record<Platform, PlatformAdapter> = {
	youtube,
	tiktok,
	instagram,
	facebook,
	x,
};
