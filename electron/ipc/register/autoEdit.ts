import {
	isStoryRequest,
	type StoryRequest,
} from "../../../src/components/video-editor/auto-edit/story";
import { generateLocalStory } from "../autoEdit/story";
import path from "node:path";
import { existsSync } from "node:fs";
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { BUNDLED_MODEL_ID } from "../../../src/components/video-editor/auto-edit/bundledTypes";
import type { EditPlan } from "../../../src/components/video-editor/auto-edit/plan";
import type { SpeechTranscript } from "../../../src/components/video-editor/auto-edit/speechTypes";
import { bundledAiStatus, startBundledAi, stopBundledAi } from "../autoEdit/bundled";
import { configureBundledOllama, stopBundledOllama } from "../autoEdit/bundledOllama";
import { analyzeLocalMedia } from "../autoEdit/media";
import {
	describeNarrationFrames,
	isNarrationFrame,
	type NarrationFrame,
} from "../autoEdit/narrationFrames";
import {
	generateBundledNarration,
	isNarrationLanguage,
	LocalNarrationGenerator,
} from "../autoEdit/narrator";
import type { OcrEngine } from "../autoEdit/ocrTypes";
import { inspectLocalModel, LocalPlanReviewer } from "../autoEdit/reviewer";
import { analyzeSpeechWindow, mergeSpeechPlans } from "../autoEdit/speechPlan";
import { boundSpeechCues, speechWindows } from "../autoEdit/transcript";
import { isSubtitleLines, type SubtitleLine, translateSubtitles } from "../autoEdit/translate";
import {
	getBundledTtsStatus,
	previewBundledVoice,
	synthesizeBundledNarration,
} from "../autoEdit/tts";
import { isNarrationStyle } from "../autoEdit/tutorialScript";
import { analyzeVideoFrames } from "../autoEdit/vision";
import { generateBundledSpeechTranscript, getBundledSpeechStatus } from "../captions/bundledSpeech";
import { NoCaptionAudioError, resolveCaptionAudioCandidates } from "../captions/generate";
import { protectSilenceWithVad } from "../captions/vadProtection";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { resolveApprovedLocalMediaPath } from "../project/manager";
import { getCompanionAudioStartDelayMs } from "../recording/diagnostics";
import { normalizeVideoSourcePath } from "../utils";
import { registerOfflineTools } from "./offlineTools";

export type AutoEditHandlerOptions = {
	/**
	 * Opens the bundled OCR engine for one voice-over job, or resolves undefined when this build
	 * has none. With it, click labels are exact screen text; without it the vision model reads them.
	 */
	openOcr?: (signal: AbortSignal) => Promise<OcrEngine | undefined>;
};

export function registerAutoEditHandlers(options: AutoEditHandlerOptions = {}) {
	if (process.platform === "win32" && process.arch === "x64") {
		const resources = app.isPackaged
			? process.resourcesPath
			: path.join(app.getAppPath(), "vendor");
		configureBundledOllama({
			root: app.isPackaged
				? path.join(resources, "offline-ollama")
				: path.join(resources, "offline-ollama/win32-x64"),
			workDir: path.join(app.getPath("userData"), "ollama"),
			required:
				app.isPackaged && existsSync(path.join(resources, "offline-ollama-required.txt")),
			enabled: true,
		});
		app.once("before-quit", stopBundledOllama);
	}
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
	const runLocalTask = async <T>(
		event: IpcMainInvokeEvent,
		task: (signal: AbortSignal) => Promise<T>,
	) => {
		if (running.has(event.sender.id)) throw new Error("Analysis already running");
		const controller = new AbortController();
		running.set(event.sender.id, controller);
		const abort = () => controller.abort();
		event.sender.once("destroyed", abort);
		try {
			const result = await task(controller.signal);
			controller.signal.throwIfAborted();
			return result;
		} finally {
			if (running.get(event.sender.id) === controller) running.delete(event.sender.id);
			event.sender.removeListener("destroyed", abort);
		}
	};
	registerOfflineTools(running);
	app.once("before-quit", () => {
		for (const controller of running.values()) controller.abort();
	});
	ipcMain.handle("auto-edit-speech-status", () => getBundledSpeechStatus());
	ipcMain.handle(
		"auto-edit-complete",
		async (
			event,
			input: { videoPath: string; language?: string; mode?: "speech" | "full" },
		) => {
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
					(input.language !== undefined && !/^(auto|en|zh|ms)$/.test(input.language)) ||
					(input.mode !== undefined && input.mode !== "speech" && input.mode !== "full")
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
				if (input.mode === "speech") {
					// Subtitles and grounded pauses do not need a vision/reasoning model.
					return { success: true, evidence, speech: mergeSpeechPlans(transcript, []) };
				}
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
					count: 8,
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
					errorCode: error instanceof NoCaptionAudioError ? "NO_AUDIO" : undefined,
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
	ipcMain.handle("auto-edit-review-local", async (event, plan: EditPlan, model: string) => {
		try {
			if (
				!plan ||
				plan.version !== 1 ||
				!Array.isArray(plan.suggestions) ||
				plan.suggestions.length > 5000
			)
				throw new Error("Invalid plan");
			return {
				success: true,
				plan: await runLocalTask(event, (signal) =>
					new LocalPlanReviewer().review(plan, model, signal),
				),
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Local review failed",
			};
		}
	});
	ipcMain.handle(
		"auto-edit-story-local",
		async (event, request: StoryRequest, model: string, language?: string) => {
			try {
				if (!isStoryRequest(request) || !isNarrationLanguage(language))
					throw Error(
						"Invalid story request: check scene timing, subtitle consent and text limits (2000 combined characters with video frames or 4000 without, up to 80 subtitle cues / 3000 subtitle characters).",
					);
				const draft = await runLocalTask(event, async (signal) => {
					const normalized =
						request.brief.analyzeVideo && normalizeVideoSourcePath(request.videoPath);
					const approvedPath = normalized
						? await resolveApprovedLocalMediaPath(normalized)
						: undefined;
					if (request.brief.analyzeVideo && !approvedPath)
						throw Error("Select an approved local recording first");
					return generateLocalStory({
						request,
						model,
						language,
						signal,
						approvedPath: approvedPath || undefined,
						ffmpegPath: getFfmpegBinaryPath(),
						ffprobePath: getFfprobeBinaryPath(),
						onProgress: (completed, total) => {
							if (!event.sender.isDestroyed())
								event.sender.send("auto-edit-vision-progress", {
									completed,
									total,
								});
						},
					});
				});
				return { success: true, draft };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : "Story generation failed",
				};
			}
		},
	);
	ipcMain.handle(
		"auto-edit-narrate-local",
		async (event, plan: EditPlan, model: string, language?: string, style?: string) => {
			try {
				if (
					!plan ||
					plan.version !== 1 ||
					!Array.isArray(plan.suggestions) ||
					plan.suggestions.length > 5000
				)
					throw new Error("Invalid plan");
				return {
					success: true,
					draft: await runLocalTask(event, (signal) =>
						new LocalNarrationGenerator().generate(
							plan,
							model,
							signal,
							isNarrationLanguage(language) ? language : "en",
							isNarrationStyle(style) ? style : "tutorial",
						),
					),
				};
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : "Local narration draft failed",
				};
			}
		},
	);
	ipcMain.handle(
		"auto-edit-narrate-bundled",
		async (
			event,
			plan: EditPlan,
			language?: string,
			screen?: {
				videoPath: string;
				frames: NarrationFrame[];
				style?: string;
				timelineEndMs?: number;
			},
		) => {
			if (running.has(event.sender.id))
				return { success: false, error: "Analysis already running" };
			const controller = new AbortController();
			running.set(event.sender.id, controller);
			const abort = () => controller.abort();
			event.sender.once("destroyed", abort);
			let session: Awaited<ReturnType<typeof startBundledAi>> | undefined;
			let ocr: OcrEngine | undefined;
			try {
				if (
					!plan ||
					plan.version !== 1 ||
					!Array.isArray(plan.suggestions) ||
					plan.suggestions.length > 5000
				)
					throw new Error("Invalid plan");
				if (
					screen !== undefined &&
					(!screen ||
						typeof screen.videoPath !== "string" ||
						!Array.isArray(screen.frames) ||
						screen.frames.length > 5000 ||
						(screen.style !== undefined && !isNarrationStyle(screen.style)) ||
						(screen.timelineEndMs !== undefined &&
							!(Number.isFinite(screen.timelineEndMs) && screen.timelineEndMs > 0)))
				)
					throw new Error("Invalid narration frames");
				// A malformed moment only loses its screen detail, never the whole draft.
				const frames = screen?.frames.filter(isNarrationFrame) ?? [];
				const normalized = screen && normalizeVideoSourcePath(screen.videoPath);
				const approved = normalized && (await resolveApprovedLocalMediaPath(normalized));
				if (screen && !approved)
					throw new Error("Select an approved local recording first");
				session = await startBundledAi(bundledRoot(), controller.signal);
				if (screen && approved && frames.length && options.openOcr)
					try {
						ocr = await options.openOcr(controller.signal);
					} catch (error) {
						// OCR only sharpens labels; the vision model still reads the screen without it.
						controller.signal.throwIfAborted();
						console.warn(
							"[auto-edit-narration] OCR unavailable:",
							error instanceof Error ? error.message : error,
						);
					}
				// Look at the screen at each narrated moment first, so lines can name what is shown.
				const screens =
					screen && approved
						? await describeNarrationFrames({
								videoPath: approved,
								ffmpegPath: getFfmpegBinaryPath(),
								ffprobePath: getFfprobeBinaryPath(),
								frames,
								look: session.look,
								ocr,
								signal: controller.signal,
								onProgress: (completed, total) => {
									if (!event.sender.isDestroyed())
										event.sender.send("auto-edit-vision-progress", {
											completed,
											total,
										});
								},
							})
						: undefined;
				// The Kokoro voice reads English labels inside Chinese lines; the older one cannot.
				const { mixedLanguage } = await getBundledTtsStatus().catch(() => ({
					mixedLanguage: false,
				}));
				return {
					success: true,
					draft: await generateBundledNarration(
						plan,
						session.complete,
						isNarrationLanguage(language) ? language : "zh",
						screens,
						{
							style: isNarrationStyle(screen?.style) ? screen.style : "tutorial",
							timelineEndMs: screen?.timelineEndMs,
							mixedLanguage,
						},
					),
				};
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Bundled narration draft failed",
				};
			} finally {
				await ocr?.dispose().catch(() => undefined);
				await session?.close();
				running.delete(event.sender.id);
				event.sender.removeListener("destroyed", abort);
			}
		},
	);
	ipcMain.handle(
		"auto-edit-translate-subtitles",
		async (event, lines: SubtitleLine[], target?: string) => {
			if (running.has(event.sender.id))
				return { success: false, error: "Analysis already running" };
			const controller = new AbortController();
			running.set(event.sender.id, controller);
			const abort = () => controller.abort();
			event.sender.once("destroyed", abort);
			let session: Awaited<ReturnType<typeof startBundledAi>> | undefined;
			try {
				if (!isSubtitleLines(lines) || !isNarrationLanguage(target))
					throw new Error("Invalid subtitles");
				session = await startBundledAi(bundledRoot(), controller.signal);
				return {
					success: true,
					lines: await translateSubtitles({
						lines,
						target,
						complete: session.complete,
						signal: controller.signal,
						onProgress: (completed, total) => {
							if (!event.sender.isDestroyed())
								event.sender.send("auto-edit-vision-progress", {
									completed,
									total,
								});
						},
					}),
				};
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : "Subtitle translation failed",
				};
			} finally {
				await session?.close();
				running.delete(event.sender.id);
				event.sender.removeListener("destroyed", abort);
			}
		},
	);
	ipcMain.handle("auto-edit-tts-status", () => getBundledTtsStatus());
	ipcMain.handle(
		"auto-edit-narrate-synthesize",
		async (
			event,
			cues: Array<{ id: string; text: string }>,
			language?: string,
			speakerId?: number,
		) => {
			if (running.has(event.sender.id))
				return { success: false, error: "Analysis already running" };
			const controller = new AbortController();
			running.set(event.sender.id, controller);
			const abort = () => controller.abort();
			event.sender.once("destroyed", abort);
			try {
				if (!Array.isArray(cues) || !cues.length || cues.length > 200)
					throw new Error("Invalid narration cues");
				// Checked again against the installed voice's curated speakers.
				if (speakerId !== undefined && !Number.isInteger(speakerId))
					throw new Error("Invalid narration speaker");
				const clips = await synthesizeBundledNarration({
					cues,
					outputDirectory: path.join(app.getPath("userData"), "narration-audio"),
					language: isNarrationLanguage(language) ? language : "zh",
					speakerId,
					signal: controller.signal,
				});
				return { success: true, clips };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : "Narration synthesis failed",
				};
			} finally {
				running.delete(event.sender.id);
				event.sender.removeListener("destroyed", abort);
			}
		},
	);
	ipcMain.handle(
		"auto-edit-tts-preview",
		async (event, language?: string, speakerId?: number) => {
			if (running.has(event.sender.id))
				return { success: false, error: "Analysis already running" };
			const controller = new AbortController();
			running.set(event.sender.id, controller);
			const abort = () => controller.abort();
			event.sender.once("destroyed", abort);
			try {
				if (!isNarrationLanguage(language)) throw new Error("Invalid narration language");
				if (speakerId !== undefined && !Number.isInteger(speakerId))
					throw new Error("Invalid narration speaker");
				const { samples, sampleRate } = await previewBundledVoice({
					language,
					speakerId,
					signal: controller.signal,
				});
				return { success: true, samples, sampleRate };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : "Narration preview failed",
				};
			} finally {
				running.delete(event.sender.id);
				event.sender.removeListener("destroyed", abort);
			}
		},
	);
}
