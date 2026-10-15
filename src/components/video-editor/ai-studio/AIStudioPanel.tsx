import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { studioMessages, type StudioLanguage } from "./messages";
import {
	MAX_TEXT_LENGTH,
	redactText,
	reviewReady,
	scanSensitiveText,
	videoFileError,
	videoMetadataValid,
	type ScanResult,
} from "./preflight";

export function AIStudioPanel() {
	const { locale } = useI18n();
	const [language, setLanguage] = useState<StudioLanguage>(locale.startsWith("zh") ? "zh" : "en");
	const m = studioMessages[language];
	const [file, setFile] = useState<File | null>(null);
	const [inputKey, setInputKey] = useState(0);
	const [error, setError] = useState<"type" | "size" | "invalid" | null>(null);
	const [mediaState, setMediaState] = useState<"empty" | "checking" | "valid" | "invalid">(
		"empty",
	);
	const [text, setText] = useState("");
	const [scan, setScan] = useState<ScanResult | null>(null);
	const [reviewed, setReviewed] = useState<Set<string>>(new Set());
	const [visualReviewed, setVisualReviewed] = useState(false);
	const [googleConsent, setGoogleConsent] = useState(false);
	const [geminiConsent, setGeminiConsent] = useState(false);
	const [prepared, setPrepared] = useState(false);
	const [source, setSource] = useState("");
	// Never put File, pasted text, findings or acknowledgements in persistent storage.
	useEffect(() => {
		if (!file) {
			setSource("");
			return;
		}
		const url = URL.createObjectURL(file);
		setSource(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);
	function invalidateReview() {
		setReviewed(new Set());
		setVisualReviewed(false);
		setGoogleConsent(false);
		setGeminiConsent(false);
		setPrepared(false);
	}
	function selectFile(next: File | null) {
		invalidateReview();
		setScan(null);
		setText("");
		setSource("");
		const nextError = next ? videoFileError(next) : null;
		setError(nextError);
		setFile(nextError ? null : next);
		setMediaState(next && !nextError ? "checking" : "empty");
	}
	function inspect(value: string) {
		invalidateReview();
		setScan(scanSensitiveText(value));
	}
	const ready = reviewReady({
		mediaValid: mediaState === "valid",
		scan,
		reviewed,
		visualReviewed,
		googleConsent,
		geminiConsent,
	});
	const redacted = useMemo(() => (scan ? redactText(text, scan.findings) : ""), [text, scan]);
	const checkClass = "flex items-start gap-3 rounded-xl border border-border p-3 text-sm";
	return (
		<section
			aria-label="AI Studio"
			className="min-h-0 flex-1 overflow-y-auto p-6"
			lang={language === "zh" ? "zh-CN" : language}
		>
			<div className="mx-auto max-w-3xl space-y-5">
				<header className="space-y-2">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h1 className="text-2xl font-semibold">{m.title}</h1>
						<select
							aria-label="Studio language"
							value={language}
							onChange={(event) => setLanguage(event.target.value as StudioLanguage)}
							className="rounded-lg border border-border bg-background p-2 text-sm"
						>
							<option value="zh">中文</option>
							<option value="en">English</option>
							<option value="ms">Bahasa Melayu</option>
						</select>
					</div>
					<p className="text-sm text-muted-foreground">{m.intro}</p>
				</header>
				<div className="space-y-3 rounded-2xl bg-muted/40 p-4">
					<label className="block space-y-2 font-medium">
						<span>{m.choose}</span>
						<input
							key={inputKey}
							aria-label={m.choose}
							type="file"
							accept=".mp4,.mov,.webm"
							className="block w-full text-sm"
							onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
						/>
					</label>
					<p className="text-xs text-muted-foreground">{m.fileHelp}</p>
					{file && (
						<p className="break-all text-sm">
							{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MiB
						</p>
					)}
					{source && (
						<video
							key={source}
							aria-label={m.preview}
							src={source}
							controls
							preload="metadata"
							className="max-h-72 w-full rounded-xl bg-black"
							onLoadedMetadata={(event) => {
								const video = event.currentTarget;
								const valid = videoMetadataValid(
									video.duration,
									video.videoWidth,
									video.videoHeight,
								);
								setMediaState(valid ? "valid" : "invalid");
								setError(valid ? null : "invalid");
							}}
							onError={() => {
								setMediaState("invalid");
								setError("invalid");
								setPrepared(false);
							}}
						/>
					)}
					{mediaState === "checking" && <p role="status">{m.validating}</p>}
					{error && (
						<p role="alert" className="text-sm text-danger">
							{m[error]}
						</p>
					)}
				</div>
				<div className="space-y-3">
					<label className="block space-y-2 text-sm font-medium">
						<span>{m.text}</span>
						<textarea
							value={text}
							maxLength={MAX_TEXT_LENGTH}
							rows={5}
							aria-label={m.text}
							spellCheck={false}
							className="w-full rounded-xl border border-border bg-background p-3 font-normal"
							onChange={(event) => {
								setText(event.target.value);
								setScan(null);
								invalidateReview();
							}}
						/>
					</label>
					<p className="text-xs text-muted-foreground">
						{m.textHelp} ({text.length}/{MAX_TEXT_LENGTH})
					</p>
					<Button variant="secondary" onClick={() => inspect(text)}>
						{m.scan}
					</Button>
					{scan && (
						<div className="space-y-3" aria-label={m.results}>
							<h2 className="font-semibold">
								{m.results} · {scan.findings.length}
							</h2>
							{!scan.complete && <p role="alert">{m.limit}</p>}
							{scan.complete && scan.findings.length === 0 && (
								<p className="text-sm">{m.none}</p>
							)}
							<ul className="max-h-64 space-y-2 overflow-y-auto">
								{scan.findings.map((item) => (
									<li key={item.id}>
										<label className={checkClass}>
											<input
												type="checkbox"
												checked={reviewed.has(item.id)}
												onChange={(event) => {
													const next = new Set(reviewed);
													if (event.target.checked) next.add(item.id);
													else next.delete(item.id);
													setReviewed(next);
													setPrepared(false);
												}}
											/>
											<span>
												{m.item} · {m[item.kind]} · {m.range}{" "}
												{item.start + 1}–{item.end}
											</span>
										</label>
									</li>
								))}
							</ul>
							{scan.findings.length > 0 && (
								<>
									<Button
										variant="outline"
										onClick={() => {
											setText(redacted);
											inspect(redacted);
										}}
									>
										{m.redact}
									</Button>
									<p className="text-xs text-muted-foreground">{m.redactHelp}</p>
								</>
							)}
						</div>
					)}
				</div>
				<label className={checkClass}>
					<input
						type="checkbox"
						checked={visualReviewed}
						onChange={(event) => {
							setVisualReviewed(event.target.checked);
							setPrepared(false);
						}}
					/>
					<span>{m.visual}</span>
				</label>
				<div className="space-y-3 rounded-2xl border border-border p-4">
					<h2 className="font-semibold">{m.disclosure}</h2>
					<p className="text-sm">{m.google}</p>
					<p className="text-sm">{m.gemini}</p>
					<p className="text-sm text-muted-foreground">{m.stock}</p>
					<label className={checkClass}>
						<input
							type="checkbox"
							checked={googleConsent}
							onChange={(event) => {
								setGoogleConsent(event.target.checked);
								setPrepared(false);
							}}
						/>
						<span>{m.consentGoogle}</span>
					</label>
					<label className={checkClass}>
						<input
							type="checkbox"
							checked={geminiConsent}
							onChange={(event) => {
								setGeminiConsent(event.target.checked);
								setPrepared(false);
							}}
						/>
						<span>{m.consentGemini}</span>
					</label>
				</div>
				<div className="flex flex-wrap gap-3">
					<Button disabled={!ready || prepared} onClick={() => setPrepared(true)}>
						{m.prepare}
					</Button>
					<Button
						variant="ghost"
						onClick={() => {
							selectFile(null);
							setInputKey((value) => value + 1);
						}}
					>
						{m.reset}
					</Button>
				</div>
				{prepared && ready && (
					<p role="status" className="rounded-xl bg-primary/10 p-4 text-sm">
						{m.ready}
					</p>
				)}
				<p className="text-sm text-muted-foreground">{m.blocked}</p>
				<p className="pb-4 text-xs text-muted-foreground">{m.privacy}</p>
			</div>
		</section>
	);
}
