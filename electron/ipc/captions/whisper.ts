import { createWriteStream, constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { pipeline } from "node:stream/promises";
import type Electron from "electron";
import {
	WHISPER_MODEL_DIR,
	WHISPER_MODEL_DOWNLOAD_URL,
	WHISPER_SMALL_MODEL_PATH,
} from "../constants";
import { getBundledSpeechStatus } from "./bundledSpeech";

export function sendWhisperModelDownloadProgress(
	webContents: Electron.WebContents,
	payload: {
		status: "idle" | "downloading" | "downloaded" | "error";
		progress: number;
		path?: string | null;
		error?: string;
	},
) {
	webContents.send("whisper-small-model-download-progress", payload);
}

const activeDownloads = new Map<number, AbortController>();
export function cancelWhisperModelDownload(ownerId: number): boolean {
	const controller = activeDownloads.get(ownerId);
	controller?.abort();
	return Boolean(controller);
}

export async function getWhisperSmallModelStatus() {
	const bundled = await getBundledSpeechStatus();
	if (bundled.available)
		return { success: true, exists: true, path: bundled.modelPath, bundled: true };
	try {
		await fs.access(WHISPER_SMALL_MODEL_PATH, fsConstants.R_OK);
		return {
			success: true,
			exists: true,
			path: WHISPER_SMALL_MODEL_PATH,
		};
	} catch {
		return {
			success: true,
			exists: false,
			path: null,
			downloadPath: WHISPER_SMALL_MODEL_PATH,
		};
	}
}

export function downloadFileWithProgress(
	url: string,
	destinationPath: string,
	onProgress: (progress: number) => void,
	signal?: AbortSignal,
): Promise<void> {
	const request = (currentUrl: string, redirectCount = 0): Promise<void> => {
		return new Promise((resolve, reject) => {
			let transferring = false;
			const req = httpsGet(currentUrl, { timeout: 30_000, signal }, (response) => {
				const statusCode = response.statusCode ?? 0;
				const location = response.headers.location;

				if (statusCode >= 300 && statusCode < 400 && location) {
					response.resume();
					if (redirectCount >= 5) {
						reject(new Error("Too many redirects while downloading Whisper model."));
						return;
					}

					const nextUrl = new URL(location, currentUrl).toString();
					void request(nextUrl, redirectCount + 1)
						.then(resolve)
						.catch(reject);
					return;
				}

				if (statusCode < 200 || statusCode >= 300) {
					response.resume();
					reject(new Error(`Whisper model download failed with status ${statusCode}.`));
					return;
				}

				const totalBytes = Number.parseInt(
					String(response.headers["content-length"] ?? "0"),
					10,
				);
				let downloadedBytes = 0;
				const fileStream = createWriteStream(destinationPath);

				response.on("data", (chunk: Buffer) => {
					downloadedBytes += chunk.length;
					if (Number.isFinite(totalBytes) && totalBytes > 0) {
						onProgress(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
					}
				});

				transferring = true;
				void pipeline(response, fileStream, { signal }).then(() => {
					onProgress(100);
					resolve();
				}, reject);
			});

			req.on("error", (error) => {
				if (!transferring) reject(error);
			});
			req.on("timeout", () => {
				req.destroy(new Error("Whisper model download timed out."));
			});
		});
	};

	return request(url);
}

export async function downloadWhisperSmallModel(
	webContents: Electron.WebContents,
): Promise<string> {
	if (activeDownloads.size)
		throw new Error("A speech model download is already running. Cancel it before retrying.");
	const controller = new AbortController();
	activeDownloads.set(webContents.id, controller);
	const onDestroyed = () => controller.abort();
	webContents.once("destroyed", onDestroyed);
	await fs.mkdir(WHISPER_MODEL_DIR, { recursive: true }).catch((error) => {
		activeDownloads.delete(webContents.id);
		webContents.removeListener("destroyed", onDestroyed);
		throw error;
	});
	const tempPath = `${WHISPER_SMALL_MODEL_PATH}.download`;

	try {
		controller.signal.throwIfAborted();
		if (!webContents.isDestroyed())
			sendWhisperModelDownloadProgress(webContents, {
				status: "downloading",
				progress: 0,
				path: null,
			});
		await fs.rm(tempPath, { force: true });
		await downloadFileWithProgress(
			WHISPER_MODEL_DOWNLOAD_URL,
			tempPath,
			(progress) => {
				if (!webContents.isDestroyed())
					sendWhisperModelDownloadProgress(webContents, {
						status: "downloading",
						progress,
						path: null,
					});
			},
			controller.signal,
		);
		controller.signal.throwIfAborted();
		await fs.rename(tempPath, WHISPER_SMALL_MODEL_PATH);
		if (!webContents.isDestroyed())
			sendWhisperModelDownloadProgress(webContents, {
				status: "downloaded",
				progress: 100,
				path: WHISPER_SMALL_MODEL_PATH,
			});
		return WHISPER_SMALL_MODEL_PATH;
	} catch (error) {
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		if (!webContents.isDestroyed())
			sendWhisperModelDownloadProgress(webContents, {
				status: controller.signal.aborted ? "idle" : "error",
				progress: 0,
				path: null,
				error: controller.signal.aborted ? undefined : String(error),
			});
		throw error;
	} finally {
		activeDownloads.delete(webContents.id);
		webContents.removeListener("destroyed", onDestroyed);
	}
}

export async function deleteWhisperSmallModel(): Promise<void> {
	if (activeDownloads.size)
		throw new Error("Cancel the active model download before deleting the model.");
	// The packaged model belongs to application resources and is never removed.
	await fs.rm(WHISPER_SMALL_MODEL_PATH, { force: true });
}
