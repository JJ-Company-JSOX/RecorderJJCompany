import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("local media path policy", () => {
	let tempRoot: string;
	let appDataPath: string;
	let userDataPath: string;
	let tempPath: string;
	let appPath: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-media-policy-"));
		appDataPath = path.join(tempRoot, "AppData");
		userDataPath = path.join(tempRoot, "UserData");
		tempPath = path.join(tempRoot, "Temp");
		appPath = path.join(tempRoot, "App");

		await Promise.all(
			[appDataPath, userDataPath, tempPath, appPath].map((dirPath) =>
				fs.mkdir(dirPath, { recursive: true }),
			),
		);

		vi.resetModules();
		// Policy fixtures are plain text, so do not start a real FFmpeg process
		// for them. Thumbnail-specific cases provide their own decoder below.
		vi.doMock("./firstFrameThumbnail", () => ({
			createProjectFirstFrameThumbnail: vi.fn().mockRejectedValue(new Error("No test frame")),
		}));
		vi.doMock("electron", () => ({
			app: {
				isPackaged: false,
				getAppPath: () => appPath,
				getPath: (name: string) => {
					if (name === "appData") return appDataPath;
					if (name === "userData") return userDataPath;
					if (name === "temp") return tempPath;
					return tempRoot;
				},
				setPath: () => undefined,
			},
		}));
	});

	afterEach(async () => {
		vi.resetModules();
		vi.doUnmock("electron");
		vi.doUnmock("../../mediaServer");
		vi.doUnmock("./firstFrameThumbnail");
		vi.doUnmock("../recording/diagnostics");
		if (tempRoot) {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("reads library previews without switching the active project and rejects unknown projects", async () => {
		vi.doMock("../../mediaServer", () => ({
			getMediaServerBaseUrl: () => "http://127.0.0.1:1234",
			buildMediaUrl: (base: string, file: string) =>
				`${base}/media?path=${encodeURIComponent(file)}`,
		}));
		const manager = await import("./manager");
		const state = await import("../state");
		const source = path.join(tempRoot, "video.mp4");
		await fs.writeFile(source, "video");
		const projectsDir = await manager.getProjectsDir();
		const projectPath = path.join(projectsDir, "preview.recordly");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 1, videoPath: source, editor: {} }),
		);
		state.setCurrentProjectPath("active.recordly");
		state.setCurrentVideoPath("active.mp4");
		const result = await manager.readProjectPreview(projectPath);
		expect(result.videoUrl).toContain(encodeURIComponent(source));
		expect(result.webcamUrl).toBeNull();
		expect(state.currentProjectPath).toBe("active.recordly");
		expect(state.currentVideoPath).toBe("active.mp4");
		await expect(
			manager.readProjectPreview(path.join(tempRoot, "unknown.recordly")),
		).rejects.toThrow("not in the library");
	});

	it("rejects existing media files outside allowed directories until they are approved", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const exportPath = path.join(downloadsPath, "export-test.mp4");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(exportPath, "test-video");

		const { isAllowedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"./manager"
		);

		await expect(isAllowedLocalMediaPath(exportPath)).resolves.toBe(false);

		await rememberApprovedLocalReadPath(exportPath);

		await expect(isAllowedLocalMediaPath(exportPath)).resolves.toBe(true);
	});

	it("rejects missing media files outside the allowed directories", async () => {
		const missingPath = path.join(tempRoot, "Downloads", "missing.mp4");
		const { isAllowedLocalMediaPath } = await import("./manager");

		await expect(isAllowedLocalMediaPath(missingPath)).resolves.toBe(false);
	});

	it("allows approved media paths before the file exists", async () => {
		const pendingExportPath = path.join(tempRoot, "Downloads", "pending-export.mp4");
		const { isAllowedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"./manager"
		);

		await rememberApprovedLocalReadPath(pendingExportPath);

		await expect(isAllowedLocalMediaPath(pendingExportPath)).resolves.toBe(true);
	});

	it("approves media-server access for approved external files resolved through the URL policy", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const videoPath = path.join(downloadsPath, "external-video.mp4");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(videoPath, "test-video");
		const resolvedVideoPath = await fs.realpath(videoPath);

		const { resolveApprovedLocalMediaPath, rememberApprovedLocalReadPath } = await import(
			"./manager"
		);
		const { isAllowedMediaPath } = await import("../../mediaServer");

		// Unapproved external paths are rejected before they ever reach the media server.
		expect(isAllowedMediaPath(videoPath)).toBe(false);
		await expect(resolveApprovedLocalMediaPath(videoPath)).resolves.toBeNull();

		// Once the user opts in (via dialog/export/etc.) the path is approved.
		await rememberApprovedLocalReadPath(videoPath);

		await expect(resolveApprovedLocalMediaPath(videoPath)).resolves.toBe(resolvedVideoPath);
		expect(isAllowedMediaPath(videoPath)).toBe(true);
	});

	it("rejects existing non-media files when resolving local media URLs", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const textPath = path.join(downloadsPath, "notes.txt");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(textPath, "not media");

		const { resolveApprovedLocalMediaPath } = await import("./manager");
		const { isAllowedMediaPath } = await import("../../mediaServer");

		await expect(resolveApprovedLocalMediaPath(textPath)).resolves.toBeNull();
		expect(isAllowedMediaPath(textPath)).toBe(false);
	});

	it("keeps a selected video's existing microphone and system tracks approved across session refreshes", async () => {
		const externalDir = path.join(tempRoot, "Custom recordings");
		await fs.mkdir(externalDir);
		const videoPath = path.join(externalDir, "recording.mp4");
		const micPath = path.join(externalDir, "recording.mic.wav");
		const systemPath = path.join(externalDir, "recording.system.m4a");
		const unrelatedPath = path.join(externalDir, "private.wav");
		await Promise.all(
			[videoPath, micPath, systemPath, unrelatedPath].map((file) =>
				fs.writeFile(file, "media"),
			),
		);
		const manager = await import("./manager");
		await manager.rememberApprovedLocalReadPath(unrelatedPath);
		await manager.rememberApprovedLocalReadPath(videoPath);
		await manager.replaceApprovedSessionLocalReadPaths([videoPath]);

		await expect(manager.resolveApprovedLocalMediaPath(micPath)).resolves.toBe(
			await fs.realpath(micPath),
		);
		await expect(manager.resolveApprovedLocalMediaPath(systemPath)).resolves.toBe(
			await fs.realpath(systemPath),
		);
		await expect(manager.resolveApprovedLocalMediaPath(unrelatedPath)).resolves.toBeNull();
	});

	it("does not approve a companion symlink pointing to an unrelated file", async ({ skip }) => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const privateAudio = path.join(tempRoot, "private.wav");
		const micPath = path.join(tempRoot, "recording.mic.wav");
		await fs.writeFile(videoPath, "video");
		await fs.writeFile(privateAudio, "private audio");
		try {
			await fs.symlink(privateAudio, micPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM")
				skip("Windows file symlinks are unavailable for this user.");
			throw error;
		}
		const manager = await import("./manager");
		await manager.rememberApprovedLocalReadPath(videoPath);
		await expect(manager.resolveApprovedLocalMediaPath(micPath)).resolves.toBeNull();
		await expect(manager.resolveApprovedLocalMediaPath(privateAudio)).resolves.toBeNull();
	});

	it("rejects a companion whose canonical path belongs to an unrelated file", async () => {
		const videoPath = path.join(tempRoot, "recording.mp4");
		const privateAudio = path.join(tempRoot, "private.wav");
		const micPath = path.join(tempRoot, "recording.mic.wav");
		await Promise.all(
			[videoPath, privateAudio, micPath].map((file) => fs.writeFile(file, "media")),
		);
		const realpath = fs.realpath;
		const canonicalize = vi
			.spyOn(fs, "realpath")
			.mockImplementation(async (input) =>
				String(input) === micPath ? privateAudio : realpath(input),
			);
		try {
			const manager = await import("./manager");
			await manager.rememberApprovedLocalReadPath(videoPath);
			await expect(manager.resolveApprovedLocalMediaPath(micPath)).resolves.toBeNull();
			await expect(manager.resolveApprovedLocalMediaPath(privateAudio)).resolves.toBeNull();
		} finally {
			canonicalize.mockRestore();
		}
	});

	it("distinguishes missing sidecars, unsupported files, directories, and denied media", async () => {
		const manager = await import("./manager");
		const denied = path.join(tempRoot, "unselected.wav");
		const unsupported = path.join(tempPath, "notes.txt");
		await fs.writeFile(denied, "private audio");
		await fs.writeFile(unsupported, "text");
		await expect(
			manager.resolveLocalMediaAccess(path.join(tempPath, "missing.mic.wav")),
		).resolves.toEqual({ success: false, reason: "missing" });
		await expect(manager.resolveLocalMediaAccess(tempPath)).resolves.toEqual({
			success: false,
			reason: "not-file",
		});
		await expect(manager.resolveLocalMediaAccess(unsupported)).resolves.toEqual({
			success: false,
			reason: "unsupported",
		});
		await expect(manager.resolveLocalMediaAccess(denied)).resolves.toEqual({
			success: false,
			reason: "denied",
		});
	});

	it("does not probe or approve an unselected video's companion tracks", async () => {
		const videoPath = path.join(tempRoot, "unselected.mp4");
		const micPath = path.join(tempRoot, "unselected.mic.wav");
		await fs.writeFile(videoPath, "video");
		await fs.writeFile(micPath, "private audio");
		const probe = vi.fn();
		vi.doMock("../recording/diagnostics", () => ({ getCompanionAudioFallbackInfo: probe }));
		const { getApprovedCompanionAudioFallbackInfo } = await import(
			"../recording/approvedAudioFallbacks"
		);
		const manager = await import("./manager");
		await expect(getApprovedCompanionAudioFallbackInfo(videoPath)).resolves.toMatchObject({
			success: false,
			paths: [],
		});
		expect(probe).not.toHaveBeenCalled();
		await expect(manager.resolveApprovedLocalMediaPath(micPath)).resolves.toBeNull();
	});

	it("filters unapproved probe results while retaining selected companion timing", async () => {
		const videoPath = path.join(tempRoot, "selected.mp4");
		const micPath = path.join(tempRoot, "selected.mic.wav");
		const unrelatedPath = path.join(tempRoot, "private.wav");
		await Promise.all(
			[videoPath, micPath, unrelatedPath].map((file) => fs.writeFile(file, "media")),
		);
		const realVideoPath = await fs.realpath(videoPath);
		const realMicPath = await fs.realpath(micPath);
		const probe = vi.fn().mockResolvedValue({
			paths: [realMicPath, unrelatedPath],
			startDelayMsByPath: { [realMicPath]: 125, [unrelatedPath]: 333 },
		});
		vi.doMock("../recording/diagnostics", () => ({ getCompanionAudioFallbackInfo: probe }));
		const { getApprovedCompanionAudioFallbackInfo } = await import(
			"../recording/approvedAudioFallbacks"
		);
		const manager = await import("./manager");
		await manager.rememberApprovedLocalReadPath(videoPath);
		await expect(getApprovedCompanionAudioFallbackInfo(videoPath)).resolves.toEqual({
			success: true,
			paths: [realMicPath],
			startDelayMsByPath: { [realMicPath]: 125 },
		});
		expect(probe).toHaveBeenCalledWith(realVideoPath);
		await expect(manager.resolveApprovedLocalMediaPath(unrelatedPath)).resolves.toBeNull();
	});

	it("rejects symlinks under allowed prefixes that point outside the allowlist", async ({
		skip,
	}) => {
		const outsideTarget = path.join(tempRoot, "outside-secret.mp4");
		const symlinkInsideUserData = path.join(userDataPath, "shortcut-to-secret.mp4");
		await fs.writeFile(outsideTarget, "secret-bytes");

		try {
			await fs.symlink(outsideTarget, symlinkInsideUserData);
		} catch (error) {
			// Windows requires Developer Mode or admin to create file symlinks. If
			// we can't create one, the bypass we're guarding against also can't be
			// crafted on this machine, so skipping is safe.
			if ((error as NodeJS.ErrnoException).code === "EPERM") {
				skip("Windows file symlinks are unavailable for this user.");
			}
			throw error;
		}

		const { isAllowedLocalMediaPath, resolveApprovedLocalMediaPath } = await import(
			"./manager"
		);

		await expect(isAllowedLocalMediaPath(symlinkInsideUserData)).resolves.toBe(false);
		await expect(resolveApprovedLocalMediaPath(symlinkInsideUserData)).resolves.toBeNull();
	});

	it("generates a missing project poster once and keeps it cached", async () => {
		const png = Buffer.alloc(24);
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
		png.writeUInt32BE(640, 16);
		png.writeUInt32BE(480, 20);
		const generate = vi.fn().mockResolvedValue(png);
		vi.doMock("./firstFrameThumbnail", () => ({ createProjectFirstFrameThumbnail: generate }));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "source.mp4");
		const projectPath = path.join(tempRoot, "test.recordly");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		const before = await fs.readFile(projectPath, "utf8");
		const entry = await manager.buildProjectLibraryEntry(projectPath, tempRoot);
		expect(entry?.thumbnailPath).toBeNull();
		await manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		expect((await manager.buildProjectLibraryEntry(projectPath, tempRoot))?.thumbnailPath).toBe(
			manager.getProjectThumbnailPath(projectPath),
		);
		expect(generate).toHaveBeenCalledWith(source);
		await manager.buildProjectLibraryEntry(projectPath, tempRoot);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(await fs.readFile(projectPath, "utf8")).toBe(before);
	});

	it("preserves an existing project thumbnail when no replacement is provided", async () => {
		const projectPath = path.join(tempRoot, "Projects", "demo.recordly");
		const thumbnailDataUrl = `data:image/png;base64,${Buffer.from("png-thumbnail").toString("base64")}`;
		await fs.mkdir(path.dirname(projectPath), { recursive: true });

		const { getProjectThumbnailPath, saveProjectThumbnail } = await import("./manager");
		const thumbnailPath = getProjectThumbnailPath(projectPath);

		await saveProjectThumbnail(projectPath, thumbnailDataUrl);
		await saveProjectThumbnail(projectPath, undefined);

		await expect(fs.readFile(thumbnailPath, "utf8")).resolves.toBe("png-thumbnail");
	});

	it("loads project files that start with a UTF-8 byte order mark", async () => {
		const videoPath = path.join(tempPath, "recording.mp4");
		const projectPath = path.join(tempPath, "recording.recordly");
		await fs.writeFile(videoPath, "test-video");
		await fs.writeFile(
			projectPath,
			`\uFEFF${JSON.stringify({
				version: 1,
				videoPath,
				editor: {},
			})}`,
			"utf-8",
		);

		const { loadProjectFromPath } = await import("./manager");

		const result = await loadProjectFromPath(projectPath);
		expect(result.success).toBe(true);
		expect(result.path).toBe(projectPath);
		expect(result.project).toMatchObject({ videoPath });
	});

	it("rejects invalid project payloads before approving media paths", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const videoPath = path.join(downloadsPath, "recording.mp4");
		const projectPath = path.join(tempPath, "invalid.recordly");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(videoPath, "test-video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({
				videoPath,
				editor: {},
			}),
			"utf-8",
		);

		const { loadProjectFromPath, resolveApprovedLocalMediaPath } = await import("./manager");

		const result = await loadProjectFromPath(projectPath);
		expect(result.success).toBe(false);
		expect(result.message).toBe("Invalid project file format");
		await expect(resolveApprovedLocalMediaPath(videoPath)).resolves.toBeNull();
	});

	it("approves editor audioRegions audioPath entries when loading a project", async () => {
		const downloadsPath = path.join(tempRoot, "Downloads");
		const videoPath = path.join(tempPath, "recording.mp4");
		const audioPath = path.join(downloadsPath, "music.ogg");
		const projectPath = path.join(tempPath, "recording.recordly");
		await fs.mkdir(downloadsPath, { recursive: true });
		await fs.writeFile(videoPath, "test-video");
		await fs.writeFile(audioPath, "test-audio");
		await fs.writeFile(
			projectPath,
			JSON.stringify({
				version: 1,
				videoPath,
				editor: {
					audioRegions: [{ id: "a1", startMs: 0, endMs: 1000, audioPath, volume: 1 }],
				},
			}),
			"utf-8",
		);

		const { loadProjectFromPath, resolveApprovedLocalMediaPath } = await import("./manager");
		const resolvedAudioPath = await fs.realpath(audioPath);

		const result = await loadProjectFromPath(projectPath);
		expect(result.success).toBe(true);
		await expect(resolveApprovedLocalMediaPath(audioPath)).resolves.toBe(resolvedAudioPath);
	});
	it("returns a library entry while a thumbnail decode is still pending", async () => {
		let release!: (data: Buffer) => void;
		const pending = new Promise<Buffer>((resolve) => {
			release = resolve;
		});
		const generate = vi.fn(() => pending);
		vi.doMock("./firstFrameThumbnail", () => ({ createProjectFirstFrameThumbnail: generate }));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "slow.mp4");
		const projectPath = path.join(tempRoot, "slow.recordly");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		const ready = vi.fn();
		const entry = await manager.buildProjectLibraryEntry(projectPath, tempRoot, ready);
		expect(entry?.path).toBe(projectPath);
		expect(entry?.thumbnailPath).toBeNull();
		const task = manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		expect(ready).not.toHaveBeenCalled();
		release(Buffer.from("fixture thumbnail"));
		await task;
		expect(generate).toHaveBeenCalledTimes(1);
		expect(ready).toHaveBeenCalledWith(expect.objectContaining({ path: projectPath }));
	});

	it("replaces a thumbnail symlink without overwriting its target", async ({ skip }) => {
		vi.doMock("./firstFrameThumbnail", () => ({
			createProjectFirstFrameThumbnail: vi.fn().mockResolvedValue(Buffer.from("new poster")),
		}));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "source.mp4");
		const projectPath = path.join(tempRoot, "linked.recordly");
		const target = path.join(tempRoot, "private.txt");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		await fs.writeFile(target, "must remain intact");
		const thumbnail = manager.getProjectThumbnailPath(projectPath);
		try {
			await fs.symlink(target, thumbnail);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM")
				skip("Windows file symlinks are unavailable for this user.");
			throw error;
		}
		await manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		expect(await fs.readFile(target, "utf8")).toBe("must remain intact");
		expect((await fs.lstat(thumbnail)).isSymbolicLink()).toBe(false);
		expect(await fs.readFile(thumbnail, "utf8")).toBe("new poster");
	});

	it("discards a thumbnail when the project changes during decoding", async () => {
		let release!: (data: Buffer) => void;
		const pending = new Promise<Buffer>((resolve) => {
			release = resolve;
		});
		const generate = vi.fn(() => pending);
		vi.doMock("./firstFrameThumbnail", () => ({ createProjectFirstFrameThumbnail: generate }));
		const manager = await import("./manager");
		const source = path.join(tempRoot, "source.mp4");
		const projectPath = path.join(tempRoot, "edited.recordly");
		await fs.writeFile(source, "video");
		await fs.writeFile(
			projectPath,
			JSON.stringify({ version: 2, videoPath: source, editor: {} }),
		);
		const task = manager.refreshProjectThumbnail(projectPath, await fs.stat(projectPath));
		await vi.waitFor(() => expect(generate).toHaveBeenCalled());
		await fs.appendFile(projectPath, " ");
		release(Buffer.from("obsolete poster"));
		expect(await task).toBeNull();
		await expect(fs.stat(manager.getProjectThumbnailPath(projectPath))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
	it("rejects a future project before approving media or changing the session, preserving bytes", async () => {
		const manager = await import("./manager");
		const state = await import("../state");
		const projectPath = path.join(tempRoot, "future.recordly");
		const source = path.join(tempRoot, "future.mp4");
		await fs.writeFile(source, "original-media");
		const data = JSON.stringify({
			version: 999,
			videoPath: source,
			editor: { futureField: { keep: true } },
		});
		await fs.writeFile(projectPath, data);
		const oldProject = state.currentProjectPath;
		const oldVideo = state.currentVideoPath;
		const result = await manager.loadProjectFromPath(projectPath);
		expect(result.success).toBe(false);
		expect(result.message).toContain("newer version");
		expect(state.currentProjectPath).toBe(oldProject);
		expect(state.currentVideoPath).toBe(oldVideo);
		expect(await manager.resolveApprovedLocalMediaPath(source)).toBeNull();
		expect(await fs.readFile(projectPath, "utf8")).toBe(data);
		expect(await fs.readFile(source, "utf8")).toBe("original-media");
	});
});
