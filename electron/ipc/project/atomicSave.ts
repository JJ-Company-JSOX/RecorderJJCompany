import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const pendingWrites = new Map<string, Promise<void>>();
const windowsRenameRetryDelaysMs = [25, 50, 100, 200, 400, 800];
const transientWindowsRenameErrors = new Set(["EPERM", "EACCES", "EBUSY"]);

async function renameWithTransientLockRetry(source: string, target: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await fs.rename(source, target);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (
				process.platform !== "win32" ||
				!code ||
				!transientWindowsRenameErrors.has(code) ||
				attempt >= windowsRenameRetryDelaysMs.length
			)
				throw error;
			// Windows readers/scanners can briefly prevent replacement. Keep both
			// complete generations intact; never unlink the destination to retry.
			await delay(windowsRenameRetryDelaysMs[attempt]);
		}
	}
}

const unsupportedDirectorySyncErrors = new Set([
	"EACCES",
	"EINVAL",
	"EISDIR",
	"ENOSYS",
	"ENOTSUP",
	"EOPNOTSUPP",
	"EPERM",
]);

export function getProjectBackupPath(projectPath: string): string {
	return `${projectPath}.bak`;
}

function getQueueKey(projectPath: string): string {
	const resolvedPath = path.resolve(projectPath);
	return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

function createTemporaryPath(parentDir: string, label: string): string {
	return path.join(parentDir, `.recordly-${label}-${process.pid}-${randomUUID()}.tmp`);
}

async function getExistingFileMode(filePath: string): Promise<number | undefined> {
	try {
		return (await fs.stat(filePath)).mode & 0o777;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

async function writeSyncedTemporaryFile(
	filePath: string,
	contents: string,
	mode?: number,
): Promise<void> {
	const handle = await fs.open(filePath, "wx", mode);
	try {
		await handle.writeFile(contents, "utf-8");
		if (mode !== undefined) {
			await handle.chmod(mode);
		}
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function syncExistingFile(filePath: string): Promise<void> {
	const handle = await fs.open(filePath, "r+");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function syncParentDirectory(parentDir: string): Promise<void> {
	if (process.platform === "win32") {
		return;
	}

	try {
		const handle = await fs.open(parentDir, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (!code || !unsupportedDirectorySyncErrors.has(code)) {
			throw error;
		}
	}
}

async function preservePreviousGeneration(
	targetPath: string,
	backupPath: string,
	backupTemporaryPath: string,
): Promise<boolean> {
	try {
		await fs.copyFile(targetPath, backupTemporaryPath, fsConstants.COPYFILE_EXCL);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			// A recovery backup can be the only surviving generation. Do not
			// discard it until the replacement target has committed successfully.
			return false;
		}
		throw error;
	}

	await syncExistingFile(backupTemporaryPath);
	await renameWithTransientLockRetry(backupTemporaryPath, backupPath);
	return true;
}

async function commitProjectFile(projectPath: string, contents: string): Promise<void> {
	const targetPath = path.resolve(projectPath);
	const parentDir = path.dirname(targetPath);
	const backupPath = getProjectBackupPath(targetPath);
	const temporaryPath = createTemporaryPath(parentDir, "project");
	const backupTemporaryPath = createTemporaryPath(parentDir, "backup");
	const existingMode = await getExistingFileMode(targetPath);

	try {
		await writeSyncedTemporaryFile(temporaryPath, contents, existingMode);
		const preservedPrevious = await preservePreviousGeneration(
			targetPath,
			backupPath,
			backupTemporaryPath,
		);
		await renameWithTransientLockRetry(temporaryPath, targetPath);
		await syncParentDirectory(parentDir);
		if (!preservedPrevious) {
			await fs.rm(backupPath, { force: true }).catch((error) => {
				// The new target is complete; keep an undeletable backup rather
				// than reporting that the committed project was not saved.
				console.warn("Unable to remove stale project backup:", error);
			});
		}
	} finally {
		await Promise.all([
			fs.rm(temporaryPath, { force: true }).catch(() => undefined),
			fs.rm(backupTemporaryPath, { force: true }).catch(() => undefined),
		]);
	}
}

export async function writeProjectFileAtomically(
	projectPath: string,
	contents: string,
): Promise<void> {
	const queueKey = getQueueKey(projectPath);
	const previousWrite = pendingWrites.get(queueKey) ?? Promise.resolve();
	const currentWrite = previousWrite
		.catch(() => undefined)
		.then(() => commitProjectFile(projectPath, contents));
	pendingWrites.set(queueKey, currentWrite);

	try {
		await currentWrite;
	} finally {
		if (pendingWrites.get(queueKey) === currentWrite) {
			pendingWrites.delete(queueKey);
		}
	}
}
