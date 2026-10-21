import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import { ACCOUNTS_ENABLED } from "@/lib/productFeatures";
import {
	LINKABLE_PLATFORMS,
	POSTIZ_CLOUD_URL,
	PRESET_POSTIZ_SERVER,
	VIDEO_PLATFORMS,
} from "./socialLauncher";
import { PLATFORM_LABELS, type SocialLanguage, socialMessages } from "./socialMessages";

type DirectAccount = Awaited<
	ReturnType<typeof window.electronAPI.getDirectSocialStatus>
>["accounts"][number];

type Channel = NonNullable<
	Awaited<ReturnType<typeof window.electronAPI.listSocialChannels>>["channels"]
>[number];
type Stage = "uploading" | "processing" | "posting";

const fill = (text: string, values: Record<string, string | number>) =>
	text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
const card = "space-y-3 rounded-2xl border border-border bg-muted/30 p-4";
const field = "w-full rounded-lg border border-border bg-background p-2 text-sm";

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

	const [config, setConfig] = useState<{ baseUrl: string | null; hasKey: boolean } | null>(null);
	const [editing, setEditing] = useState(false);
	const [server, setServer] = useState<"cloud" | "self">(PRESET_POSTIZ_SERVER ? "self" : "cloud");
	const [address, setAddress] = useState(PRESET_POSTIZ_SERVER);
	const [apiKey, setApiKey] = useState("");
	const [channels, setChannels] = useState<Channel[]>([]);
	const [selected, setSelected] = useState<string[]>([]);
	const [video, setVideo] = useState<{ path: string; bytes: number } | null>(null);
	const [title, setTitle] = useState("");
	const [text, setText] = useState("");
	const [visibility, setVisibility] = useState<"public" | "private">("public");
	const [madeWithAi, setMadeWithAi] = useState(true);
	const [when, setWhen] = useState<"now" | "schedule" | "draft">("now");
	const [date, setDate] = useState(inAnHour);
	const [busy, setBusy] = useState<"connect" | "channels" | "publish" | null>(null);
	const [stage, setStage] = useState<Stage | null>(null);
	const [error, setError] = useState("");
	const [result, setResult] = useState<{
		count: number;
		warning?: string;
		viaPostiz: boolean;
		links: string[];
		failed: Array<{ account: string; error: string }>;
	} | null>(null);
	const [stageAccount, setStageAccount] = useState<string | undefined>();
	const [direct, setDirect] = useState<{
		platforms: { youtube: boolean };
		accounts: DirectAccount[];
	}>({ platforms: { youtube: false }, accounts: [] });
	const [signingIn, setSigningIn] = useState(false);

	const connected = Boolean(config?.baseUrl && config.hasKey) && !editing;
	/** Where the customer signs in to Postiz to copy an API key. */
	const postizSite = () => {
		if (server === "cloud") return "https://platform.postiz.com";
		try {
			return new URL(address.trim()).origin;
		} catch {
			return "https://postiz.com";
		}
	};

	const loadChannels = useCallback(async () => {
		setBusy("channels");
		setError("");
		const reply = await window.electronAPI.listSocialChannels();
		setBusy(null);
		if (!reply.success) return setError(reply.error ?? "");
		setChannels(reply.channels ?? []);
		setSelected((current) =>
			current.filter(
				(key) => key.startsWith("direct:") || reply.channels?.some((c) => c.id === key),
			),
		);
	}, []);

	useEffect(() => {
		void window.electronAPI.getSocialConfig().then((next) => {
			setConfig(next);
			if (next.baseUrl && next.baseUrl !== POSTIZ_CLOUD_URL) {
				setServer("self");
				setAddress(next.baseUrl);
			}
			if (next.baseUrl && next.hasKey) void loadChannels();
		});
		void window.electronAPI.getDirectSocialStatus().then(setDirect);
		return window.electronAPI.onSocialPublishProgress((next, account) => {
			setStage(next);
			setStageAccount(account);
		});
	}, [loadChannels]);

	useEffect(() => {
		if (!initialVideo) return;
		void window.electronAPI.checkSocialVideo(initialVideo).then((reply) => {
			if (reply.success && reply.path)
				setVideo({ path: reply.path, bytes: reply.bytes ?? 0 });
		});
	}, [initialVideo]);

	const connect = async () => {
		setBusy("connect");
		setError("");
		const reply = await window.electronAPI.saveSocialConfig(
			server === "cloud" ? POSTIZ_CLOUD_URL : address,
			apiKey,
		);
		setBusy(null);
		if (!reply.success) return setError(reply.error ?? "");
		setApiKey("");
		setEditing(false);
		setConfig({ baseUrl: reply.baseUrl ?? null, hasKey: true });
		void loadChannels();
	};
	const disconnect = async () => {
		await window.electronAPI.clearSocialConfig();
		setConfig({ baseUrl: null, hasKey: false });
		setChannels([]);
		setSelected([]);
	};
	const link = async (platform: string) => {
		setError("");
		const reply = await window.electronAPI.connectSocialChannel(platform);
		if (!reply.success) setError(reply.error ?? "");
	};
	const connectDirect = async () => {
		setSigningIn(true);
		setError("");
		const reply = await window.electronAPI.connectDirectSocial("youtube");
		setSigningIn(false);
		if (!reply.success) return setError(reply.error ?? "");
		const accounts = reply.accounts ?? [];
		// A newly connected account is ready to post to.
		const added = accounts.find((a) => !direct.accounts.some((d) => d.id === a.id));
		setDirect((current) => ({ ...current, accounts }));
		if (added) setSelected((current) => [...current, `direct:${added.id}`]);
	};
	const removeDirect = async (account: DirectAccount) => {
		const reply = await window.electronAPI.removeDirectSocial(account.platform, account.id);
		setDirect((current) => ({ ...current, accounts: reply.accounts }));
		setSelected((current) => current.filter((key) => key !== `direct:${account.id}`));
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

	const targets = [
		...direct.accounts.map((a) => ({
			key: `direct:${a.id}`,
			id: a.id,
			identifier: a.platform as string,
			via: "direct" as const,
		})),
		...(connected ? channels : [])
			.filter((c) => !c.disabled && VIDEO_PLATFORMS.has(c.identifier))
			.map((c) => ({ key: c.id, id: c.id, identifier: c.identifier, via: undefined })),
	];
	const chosen = targets.filter((t) => selected.includes(t.key));
	const has = (platform: string) => chosen.some((c) => c.identifier === platform);
	const xLength = [...text].length;
	const canPublish =
		Boolean(video) &&
		chosen.length > 0 &&
		busy === null &&
		(!has("youtube") || title.trim().length >= 2) &&
		(!has("x") || xLength <= 280);

	const publish = async () => {
		if (!video) return;
		setBusy("publish");
		setError("");
		setResult(null);
		setStage(null);
		const reply = await window.electronAPI.publishSocialPost({
			videoPath: video.path,
			channels: chosen.map((c) => ({
				id: c.id,
				identifier: c.identifier,
				...(c.via ? { via: c.via } : {}),
			})),
			text,
			title: title.trim(),
			visibility,
			when,
			date: when === "schedule" ? new Date(date).toISOString() : undefined,
			madeWithAi,
		});
		setBusy(null);
		setStage(null);
		if (!reply.success) return setError(reply.error ?? "");
		setResult({
			count: reply.posts?.length ?? chosen.length,
			warning: reply.warning,
			viaPostiz: chosen.some((c) => !c.via),
			links: (reply.posts ?? []).flatMap((p) => (p.url ? [p.url] : [])),
			failed: reply.failed ?? [],
		});
	};

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

				<div className={card} data-social-direct>
					<h2 className="font-semibold">{m.direct}</h2>
					<p className="text-sm text-muted-foreground">{m.directHelp}</p>
					{direct.accounts.length > 0 && (
						<ul className="space-y-2">
							{direct.accounts.map((account) => (
								<li
									key={account.id}
									className="flex items-center gap-3 rounded-xl border border-border bg-background p-2 text-sm"
								>
									<label className="flex min-w-0 flex-1 items-center gap-3">
										<input
											type="checkbox"
											checked={selected.includes(`direct:${account.id}`)}
											onChange={(event) =>
												toggle(`direct:${account.id}`, event.target.checked)
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
											</span>
										</span>
									</label>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => void removeDirect(account)}
									>
										{m.remove}
									</Button>
								</li>
							))}
						</ul>
					)}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							disabled={!direct.platforms.youtube || signingIn}
							onClick={() => void connectDirect()}
						>
							{m.connectYoutube}
						</Button>
						{signingIn && (
							<>
								<span role="status" className="text-sm">
									{m.finishInBrowser}
								</span>
								<Button
									variant="ghost"
									size="sm"
									onClick={() =>
										void window.electronAPI.cancelDirectSocialConnect()
									}
								>
									{m.cancel}
								</Button>
							</>
						)}
					</div>
					{!direct.platforms.youtube && (
						<p className="text-xs text-muted-foreground">{m.directNotSetUp}</p>
					)}
					<p className="text-xs text-muted-foreground">{m.moreSoon}</p>
				</div>

				<div className={card}>
					<h2 className="font-semibold">{m.postiz}</h2>
					<p className="text-sm text-muted-foreground">{m.postizHelp}</p>
					{connected ? (
						<div className="flex flex-wrap items-center gap-2">
							<p className="flex-1 break-all text-sm" data-social-connected>
								{fill(m.connected, { url: config?.baseUrl ?? "" })}
							</p>
							<Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
								{m.change}
							</Button>
							<Button variant="ghost" size="sm" onClick={() => void disconnect()}>
								{m.disconnect}
							</Button>
						</div>
					) : (
						<div className="space-y-3">
							<fieldset className="grid gap-2 sm:grid-cols-2">
								<legend className="sr-only">{m.address}</legend>
								{(["self", "cloud"] as const).map((option) => (
									<label
										key={option}
										className={`flex cursor-pointer gap-2 rounded-xl border bg-background p-3 text-sm ${server === option ? "border-primary" : "border-border"}`}
									>
										<input
											type="radio"
											name="postiz-server"
											checked={server === option}
											onChange={() => setServer(option)}
										/>
										<span className="space-y-1">
											<span className="block font-medium">
												{option === "cloud" ? m.cloud : m.selfHosted}
											</span>
											<span className="block text-xs text-muted-foreground">
												{option === "cloud"
													? m.cloudHelp
													: m.selfHostedHelp}
											</span>
										</span>
									</label>
								))}
							</fieldset>
							{server === "self" && (
								<input
									aria-label={m.address}
									placeholder="https://postiz.example.com"
									value={address}
									onChange={(event) => setAddress(event.target.value)}
									className={field}
								/>
							)}
							<input
								aria-label={m.apiKey}
								type="password"
								autoComplete="off"
								placeholder={config?.hasKey ? m.keepKey : m.apiKey}
								value={apiKey}
								onChange={(event) => setApiKey(event.target.value)}
								className={field}
							/>
							<div className="flex flex-wrap gap-2">
								<Button
									disabled={
										busy !== null ||
										(!apiKey.trim() && !config?.hasKey) ||
										(server === "self" && !address.trim())
									}
									onClick={() => void connect()}
								>
									{busy === "connect" ? m.connecting : m.connect}
								</Button>
								<Button
									variant="ghost"
									onClick={() =>
										void window.electronAPI.openExternalUrl(postizSite())
									}
								>
									{m.openPostiz}
								</Button>
							</div>
						</div>
					)}
				</div>

				{connected && (
					<div className={card}>
						<div className="flex items-center justify-between gap-2">
							<h2 className="font-semibold">{m.channels}</h2>
							<Button
								variant="secondary"
								size="sm"
								disabled={busy !== null}
								onClick={() => void loadChannels()}
							>
								{m.refresh}
							</Button>
						</div>
						<p className="text-sm text-muted-foreground">{m.channelsHelp}</p>
						{channels.length === 0 ? (
							<p className="text-sm">{m.noChannels}</p>
						) : (
							<ul className="space-y-2">
								{channels.map((channel) => {
									const usable =
										!channel.disabled &&
										VIDEO_PLATFORMS.has(channel.identifier);
									return (
										<li key={channel.id}>
											<label className="flex items-center gap-3 rounded-xl border border-border bg-background p-2 text-sm">
												<input
													type="checkbox"
													disabled={!usable}
													checked={selected.includes(channel.id)}
													onChange={(event) =>
														toggle(channel.id, event.target.checked)
													}
												/>
												{channel.picture && (
													<img
														src={channel.picture}
														alt=""
														className="size-7 rounded-full"
													/>
												)}
												<span className="flex-1 truncate">
													<span className="font-medium">
														{channel.name}
													</span>
													<span className="text-muted-foreground">
														{" "}
														·{" "}
														{PLATFORM_LABELS[channel.identifier] ??
															channel.identifier.replace(/^./, (c) =>
																c.toUpperCase(),
															)}
													</span>
												</span>
												{!usable && (
													<span className="text-xs text-muted-foreground">
														{channel.disabled
															? m.disabledChannel
															: m.unsupported}
													</span>
												)}
											</label>
										</li>
									);
								})}
							</ul>
						)}
						<div className="space-y-2">
							<h3 className="text-sm font-medium">{m.link}</h3>
							<div className="flex flex-wrap gap-2">
								{LINKABLE_PLATFORMS.map((platform) => (
									<Button
										key={platform}
										variant="secondary"
										size="sm"
										onClick={() => void link(platform)}
									>
										{PLATFORM_LABELS[platform]}
									</Button>
								))}
							</div>
							<p className="text-xs text-muted-foreground">{m.linkHelp}</p>
						</div>
					</div>
				)}

				{(connected || direct.accounts.length > 0) && (
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
								maxLength={5000}
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
									<option value="draft">{m.draft}</option>
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
						{has("tiktok") && (
							<p className="text-xs text-muted-foreground">{m.tiktokPrivate}</p>
						)}
						<div className="flex flex-wrap gap-2">
							<Button disabled={!canPublish} onClick={() => void publish()}>
								{chosen.length === 1
									? m.publishOne
									: fill(m.publish, { n: chosen.length })}
							</Button>
							{busy === "publish" && (
								<Button
									variant="ghost"
									onClick={() => void window.electronAPI.cancelSocialPublish()}
								>
									{m.cancel}
								</Button>
							)}
						</div>
						{busy === "publish" && stage && (
							<p role="status">
								{m[stage]}
								{stageAccount ? ` · ${stageAccount}` : ""}
							</p>
						)}
						{result && (
							<div
								role="status"
								className="rounded-xl border border-success/40 bg-success/5 p-3 text-sm"
							>
								<p className="font-medium">
									{result.count === 1
										? m.doneOne
										: fill(m.done, { n: result.count })}
								</p>
								{result.links.map((link) => (
									<button
										key={link}
										type="button"
										className="block text-primary underline"
										onClick={() =>
											void window.electronAPI.openExternalUrl(link)
										}
									>
										{link}
									</button>
								))}
								{result.failed.map((f) => (
									<p key={f.account} className="text-danger">
										{f.account}: {f.error}
									</p>
								))}
								{result.viaPostiz && (
									<p className="text-muted-foreground">{m.doneHelp}</p>
								)}
								{result.warning && (
									<p className="text-muted-foreground">{result.warning}</p>
								)}
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
