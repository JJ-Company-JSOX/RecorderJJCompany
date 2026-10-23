import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/contexts/I18nContext";

/** Disclosure only: model downloads are always triggered by the user's Download button. */
export function SpeechModelDownloadInfo({ downloading }: { downloading: boolean }) {
	const { t } = useI18n();
	const [destination, setDestination] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		void window.electronAPI
			.getWhisperSmallModelStatus()
			.then((result) => {
				if (active && result.success)
					setDestination(result.downloadPath ?? result.path ?? null);
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, []);
	return (
		<div className="space-y-2 text-xs text-muted-foreground">
			<p>
				{t(
					"settings.captions.modelDisclosure",
					"Whisper small: approximately 500 MB download. Local CPU recognition; speed depends on your computer. Model and whisper.cpp: MIT license.",
				)}
			</p>
			{destination && (
				<p className="break-all">
					{t("settings.captions.modelLocation", "Storage location")}: {destination}
				</p>
			)}
			{downloading && (
				<Button
					type="button"
					variant="outline"
					className="w-full"
					onClick={async () => {
						try {
							const result = await window.electronAPI.cancelWhisperModelDownload();
							if (!result.success)
								toast.error(
									t(
										"settings.captions.downloadNotRunning",
										"The download has already finished. Refresh the model status.",
									),
								);
						} catch (error) {
							toast.error(String(error));
						}
					}}
				>
					{t("settings.captions.cancelDownload", "Cancel download")}
				</Button>
			)}
		</div>
	);
}
