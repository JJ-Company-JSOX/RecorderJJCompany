// Worker-thread entry for the bundled OCR engine (built to dist-electron/ocr-worker.cjs).
// Requests are answered one at a time; a load failure is reported to every request as fatal.
import { parentPort, workerData } from "node:worker_threads";
import type { OcrLine, RgbImage } from "../ocrTypes";
import { createOcrRuntime, type OcrRuntimeAssets } from "./runtime";

export type OcrWorkerRequest = { id: number; image: RgbImage };
export type OcrWorkerResponse =
	| { id: number; lines: OcrLine[] }
	| { id: number; error: string; fatal: boolean };

const port = parentPort;
if (!port) throw new Error("The OCR worker must run in a worker thread.");
const runtime = createOcrRuntime(workerData as OcrRuntimeAssets);
// Rejections are reported per request below; avoid an unhandled-rejection exit before that.
runtime.catch(() => undefined);

let queue = Promise.resolve();
port.on("message", ({ id, image }: OcrWorkerRequest) => {
	queue = queue.then(async () => {
		let engine: Awaited<typeof runtime>;
		try {
			engine = await runtime;
		} catch (error) {
			port.postMessage({
				id,
				error: String((error as Error)?.message ?? error),
				fatal: true,
			});
			return;
		}
		try {
			port.postMessage({ id, lines: await engine.recognize(image) });
		} catch (error) {
			port.postMessage({
				id,
				error: String((error as Error)?.message ?? error),
				fatal: false,
			});
		}
	});
});
