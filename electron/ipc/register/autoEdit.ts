import { analyzeVideoFrames } from "../autoEdit/vision";
import { ipcMain } from "electron";
import type { EditPlan } from "../../../src/components/video-editor/auto-edit/plan";
import { analyzeLocalMedia } from "../autoEdit/media";
import { inspectLocalModel, LocalPlanReviewer } from "../autoEdit/reviewer";
import { resolveCaptionAudioCandidates } from "../captions/generate";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import { resolveApprovedLocalMediaPath } from "../project/manager";
import { getCompanionAudioStartDelayMs } from "../recording/diagnostics";
import { normalizeVideoSourcePath } from "../utils";

export function registerAutoEditHandlers() {
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
	ipcMain.handle(
		"auto-edit-vision",
		async (event, input: { videoPath: string; model: string; count: number }) => {
			if (running.has(event.sender.id))
				return { success: false, error: "Analysis already running" };
			const controller = new AbortController();
			running.set(event.sender.id, controller);
			const abort = () => controller.abort();
			event.sender.once("destroyed", abort);
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
				const analysis = await analyzeVideoFrames({
					videoPath: approved,
					model: input.model,
					count: input.count,
					ffmpegPath: getFfmpegBinaryPath(),
					ffprobePath: getFfprobeBinaryPath(),
					signal: controller.signal,
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
