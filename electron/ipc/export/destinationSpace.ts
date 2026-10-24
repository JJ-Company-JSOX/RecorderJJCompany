import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const EXPORT_DISK_RESERVE_BYTES = 1024n * 1024n;

/** Check the destination volume before copying or writing a completed export. */
export async function ensureExportDestinationSpace(
	destinationPath: string,
	requiredBytes: number,
): Promise<void> {
	if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0)
		throw new Error("Invalid export size.");
	let directory = path.dirname(path.resolve(destinationPath));
	for (;;) {
		try {
			await fs.access(directory, constants.W_OK);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = path.dirname(directory);
			if (parent === directory) throw error;
			directory = parent;
		}
	}
	const stats = await fs.statfs(directory, { bigint: true }).catch((error: unknown) => {
		const code = (error as NodeJS.ErrnoException).code;
		if (code && ["ENOSYS", "ENOTSUP", "EOPNOTSUPP"].includes(code)) {
			// Some mounted/network filesystems allow writes but cannot report free space.
			// Preserve actual write/permission failures; lack of this optional check
			// must not make every export to such a filesystem fail.
			console.warn(`[export] Free space is unavailable for ${directory} (${code})`);
			return null;
		}
		throw error;
	});
	if (!stats) return;
	const available = stats.bavail * stats.bsize;
	const needed = BigInt(requiredBytes) + EXPORT_DISK_RESERVE_BYTES;
	if (available < needed) {
		throw new Error(
			`Not enough disk space for export. Required: ${Math.ceil(Number(needed) / 1048576)} MiB; available: ${Math.floor(Number(available) / 1048576)} MiB. Choose another output folder or free disk space; your project and source files are preserved.`,
		);
	}
}
