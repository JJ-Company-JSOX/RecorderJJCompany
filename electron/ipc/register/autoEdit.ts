import path from "node:path";
import { app, ipcMain } from "electron";
import { BUNDLED_MODEL_ID } from "../../../src/components/video-editor/auto-edit/bundledTypes";
import type { EditPlan } from "../../../src/components/video-editor/auto-edit/plan";
import { bundledAiStatus, startBundledAi, stopBundledAi } from "../autoEdit/bundled";
import { analyzeLocalMedia } from "../autoEdit/media";
import { inspectLocalModel, LocalPlanReviewer } from "../autoEdit/reviewer";
import { analyzeVideoFrames } from "../autoEdit/vision";
import { analyzeSpeechWindow, mergeSpeechPlans } from "../autoEdit/speechPlan";
import { boundSpeechCues, speechWindows } from "../autoEdit/transcript";
import type { SpeechTranscript } from "../../../src/components/video-editor/auto-edit/speechTypes";
import { generateBundledSpeechTranscript, getBundledSpeechStatus } from "../captions/bundledSpeech";
import { resolveCaptionAudioCandidates } from "../captions/generate";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { resolveApprovedLocalMediaPath } from "../project/manager";
import { getCompanionAudioStartDelayMs } from "../recording/diagnostics";
import { normalizeVideoSourcePath } from "../utils";
import { registerOfflineTools } from "./offlineTools";
import { protectSilenceWithVad } from "../captions/vadProtection";

export function registerAutoEditHandlers() {
	const bundledRoot = () =>
		app.isPackaged
			? path.join(process.resourcesPath, "offline-ai")
			: path.join(app.getAppPath(), "vendor/offline-ai/win32-x64");
	app.once("before-quit", stopBundledAi);
	ipcMain.handle("auto-edit-bundled-status", () => bundledAiStatus(bundledRoot()));
	ipcMain.handle("auto-edit-model-info", async (_event, model: string) => {
		try {
			return { success: true, info: await inspectLocalModel(model) };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Local model inspection failed",
			};
		}
	});
	const running = new Map<number, AbortController>();
	registerOfflineTools(running);
	app.once("before-quit", () => {
		for (const controller of running.values()) controller.abort();
	});
	ipcMain.handle("auto-edit-speech-status", () => getBundledSpeechStatus());
	ipcMain.handle(
		"auto-edit-complete",
		async (event, input: { videoPath: string; language?: string }) => {
			if (running.has(event.sender.id))
				return { success: false, error: "Analysis already running" };
			const controller = new AbortController();
			running.set(event.sender.id, controller);
			const abort = () => controller.abort();
			event.sender.once("destroyed", abort);
			let session: Awaited<ReturnType<typeof startBundledAi>> | undefined;
			const progress = (stage: string) => {
				if (!event.sender.isDestroyed())
					event.sender.send("auto-edit-complete-progress", stage);
			};
			try {
				if (
					!input ||
					typeof input.videoPath !== "string" ||
					(input.language !== undefined && !/^(auto|en|zh|ms)$/.test(input.language))
				)
					throw Error("Invalid speech editing request");
				const normalized = normalizeVideoSourcePath(input.videoPath);
				const approved = normalized && (await resolveApprovedLocalMediaPath(normalized));
				if (!approved) throw Error("Select an approved local recording first");
				const candidates = await resolveCaptionAudioCandidates(approved);
				const companions = [];
				for (const candidate of candidates) {
					if (!(await resolveApprovedLocalMediaPath(candidate.path)))
						throw Error("Linked audio is not approved");
					if (candidate.path !== approved)
						companions.push({
							path: candidate.path,
							delayMs: (await getCompanionAudioStartDelayMs(candidate.path)) ?? 0,
						});
				}
				progress("media");
				const evidence = await analyzeLocalMedia({
					videoPath: approved,
					companions,
					ffmpegPath: getFfmpegBinaryPath(),
					ffprobePath: getFfprobeBinaryPath(),
					signal: controller.signal,
				});
				if (evidence.durationMs > 600_000)
					throw Error(
						"Offline automatic editing currently supports recordings up to 10 minutes",
					);
				progress("transcribe");
				const recognized = await generateBundledSpeechTranscript({
					videoPath: approved,
					language: input.language ?? "auto",
					signal: controller.signal,
					candidates,
				});
				const cues = boundSpeechCues(recognized.cues, evidence.durationMs);
				evidence.silentRanges = protectSilenceWithVad(
					evidence.silentRanges,
					"vadEvidence" in recognized ? recognized.vadEvidence : null,
				);
				if (!cues.length)
					throw Error(
						"No usable speech was recognized. Use the local or visual plan for a recording without speech.",
					);
				controller.signal.throwIfAborted();
				const transcript: SpeechTranscript = {
					version: 1,
					durationMs: evidence.durationMs,
					audioVerified: evidence.audioVerified,
					alignmentVerified:
						evidence.audioVerified &&
						!candidates.some((c) => c.label === "linked webcam recording"),
					cues,
				};
				progress("understand");
				session = await startBundledAi(bundledRoot(), controller.signal);
				// Bounded windows keep the model context small; no transcript is sent off-device.
				const windows: Awaited<ReturnType<typeof analyzeSpeechWindow>>[] = [];
				for (const window of speechWindows(transcript)) {
					controller.signal.throwIfAborted();
					const result = await analyzeSpeechWindow(window, session.complete);
					windows.push(result);
				}
				progress("vision");
				const analysis = await analyzeVideoFrames({
					videoPath: approved,
					model: BUNDLED_MODEL_ID,
					count: 4,
					ffmpegPath: getFfmpegBinaryPath(),
					ffprobePath: getFfprobeBinaryPath(),
					signal: controller.signal,
					bundled: { name: "Qwen3-VL-2B-Instruct Q4_K_M", describe: session.describe },
				});
				return {
					success: true,
					evidence,
					speech: mergeSpeechPlans(transcript, windows),
					analysis,
				};
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Offline automatic editing failed",
				};
			} finally {
				await session?.close();
				running.delete(event.sender.id);
				event.sender.removeListener("destroyed", abort);
			}
		},
	);
	ipcMain.handle(
		"auto-edit-vision",
		async (event, input: { videoPath: string; model: string; count: number }) => {
			if (running.has(event.sender.id))
				return { success: false, error: "Analysis already running" };
			const controller = new AbortController();
			running.set(event.sender.id, controller);
			const abort = () => controller.abort();
			event.sender.once("destroyed", abort);
			let bundled: Awaited<ReturnType<typeof startBundledAi>> | undefined;
			try {
				if (
					!input ||
					typeof input.videoPath !== "string" ||
					typeof input.model !== "string" ||
					!Number.isInteger(input.count) ||
					input.count < 1 ||
					input.count > 12
				)
					throw Error("Invalid visual analysis request");
				const normalized = normalizeVideoSourcePath(input.videoPath);
				const approved = normalized && (await resolveApprovedLocalMediaPath(normalized));
				if (!approved) throw Error("Select an approved local recording first");
				if (input.model === BUNDLED_MODEL_ID)
					bundled = await startBundledAi(bundledRoot(), controller.signal);
				const analysis = await analyzeVideoFrames({
					videoPath: approved,
					model: input.model,
					count: input.count,
					ffmpegPath: getFfmpegBinaryPath(),
					ffprobePath: getFfprobeBinaryPath(),
					signal: controller.signal,
					bundled: bundled
						? { name: "Qwen3-VL-2B-Instruct Q4_K_M", describe: bundled.describe }
						: undefined,
					onProgress: (completed, total, timeMs) => {
						if (!event.sender.isDestroyed())
							event.sender.send("auto-edit-vision-progress", {
								completed,
								total,
								timeMs,
							});
					},
				});
				return { success: true, analysis };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : "Visual analysis failed",
				};
			} finally {
				await bundled?.close();
				running.delete(event.sender.id);
				event.sender.removeListener("destroyed", abort);
			}
		},
	);
	ipcMain.handle("auto-edit-cancel", (event) => {
		running.get(event.sender.id)?.abort();
	});
	ipcMain.handle("auto-edit-analyze", async (event, videoPath: string) => {
		if (running.has(event.sender.id))
			return { success: false, error: "Analysis already running" };
		const controller = new AbortController();
		running.set(event.sender.id, controller);
		const abort = () => controller.abort();
		event.sender.once("destroyed", abort);
		try {
			const normalized = normalizeVideoSourcePath(videoPath);
			const approved = normalized && (await resolveApprovedLocalMediaPath(normalized));
			if (!approved) throw new Error("Select an approved local recording first");
			const candidates = await resolveCaptionAudioCandidates(approved);
			const companions = [];
			for (const candidate of candidates.filter((c) => c.path !== approved)) {
				const local = await resolveApprovedLocalMediaPath(candidate.path);
				if (!local) throw new Error("Linked audio is not approved for local analysis");
				companions.push({
					path: local,
					delayMs: (await getCompanionAudioStartDelayMs(local)) ?? 0,
				});
			}
			const evidence = await analyzeLocalMedia({
				videoPath: approved,
				companions,
				ffmpegPath: getFfmpegBinaryPath(),
				ffprobePath: getFfprobeBinaryPath(),
				signal: controller.signal,
			});
			if (candidates.some((c) => c.label === "linked webcam recording")) {
				evidence.audioVerified = false;
				evidence.warnings.push("webcam-alignment-unverified");
			}
			return { success: true, evidence };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Local analysis failed",
			};
		} finally {
			running.delete(event.sender.id);
			event.sender.removeListener("destroyed", abort);
		}
	});
	ipcMain.handle("auto-edit-review-local", async (_event, plan: EditPlan, model: string) => {
		try {
			if (
				!plan ||
				plan.version !== 1 ||
				!Array.isArray(plan.suggestions) ||
				plan.suggestions.length > 5000
			)
				throw new Error("Invalid plan");
			return { success: true, plan: await new LocalPlanReviewer().review(plan, model) };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Local review failed",
			};
		}
	});
}
