import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, ipcMain } from "electron";
import { enhanceVoice, getRnnoiseStatus } from "../audioEnhancement/rnnoise";
import { extractCaptionAudioSource, resolveCaptionAudioCandidates } from "../captions/generate";
import { offlineToolsRoot } from "../captions/vad";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { rememberApprovedLocalReadPath, resolveApprovedLocalMediaPath } from "../project/manager";
import { detectScenes, getSceneStatus } from "../scene/detect";
import { getSherpaStatus, transcribeSherpa } from "../sherpa/transcribe";
import { normalizeVideoSourcePath } from "../utils";

export function registerOfflineTools(running: Map<number, AbortController>) {
	ipcMain.handle("offline-tools-status", async () => {
		const root = offlineToolsRoot();
		const [rnnoise, scene, sherpa] = await Promise.all([
			getRnnoiseStatus(path.join(root, "rnnoise")),
			getSceneStatus(path.join(root, "scene")),
			getSherpaStatus(path.join(root, "sherpa")),
		]);
		return { rnnoise, scene, sherpa };
	});
	ipcMain.handle(
		"offline-tools-run",
		async (
			event,
			input: {
				kind: "scene" | "sherpa" | "rnnoise";
				videoPath: string;
				language?: string;
				track?: "mic" | "mixed";
			},
		) => {
			if (running.has(event.sender.id))
				return { success: false, error: "Analysis already running" };
			const controller = new AbortController(),
				abort = () => controller.abort();
			running.set(event.sender.id, controller);
			event.sender.once("destroyed", abort);
			let work: string | undefined;
			try {
				if (
					!input ||
					!["scene", "sherpa", "rnnoise"].includes(input.kind) ||
					typeof input.videoPath !== "string"
				)
					throw Error("Invalid offline tool request");
				const normalized = normalizeVideoSourcePath(input.videoPath);
				const approved = normalized && (await resolveApprovedLocalMediaPath(normalized));
				if (!approved) throw Error("Select an approved local recording first");
				const root = offlineToolsRoot(),
					signal = controller.signal;
				if (input.kind === "scene")
					return {
						success: true,
						kind: "scene",
						analysis: await detectScenes({
							root: path.join(root, "scene"),
							videoPath: approved,
							signal,
						}),
					};
				const candidates = await resolveCaptionAudioCandidates(approved);
				for (const candidate of candidates)
					if (!(await resolveApprovedLocalMediaPath(candidate.path)))
						throw Error("Linked audio is not approved");
				if (input.kind === "rnnoise") {
					if (input.track !== "mic" && input.track !== "mixed")
						throw Error("Select microphone or explicitly choose mixed voice audio");
					const source =
						input.track === "mic"
							? candidates.find((c) => c.label === "microphone audio sidecar")?.path
							: approved;
					if (!source)
						throw Error(
							"No microphone track was saved. Choose mixed audio only if the recording contains voice.",
						);
					const asset = await enhanceVoice({
						sourcePath: source,
						outputDirectory: path.join(app.getPath("userData"), "derived-audio"),
						ffmpegPath: getFfmpegBinaryPath(),
						runtimeRoot: path.join(root, "rnnoise"),
						trackId: input.track,
						signal,
					});
					await rememberApprovedLocalReadPath(asset.audioPath);
					return { success: true, kind: "rnnoise", track: input.track, asset };
				}
				if (input.language !== undefined && !/^(auto|en|zh|ms)$/.test(input.language))
					throw Error("Unsupported language");
				work = await fs.mkdtemp(path.join(os.tmpdir(), "jsox-tool-audio-"));
				const wavPath = path.join(work, "source.wav");
				await extractCaptionAudioSource({
					videoPath: approved,
					ffmpegPath: getFfmpegBinaryPath(),
					wavPath,
					candidates,
					signal,
				});
				const transcript = await transcribeSherpa({
					root: path.join(root, "sherpa"),
					wavPath,
					ffmpegPath: getFfmpegBinaryPath(),
					ffprobePath: getFfprobeBinaryPath(),
					language: input.language ?? "auto",
					signal,
				});
				return { success: true, kind: "sherpa", transcript };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : "Offline tool failed",
				};
			} finally {
				if (work) {
					const canonical = await fs.realpath(work).catch(() => null),
						base = await fs.realpath(os.tmpdir());
					if (
						canonical &&
						path.dirname(canonical) === base &&
						path.basename(canonical).startsWith("jsox-tool-audio-")
					)
						await fs.rm(canonical, { recursive: true, force: true });
				}
				running.delete(event.sender.id);
				event.sender.removeListener("destroyed", abort);
			}
		},
	);
}
