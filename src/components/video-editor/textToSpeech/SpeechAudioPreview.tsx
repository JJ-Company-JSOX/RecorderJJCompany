import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";

/** Uses the generated files themselves, so preview and timeline insertion share the voice. */
export function SpeechAudioPreview({ clips }: { clips: Array<{ audioPath: string }> }) {
	const { t } = useI18n();
	const audioRef = useRef<HTMLAudioElement>(null);
	const [index, setIndex] = useState(0);
	const [error, setError] = useState(false);
	const [needsPlay, setNeedsPlay] = useState(false);
	const path = clips[index]?.audioPath;
	useEffect(() => {
		let active = true;
		let revoke: (() => void) | undefined;
		const audio = audioRef.current;
		setError(false);
		setNeedsPlay(false);
		if (audio && path) {
			void resolveMediaElementSource(path)
				.then(async (resolved) => {
					if (!active) {
						resolved.revoke();
						return;
					}
					revoke = resolved.revoke;
					audio.src = resolved.src;
					try {
						await audio.play();
					} catch (reason) {
						if (
							!active ||
							(reason instanceof DOMException && reason.name === "AbortError")
						)
							return;
						if (reason instanceof DOMException && reason.name === "NotAllowedError")
							setNeedsPlay(true);
						else setError(true);
					}
				})
				.catch(() => {
					if (active) setError(true);
				});
		}
		return () => {
			active = false;
			if (audio) {
				audio.pause();
				audio.removeAttribute("src");
				audio.load();
			}
			revoke?.();
		};
	}, [path]);
	return (
		<div className="space-y-2">
			{clips.length > 1 && (
				<label className="flex items-center gap-2 text-sm">
					{t("editor.textToSpeech.previewParagraph", "Preview paragraph")}
					<select
						value={index}
						onChange={(event) => setIndex(Number(event.target.value))}
						className="rounded-lg bg-background px-2 py-1"
					>
						{clips.map((clip, i) => (
							<option key={`${i}-${clip.audioPath}`} value={i}>
								{i + 1} / {clips.length}
							</option>
						))}
					</select>
				</label>
			)}
			<audio
				ref={audioRef}
				controls
				className="w-full"
				aria-label={t("editor.textToSpeech.previewText", "Preview text")}
				onEnded={() => {
					if (index + 1 < clips.length) setIndex(index + 1);
				}}
				onPlay={() => setNeedsPlay(false)}
				onError={() => setError(true)}
			/>
			{needsPlay && (
				<p className="text-sm text-muted-foreground">
					{t("editor.textToSpeech.pressPlay", "Press Play above to listen.")}
				</p>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{t(
						"editor.textToSpeech.playbackFailed",
						"Could not play the generated voice. You can retry the preview; the generated file is preserved.",
					)}
				</p>
			)}
		</div>
	);
}
