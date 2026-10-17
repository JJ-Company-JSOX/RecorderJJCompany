import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getProjectBackupPath, writeProjectFileAtomically } from "./atomicSave";

describe("writeProjectFileAtomically", () => {
	let tempDir: string;
	let projectPath: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-atomic-project-"));
		projectPath = path.join(tempDir, "demo.recordly");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	async function expectNoTemporaryArtifacts() {
		const entries = await fs.readdir(tempDir);
		expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
	}

	it("commits a complete new project without creating a backup", async () => {
		await writeProjectFileAtomically(projectPath, '{"version":1}');

		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe('{"version":1}');
		await expect(fs.access(getProjectBackupPath(projectPath))).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expectNoTemporaryArtifacts();
		await expectNoTemporaryArtifacts();
	});

	it("removes a stale backup when the target has no previous generation", async () => {
		await fs.writeFile(getProjectBackupPath(projectPath), "stale-project");

		await writeProjectFileAtomically(projectPath, '{"version":1}');

		await expect(fs.access(getProjectBackupPath(projectPath))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
	it("retains the sole recovery backup when creating its replacement fails", async () => {
		const backupPath = getProjectBackupPath(projectPath);
		await fs.writeFile(backupPath, '{"revision":"recovery"}');
		const rename = fs.rename.bind(fs);
		vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
			if (String(target) === projectPath)
				throw Object.assign(new Error("Disk failure"), { code: "EIO" });
			return rename(source, target);
		});
		await expect(
			writeProjectFileAtomically(projectPath, '{"revision":2}'),
		).rejects.toMatchObject({ code: "EIO" });
		expect(await fs.readFile(backupPath, "utf8")).toBe('{"revision":"recovery"}');
		await expect(fs.access(projectPath)).rejects.toMatchObject({ code: "ENOENT" });
		await expectNoTemporaryArtifacts();
	});

	it("preserves the previous complete generation before replacement", async () => {
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"old"}');
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"new"}');

		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe('{"version":1,"name":"new"}');
		await expect(fs.readFile(getProjectBackupPath(projectPath), "utf-8")).resolves.toBe(
			'{"version":1,"name":"old"}',
		);
		await expectNoTemporaryArtifacts();
	});

	it("keeps the active generation unchanged when backup commit fails", async () => {
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"old"}');
		await fs.mkdir(getProjectBackupPath(projectPath));

		await expect(
			writeProjectFileAtomically(projectPath, '{"version":1,"name":"new"}'),
		).rejects.toBeDefined();

		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe('{"version":1,"name":"old"}');
		await expectNoTemporaryArtifacts();

		await fs.rm(getProjectBackupPath(projectPath), { recursive: true });
		await writeProjectFileAtomically(projectPath, '{"version":1,"name":"retry"}');
		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe(
			'{"version":1,"name":"retry"}',
		);
		await expect(fs.readFile(getProjectBackupPath(projectPath), "utf-8")).resolves.toBe(
			'{"version":1,"name":"old"}',
		);
		await expectNoTemporaryArtifacts();
	});

	it("serializes overlapping writes to the same project", async () => {
		await writeProjectFileAtomically(projectPath, '{"revision":1}');

		// Each call enters the queue synchronously before its first await, preserving invocation order.
		await Promise.all([
			writeProjectFileAtomically(projectPath, '{"revision":2}'),
			writeProjectFileAtomically(projectPath, '{"revision":3}'),
		]);

		await expect(fs.readFile(projectPath, "utf-8")).resolves.toBe('{"revision":3}');
		await expect(fs.readFile(getProjectBackupPath(projectPath), "utf-8")).resolves.toBe(
			'{"revision":2}',
		);
		await expectNoTemporaryArtifacts();
	});

	it.skipIf(process.platform !== "win32")(
		"retries a transient Windows destination lock without exposing an incomplete project",
		async () => {
			await writeProjectFileAtomically(projectPath, '{"revision":1}');
			const rename = fs.rename.bind(fs);
			let attempts = 0;
			vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
				if (String(target) === projectPath && ++attempts < 3) {
					expect(await fs.readFile(projectPath, "utf8")).toBe('{"revision":1}');
					throw Object.assign(new Error("Sharing violation"), { code: "EPERM" });
				}
				return rename(source, target);
			});
			await writeProjectFileAtomically(projectPath, '{"revision":2}');
			expect(attempts).toBe(3);
			expect(await fs.readFile(projectPath, "utf8")).toBe('{"revision":2}');
			expect(await fs.readFile(getProjectBackupPath(projectPath), "utf8")).toBe(
				'{"revision":1}',
			);
			await expectNoTemporaryArtifacts();
		},
	);
	it.skipIf(process.platform !== "win32")(
		"retries a locked backup before replacing the active generation",
		async () => {
			await writeProjectFileAtomically(projectPath, '{"revision":1}');
			const rename = fs.rename.bind(fs);
			let attempts = 0;
			vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
				if (String(target) === getProjectBackupPath(projectPath) && ++attempts === 1) {
					throw Object.assign(new Error("Backup busy"), { code: "EBUSY" });
				}
				return rename(source, target);
			});
			await writeProjectFileAtomically(projectPath, '{"revision":2}');
			expect(attempts).toBe(2);
			expect(await fs.readFile(projectPath, "utf8")).toBe('{"revision":2}');
			expect(await fs.readFile(getProjectBackupPath(projectPath), "utf8")).toBe(
				'{"revision":1}',
			);
			await expectNoTemporaryArtifacts();
		},
	);
	it.skipIf(process.platform !== "win32").each([
		{ code: "EACCES", attempts: 7 },
		{ code: "EIO", attempts: 1 },
	])("keeps both generations after $code and allows a later save", async ({ code, attempts }) => {
		await writeProjectFileAtomically(projectPath, '{"revision":1}');
		const rename = fs.rename.bind(fs);
		let actualAttempts = 0;
		const spy = vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
			if (String(target) === projectPath) {
				actualAttempts++;
				throw Object.assign(new Error("Replacement failed"), { code });
			}
			return rename(source, target);
		});
		await expect(
			writeProjectFileAtomically(projectPath, '{"revision":2}'),
		).rejects.toMatchObject({ code });
		expect(actualAttempts).toBe(attempts);
		expect(await fs.readFile(projectPath, "utf8")).toBe('{"revision":1}');
		expect(await fs.readFile(getProjectBackupPath(projectPath), "utf8")).toBe('{"revision":1}');
		await expectNoTemporaryArtifacts();
		spy.mockRestore();
		await writeProjectFileAtomically(projectPath, '{"revision":3}');
		expect(await fs.readFile(projectPath, "utf8")).toBe('{"revision":3}');
	});
	it.skipIf(process.platform !== "win32")(
		"continues an already queued newer save after a locked save exhausts retries",
		async () => {
			await writeProjectFileAtomically(projectPath, '{"revision":1}');
			const rename = fs.rename.bind(fs);
			let attempts = 0;
			vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
				if (String(target) === projectPath && ++attempts <= 7)
					throw Object.assign(new Error("Locked"), { code: "EPERM" });
				return rename(source, target);
			});
			const results = await Promise.allSettled([
				writeProjectFileAtomically(projectPath, '{"revision":2}'),
				writeProjectFileAtomically(projectPath, '{"revision":3}'),
			]);
			expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
			expect(await fs.readFile(projectPath, "utf8")).toBe('{"revision":3}');
			expect(await fs.readFile(getProjectBackupPath(projectPath), "utf8")).toBe(
				'{"revision":1}',
			);
			await expectNoTemporaryArtifacts();
		},
	);

	it.skipIf(process.platform === "win32")(
		"preserves exact project permission bits despite the process umask",
		async () => {
			await fs.writeFile(projectPath, '{"revision":1}', { mode: 0o666 });
			await fs.chmod(projectPath, 0o666);
			const previousUmask = process.umask(0o077);

			try {
				await writeProjectFileAtomically(projectPath, '{"revision":2}');
			} finally {
				process.umask(previousUmask);
			}

			expect((await fs.stat(projectPath)).mode & 0o777).toBe(0o666);
		},
	);
});
