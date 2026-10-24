export interface PendingExportSave {
	fileName: string;
	arrayBuffer?: ArrayBuffer;
	tempFilePath?: string;
	captionSidecar?: {
		format: "srt" | "vtt" | "both";
		cues: Array<{
			startMs: number;
			endMs: number;
			text: string;
		}>;
	};
}

const EXPORT_BLOB_STREAM_CHUNK_BYTES = 16 * 1024 * 1024;

export interface ExportSaveResult {
	success: boolean;
	path?: string;
	message?: string;
	error?: string;
	canceled?: boolean;
}

/** A failed save still owns the completed render, so it can be retried verbatim. */
export async function savePendingExport(
	pending: PendingExportSave,
	outputPath: string | null = null,
): Promise<ExportSaveResult> {
	try {
		if (pending.tempFilePath) {
			return await window.electronAPI.finalizeExportedVideo({
				tempPath: pending.tempFilePath,
				fileName: pending.fileName,
				outputPath,
				captionSidecar: pending.captionSidecar,
			});
		}
		if (pending.arrayBuffer) {
			return outputPath
				? await window.electronAPI.writeExportedVideoToPath(
						pending.arrayBuffer,
						outputPath,
						pending.captionSidecar,
					)
				: await window.electronAPI.saveExportedVideo(
						pending.arrayBuffer,
						pending.fileName,
						pending.captionSidecar,
					);
		}
		return { success: false, message: "No pending export to save" };
	} catch (error) {
		return { success: false, message: error instanceof Error ? error.message : String(error) };
	}
}

export async function streamExportBlobToTempFile(
	blob: Blob,
	extension: string,
): Promise<string | null> {
	if (
		typeof window === "undefined" ||
		!window.electronAPI?.openExportStream ||
		!window.electronAPI?.writeExportStreamChunk ||
		!window.electronAPI?.closeExportStream
	) {
		return null;
	}

	const openResult = await window.electronAPI.openExportStream({ extension });
	if (!openResult.success || !openResult.streamId || !openResult.tempPath) {
		throw new Error(openResult.error || "Failed to open export stream");
	}

	const { streamId } = openResult;
	let position = 0;
	try {
		while (position < blob.size) {
			const chunk = blob.slice(position, position + EXPORT_BLOB_STREAM_CHUNK_BYTES);
			const chunkBuffer = await chunk.arrayBuffer();
			const writeResult = await window.electronAPI.writeExportStreamChunk(
				streamId,
				position,
				new Uint8Array(chunkBuffer),
			);
			if (!writeResult.success) {
				throw new Error(writeResult.error || "Failed to write export stream chunk");
			}
			position += chunkBuffer.byteLength;
		}

		const closeResult = await window.electronAPI.closeExportStream(streamId);
		if (!closeResult.success || !closeResult.tempPath) {
			throw new Error(closeResult.error || "Failed to close export stream");
		}
		return closeResult.tempPath;
	} catch (error) {
		try {
			await window.electronAPI.closeExportStream(streamId, { abort: true });
		} catch {
			// Best-effort cleanup; preserve the original error.
		}
		throw error;
	}
}

export async function saveExportBlob(
	blob: Blob,
	fileName: string,
	outputPath: string | null = null,
	captionSidecar?: PendingExportSave["captionSidecar"],
) {
	const extension = fileName.split(".").pop()?.toLowerCase() || "bin";
	const hasExportStreamApi =
		typeof window !== "undefined" &&
		typeof window.electronAPI?.openExportStream === "function" &&
		typeof window.electronAPI?.writeExportStreamChunk === "function" &&
		typeof window.electronAPI?.closeExportStream === "function";
	let streamError: unknown = null;

	let tempFilePath: string | null = null;
	try {
		tempFilePath = await streamExportBlobToTempFile(blob, extension);
	} catch (error) {
		streamError = error;
		console.warn("[export] Temp-file blob save failed", error);
	}
	if (tempFilePath) {
		const pendingSave: PendingExportSave = { fileName, tempFilePath, captionSidecar };
		// Finalization errors must not trigger another dialog or allocate another
		// whole-file buffer. Keep the completed temp file available for Save Again.
		return { saveResult: await savePendingExport(pendingSave, outputPath), pendingSave };
	}

	if (!canUseInMemoryExportSaveFallback({ blobSize: blob.size, extension, hasExportStreamApi })) {
		const message = describeBlockedInMemoryExportSave({ blobSize: blob.size, extension });
		console.error("[export] Refusing in-memory blob save fallback", {
			fileName,
			blobSize: blob.size,
			extension,
			hasExportStreamApi,
			streamError,
		});
		throw new Error(message);
	}

	console.warn("[export] Falling back to in-memory blob save", {
		fileName,
		blobSize: blob.size,
		extension,
		hasExportStreamApi,
	});
	const arrayBuffer = await blob.arrayBuffer();
	const pendingSave: PendingExportSave = { fileName, arrayBuffer, captionSidecar };
	return {
		saveResult: await savePendingExport(pendingSave, outputPath),
		pendingSave,
	};
}

export async function writeSmokeExportReport(
	outputPath: string | null,
	report: Record<string, unknown>,
): Promise<void> {
	if (!outputPath || typeof window === "undefined") return;

	try {
		const reportBytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
		const reportBuffer = reportBytes.buffer.slice(
			reportBytes.byteOffset,
			reportBytes.byteOffset + reportBytes.byteLength,
		) as ArrayBuffer;
		await window.electronAPI.writeExportedVideoToPath(
			reportBuffer,
			`${outputPath}.report.json`,
		);
	} catch (error) {
		console.error("[smoke-export] Failed to write report", error);
	}
}

import {
	canUseInMemoryExportSaveFallback,
	describeBlockedInMemoryExportSave,
} from "@/lib/exporter/exportSavePolicy";
