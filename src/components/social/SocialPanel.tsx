import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import { ACCOUNTS_ENABLED } from "@/lib/productFeatures";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "./socialLauncher";
import { PLATFORM_LABELS, type SocialLanguage, socialMessages } from "./socialMessages";

type Status = Awaited<ReturnType<typeof window.electronAPI.getSocialStatus>>;
type Account = Status["accounts"][number];
type CreatorInfo = {
	nickname: string;
	privacyOptions: string[];
	commentDisabled: boolean;
	duetDisabled: boolean;
	stitchDisabled: boolean;
};
type Result = {
	links: Array<{ account: string; url?: string }>;
	failed: Array<{ account: string; error: string }>;
};

const fill = (text: string, values: Record<string, string | number>) =>
	text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
const card = "space-y-3 rounded-2xl border border-border bg-muted/30 p-4";
const field = "w-full rounded-lg border border-border bg-background p-2 text-sm";
const keyOf = (a: Pick<Account, "platform" | "id">) => `${a.platform}:${a.id}`;

/** Local time for a datetime-local input, an hour from now. */
function inAnHour() {
	const date = new Date(Date.now() + 3600_000);
	date.setSeconds(0, 0);
	return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function SocialPanel({
	initialVideo,
	onSignIn,
	accountLabel,
}: {
	initialVideo?: string | null;
	onSignIn: () => void;
	accountLabel?: string;
}) {
	const { locale } = useI18n();
	const [language, setLanguage] = useState<SocialLanguage>(locale.startsWith("zh") ? "zh" : "en");
	const m = socialMessages[language];

	const [status, setStatus] = useState<Status | null>(null);
	const [signingIn, setSigningIn] = useState<SocialPlatform | null>(null);
	const [selected, setSelected] = useState<string[]>([]);
	const [video, setVideo] = useState<{ path: string; bytes: number } | null>(null);
	const [title, setTitle] = useState("");
	const [text, setText] = useState("");
	const [visibility, setVisibility] = useState<"public" | "private">("public");
	const [madeWithAi, setMadeWithAi] = useState(true);
	const [when, setWhen] = useState<"now" | "schedule">("now");
	const [date, setDate] = useState(inAnHour);
	const [creator, setCreator] = useState<CreatorInfo | null>(null);
	// TikTok's rules: no default privacy, interactions unticked, disclosure off.
	const [tiktokPrivacy, setTiktokPrivacy] = useState("");
	const [allowComment, setAllowComment] = useState(false);
	const [allowDuet, setAllowDuet] = useState(false);
	const [allowStitch, setAllowStitch] = useState(false);
	const [disclose, setDisclose] = useState(false);
	const [yourBrand, setYourBrand] = useState(false);
	const [brandedContent, setBrandedContent] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [postingTo, setPostingTo] = useState("");
	const [error, setError] = useState("");
	const [result, setResult] = useState<Result | null>(null);

	useEffect(() => {
		void window.electronAPI.getSocialStatus().then(setStatus);
		return window.electronAPI.onSocialPublishProgress(setPostingTo);
	}, []);

	useEffect(() => {
		if (!initialVideo) return;
		void window.electronAPI.checkSocialVideo(initialVideo).then((reply) => {
			if (reply.success && reply.path)
				setVideo({ path: reply.path, bytes: reply.bytes ?? 0 });
		});
	}, [initialVideo]);

	const accounts = status?.accounts ?? [];
	const chosen = accounts.filter((a) => selected.includes(keyOf(a)));
	const tiktokAccounts = chosen.filter((a) => a.platform === "tiktok");
	const tiktokAccount = tiktokAccounts.length === 1 ? tiktokAccounts[0] : null;

	// TikTok wants its current rules for the creator fetched before each post.
	useEffect(() => {
		setCreator(null);
		setTiktokPrivacy("");
		if (!tiktokAccount) return;
		let live = true;
		void window.electronAPI
			.getSocialAccountOptions("tiktok", tiktokAccount.id)
			.then((reply) => {
				if (!live) return;
				if (reply.success) setCreator(reply.options as CreatorInfo);
				else setError(reply.error ?? "");
			});
		return () => {
			live = false;
		};
	}, [tiktokAccount?.id]);

	const connect = async (platform: SocialPlatform) => {
		setSigningIn(platform);
		setError("");
		const before = new Set(accounts.map(keyOf));
		const reply = await window.electronAPI.connectSocial(platform);
		setSigningIn(null);
		if (!reply.success) return setError(reply.error ?? "");
		const next = reply.accounts ?? [];
		setStatus((current) => (current ? { ...current, accounts: next } : current));
		// Newly connected accounts on the chosen platform are ready to post to.
		const added = next.filter((a) => !before.has(keyOf(a)) && a.platform === platform);
		setSelected((current) => [...current, ...added.map(keyOf)]);
	};
	const remove = async (account: Account) => {
		const reply = await window.electronAPI.removeSocial(account.platform, account.id);
		setStatus((current) => (current ? { ...current, accounts: reply.accounts } : current));
		setSelected((current) => current.filter((key) => key !== keyOf(account)));
	};
	const toggle = (key: string, on: boolean) =>
		setSelected((current) => (on ? [...current, key] : current.filter((k) => k !== key)));
	const chooseVideo = async () => {
		const picked = await window.electronAPI.pickSocialVideo();
		if (!picked) return;
		const reply = await window.electronAPI.checkSocialVideo(picked);
		if (!reply.success) return setError(reply.error ?? "");
		setError("");
		setVideo({ path: picked, bytes: reply.bytes ?? 0 });
	};

	const has = (platform: SocialPlatform) => chosen.some((a) => a.platform === platform);
	const xLength = [...text].length;
	const brandedPrivate = disclose && brandedContent && tiktokPrivacy === "SELF_ONLY";
	const tiktokReady =
		!has("tiktok") ||
		(Boolean(tiktokAccount && creator && tiktokPrivacy) &&
			(!disclose || yourBrand || brandedContent) &&
			!brandedPrivate);
	const canPublish =
		Boolean(video) &&
		chosen.length > 0 &&
		!publishing &&
		(!has("youtube") || title.trim().length >= 2) &&
		(!has("x") || xLength <= 280) &&
		tiktokReady;

	const publish = async () => {
		if (!video) return;
		setPublishing(true);
		setError("");
		setResult(null);
		setPostingTo("");
		const reply = await window.electronAPI.publishSocialPost({
			videoPath: video.path,
			accounts: chosen.map((a) => ({ platform: a.platform, id: a.id })),
			text,
			title: title.trim(),
			visibility,
			when,
			date: when === "schedule" ? new Date(date).toISOString() : undefined,
			madeWithAi,
			tiktok: has("tiktok")
				? {
						privacy: tiktokPrivacy,
						allowComment,
						allowDuet,
						allowStitch,
						yourBrand: disclose && yourBrand,
						brandedContent: disclose && brandedContent,
					}
				: undefined,
		});
		setPublishing(false);
		setPostingTo("");
		if (!reply.success && !reply.failed?.length) return setError(reply.error ?? "");
		setResult({
			links: (reply.posts ?? []).map((p) => ({ account: p.account, url: p.url })),
			failed: reply.failed ?? [],
		});
	};

	const notSetUp = SOCIAL_PLATFORMS.filter((p) => status && !status.platforms[p]).map(
		(p) => PLATFORM_LABELS[p],
	);

	return (
		<section
			aria-label={m.title}
			data-social-panel
			className="min-h-0 flex-1 overflow-y-auto p-6"
			lang={language === "zh" ? "zh-CN" : language}
		>
			<div className="mx-auto max-w-3xl space-y-5">
				<header className="space-y-2">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h1 className="text-2xl font-semibold">{m.title}</h1>
						<select
							aria-label={m.language}
							value={language}
							onChange={(event) => setLanguage(event.target.value as SocialLanguage)}
							className="rounded-lg border border-border bg-background p-2 text-sm"
						>
							<option value="zh">中文</option>
							<option value="en">English</option>
							<option value="ms">Bahasa Melayu</option>
						</select>
					</div>
					<p className="text-sm text-muted-foreground">{m.intro}</p>
				</header>

				<div className={card}>
					<h2 className="font-semibold">{m.account}</h2>
					{!ACCOUNTS_ENABLED ? (
						<p className="text-sm text-muted-foreground">{m.accountsOff}</p>
					) : accountLabel ? (
						<p className="text-sm">{fill(m.signedInAs, { name: accountLabel })}</p>
					) : (
						<Button variant="secondary" onClick={onSignIn}>
							{m.signIn}
						</Button>
					)}
				</div>

				<div className={card} data-social-accounts>
					<h2 className="font-semibold">{m.accounts}</h2>
					<p className="text-sm text-muted-foreground">{m.accountsHelp}</p>
					{accounts.length === 0 ? (
						<p className="text-sm">{m.noAccounts}</p>
					) : (
						<ul className="space-y-2">
							{accounts.map((account) => (
								<li
									key={keyOf(account)}
									className="flex items-center gap-3 rounded-xl border border-border bg-background p-2 text-sm"
								>
									<label className="flex min-w-0 flex-1 items-center gap-3">
										<input
											type="checkbox"
											checked={selected.includes(keyOf(account))}
											onChange={(event) =>
												toggle(keyOf(account), event.target.checked)
											}
										/>
										{account.picture && (
											<img
												src={account.picture}
												alt=""
												className="size-7 rounded-full"
											/>
										)}
										<span className="truncate">
											<span className="font-medium">{account.name}</span>
											<span className="text-muted-foreground">
												{" "}
												· {PLATFORM_LABELS[account.platform]}
												{account.detail ? ` · ${account.detail}` : ""}
											</span>
										</span>
									</label>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => void remove(account)}
									>
										{m.remove}
									</Button>
								</li>
							))}
						</ul>
					)}
					<div className="flex flex-wrap gap-2">
						{SOCIAL_PLATFORMS.map((platform) => (
							<Button
								key={platform}
								variant="secondary"
								size="sm"
								disabled={!status?.platforms[platform] || signingIn !== null}
								onClick={() => void connect(platform)}
							>
								{fill(m.connect, { platform: PLATFORM_LABELS[platform] })}
							</Button>
						))}
					</div>
					{signingIn && (
						<div className="flex flex-wrap items-center gap-2">
							<span role="status" className="text-sm">
								{fill(m.finishSignIn, { platform: PLATFORM_LABELS[signingIn] })}
							</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => void window.electronAPI.cancelSocialConnect()}
							>
								{m.cancel}
							</Button>
						</div>
					)}
					<p className="text-xs text-muted-foreground">{m.metaNote}</p>
					{notSetUp.length > 0 && (
						<p className="text-xs text-muted-foreground">
							{fill(m.notSetUp, { list: notSetUp.join(", ") })}
						</p>
					)}
				</div>

				{accounts.length > 0 && (
					<div className={card}>
						<div className="space-y-2">
							<h2 className="font-semibold">{m.video}</h2>
							<div className="flex flex-wrap items-center gap-2">
								<p className="min-w-0 flex-1 break-all text-sm" data-social-video>
									{video
										? `${video.path.split(/[\\/]/).pop()} · ${(video.bytes / 1024 / 1024).toFixed(1)} MiB`
										: m.noVideo}
								</p>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => void chooseVideo()}
								>
									{m.chooseVideo}
								</Button>
							</div>
						</div>
						<label className="block space-y-1 text-sm font-medium">
							<span>{m.postTitle}</span>
							<input
								value={title}
								maxLength={100}
								onChange={(event) => setTitle(event.target.value)}
								className={field}
							/>
						</label>
						<label className="block space-y-1 text-sm font-medium">
							<span>{m.text}</span>
							<textarea
								value={text}
								rows={5}
								maxLength={2200}
								onChange={(event) => setText(event.target.value)}
								className={`${field} font-normal`}
							/>
						</label>
						{has("x") && (
							<p
								className={`text-xs ${xLength > 280 ? "text-danger" : "text-muted-foreground"}`}
							>
								{fill(m.xLimit, { n: xLength })}
							</p>
						)}
						<div className="grid gap-3 sm:grid-cols-2">
							<label className="block space-y-1 text-sm font-medium">
								<span>{m.visibility}</span>
								<select
									value={visibility}
									onChange={(event) =>
										setVisibility(event.target.value as "public" | "private")
									}
									className={field}
								>
									<option value="public">{m.public}</option>
									<option value="private">{m.private}</option>
								</select>
							</label>
							<label className="block space-y-1 text-sm font-medium">
								<span>{m.when}</span>
								<select
									value={when}
									onChange={(event) => setWhen(event.target.value as typeof when)}
									className={field}
								>
									<option value="now">{m.now}</option>
									<option value="schedule">{m.schedule}</option>
								</select>
							</label>
						</div>
						{when === "schedule" && (
							<input
								type="datetime-local"
								aria-label={m.schedule}
								value={date}
								onChange={(event) => setDate(event.target.value)}
								className={field}
							/>
						)}
						<label className="flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								checked={madeWithAi}
								onChange={(event) => setMadeWithAi(event.target.checked)}
							/>
							{m.madeWithAi}
						</label>

						{tiktokAccounts.length > 1 && (
							<p role="alert" className="text-sm text-danger">
								{m.oneTiktok}
							</p>
						)}
						{tiktokAccount && (
							<div
								className="space-y-2 rounded-xl border border-border bg-background p-3"
								data-tiktok-settings
							>
								<h3 className="text-sm font-semibold">
									{fill(m.tiktok, {
										name: creator?.nickname || tiktokAccount.name,
									})}
								</h3>
								{!creator ? (
									<p role="status" className="text-sm">
										{m.tiktokLoading}
									</p>
								) : (
									<>
										<label className="block space-y-1 text-sm font-medium">
											<span>{m.tiktokPrivacy}</span>
											<select
												value={tiktokPrivacy}
												onChange={(event) =>
													setTiktokPrivacy(event.target.value)
												}
												className={field}
											>
												<option value="" disabled>
													{m.choose}
												</option>
												{creator.privacyOptions.map((option) => (
													<option
														key={option}
														value={option}
														disabled={
															option === "SELF_ONLY" &&
															disclose &&
															brandedContent
														}
													>
														{m.privacy[option] ?? option}
													</option>
												))}
											</select>
										</label>
										<div className="flex flex-wrap gap-4 text-sm">
											{(
												[
													[
														m.allowComment,
														allowComment,
														setAllowComment,
														creator.commentDisabled,
													],
													[
														m.allowDuet,
														allowDuet,
														setAllowDuet,
														creator.duetDisabled,
													],
													[
														m.allowStitch,
														allowStitch,
														setAllowStitch,
														creator.stitchDisabled,
													],
												] as const
											).map(([label, value, set, off]) => (
												<label
													key={label}
													className="flex items-center gap-2"
												>
													<input
														type="checkbox"
														disabled={off}
														checked={value && !off}
														onChange={(event) =>
															set(event.target.checked)
														}
													/>
													{label}
												</label>
											))}
										</div>
										<label className="flex items-start gap-2 text-sm">
											<input
												type="checkbox"
												checked={disclose}
												onChange={(event) =>
													setDisclose(event.target.checked)
												}
											/>
											{m.disclose}
										</label>
										{disclose && (
											<div className="space-y-1 pl-6 text-sm">
												<label className="flex items-start gap-2">
													<input
														type="checkbox"
														checked={yourBrand}
														onChange={(event) =>
															setYourBrand(event.target.checked)
														}
													/>
													{m.yourBrand}
												</label>
												<label className="flex items-start gap-2">
													<input
														type="checkbox"
														checked={brandedContent}
														onChange={(event) =>
															setBrandedContent(event.target.checked)
														}
													/>
													{m.brandedContent}
												</label>
												{(yourBrand || brandedContent) && (
													<p className="text-xs text-muted-foreground">
														{brandedContent
															? m.paidPartnership
															: m.promotional}
													</p>
												)}
												{brandedPrivate && (
													<p className="text-xs text-danger">
														{m.brandedPrivate}
													</p>
												)}
											</div>
										)}
										<p className="text-xs text-muted-foreground">
											{disclose && brandedContent
												? m.brandedConsent
												: m.musicConsent}{" "}
											{m.tiktokProcessing}
										</p>
									</>
								)}
							</div>
						)}

						<div className="flex flex-wrap gap-2">
							<Button disabled={!canPublish} onClick={() => void publish()}>
								{chosen.length === 1
									? m.publishOne
									: fill(m.publish, { n: chosen.length })}
							</Button>
							{publishing && (
								<Button
									variant="ghost"
									onClick={() => void window.electronAPI.cancelSocialPublish()}
								>
									{m.cancel}
								</Button>
							)}
						</div>
						{publishing && postingTo && (
							<p role="status">{fill(m.posting, { account: postingTo })}</p>
						)}
						{result && (
							<div
								role="status"
								className="space-y-1 rounded-xl border border-border bg-background p-3 text-sm"
							>
								{result.links.length > 0 && (
									<p className="font-medium">
										{result.links.length === 1
											? m.doneOne
											: fill(m.done, { n: result.links.length })}
									</p>
								)}
								{result.links.map((link) =>
									link.url ? (
										<button
											key={link.account}
											type="button"
											className="block text-left text-primary underline"
											onClick={() =>
												void window.electronAPI.openExternalUrl(
													link.url as string,
												)
											}
										>
											{link.account}: {link.url}
										</button>
									) : (
										<p key={link.account}>{link.account}</p>
									),
								)}
								{result.failed.length > 0 && (
									<p className="font-medium text-danger">{m.failedTitle}</p>
								)}
								{result.failed.map((f) => (
									<p key={f.account} className="text-danger">
										{f.account}: {f.error}
									</p>
								))}
							</div>
						)}
					</div>
				)}

				{error && (
					<p
						role="alert"
						className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm"
					>
						{error}
					</p>
				)}
			</div>
		</section>
	);
}
