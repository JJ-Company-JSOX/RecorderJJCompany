// Explicit opt-in integration test. Generates synthetic media; never records the desktop.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const usage = `Offline speech packaged-app smoke test (Windows x64)

Usage:
  node scripts/smoke-offline-speech.mjs --help
  node scripts/smoke-offline-speech.mjs --run [--executable <Recordly.exe>]

Without --run, no app, recorder, model, or fixture generator starts.
--help always takes precedence over --run.
Default executable: release/offline-speech-test/win-unpacked/Recordly.exe

With --run, creates a new ignored .tmp profile and synthetic image/audio/video.
SAPI writes English speech to WAV without speaker playback. The app imports that
video; the test never records your screen or opens your existing projects.
Real bundled ASR and reasoning run through the actual UI, followed by project
save, Undo, reopen and H264/AAC export checks. Only native file chooser dialogs
are replaced. Only the app instance created by this test is closed.
Requires installed npm dependencies, Windows English SAPI voice, Segoe UI/Arial,
and a complete built speech package. No downloads, paid APIs or uploads.
Artifacts/report remain in a new .tmp/offline-speech-smoke/run-* directory.
`;
const args = process.argv.slice(2);
if (!args.includes("--run") || args.includes("--help") || args.includes("-h")) {
	console.log(usage);
} else {
	let executable = path.join(repository, "release/offline-speech-test/win-unpacked/Recordly.exe");
	for (let index = 0; index < args.length; index++) {
		if (args[index] === "--run") continue;
		if (
			args[index] === "--executable" &&
			args[index + 1] &&
			!args[index + 1].startsWith("--")
		) {
			executable = path.resolve(args[++index]);
		} else throw Error(`Unknown or incomplete argument: ${args[index]}\n${usage}`);
	}
	await run(executable);
}

async function run(executable) {
	if (process.platform !== "win32" || process.arch !== "x64")
		throw Error("Run this smoke test on Windows x64.");
	await fs.access(executable);
	// Delay nonstandard imports until explicit opt-in. --help needs only Node.
	const [{ _electron, expect: playwrightExpect }, { default: ffmpeg }, { default: ffprobe }] =
		await Promise.all([
			import("@playwright/test"),
			import("ffmpeg-static"),
			import("ffprobe-static"),
		]);
	assert(ffmpeg && ffprobe.path, "FFmpeg and FFprobe dependencies must be installed.");
	const expect = playwrightExpect.configure({ timeout: 60_000 });
	const parent = path.join(repository, ".tmp/offline-speech-smoke");
	await fs.mkdir(parent, { recursive: true });
	const artifacts = await fs.mkdtemp(path.join(parent, "run-"));
	const profile = path.join(artifacts, "profile"),
		output = path.join(artifacts, "export.mp4");
	const report = {
		success: false,
		syntheticOnly: true,
		packaged: true,
		executable,
		artifacts,
		checks: [],
		errors: [],
		limits: [
			"Synthetic English only; this does not establish broad ASR/edit quality, recording performance, or microphone capture.",
			"External HTTP is blocked in this app's Chromium session; the whole machine is not disconnected.",
			"Cleanup checks inspect model processes directly parented by this test's main process, not unrelated apps.",
		],
	};
	let app, page;
	const check = (message) => {
		report.checks.push(message);
		writeFileSync(path.join(artifacts, "progress.json"), JSON.stringify(report, null, 2));
		console.log(message);
	};
	const command = (file, commandArgs, options = {}) => {
		const result = spawnSync(file, commandArgs, {
			windowsHide: true,
			encoding: "utf8",
			timeout: 120_000,
			maxBuffer: 8 * 1024 * 1024,
			...options,
		});
		if (result.error || result.status !== 0)
			throw Error(
				`${path.basename(file)} failed: ${result.error?.message || result.stderr || result.status}`,
			);
		return result.stdout;
	};
	const probe = (file) =>
		JSON.parse(
			command(
				ffprobe.path,
				["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
				{ timeout: 15_000 },
			),
		);
	try {
		const input = await createFixture(artifacts, ffmpeg, probe, command);
		const fixture = JSON.parse(await fs.readFile(path.join(artifacts, "fixture.json"), "utf8"));
		check(
			"generated synthetic English repeated-speech MP4 without screen capture or audio playback",
		);
		await fs.mkdir(profile);
		await fs.writeFile(
			path.join(profile, "app-settings.json"),
			JSON.stringify({ "recordly.onboarding.v1.seen": true }),
		);
		const env = { ...process.env };
		for (const key of Object.keys(env)) {
			if (
				/^RECORDLY_/.test(key) ||
				key === "ELECTRON_RUN_AS_NODE" ||
				key === "VITE_DEV_SERVER_URL"
			)
				delete env[key];
		}
		Object.assign(env, {
			RECORDLY_DIAGNOSTICS_USER_DATA: profile,
			RECORDLY_DEV_OPEN_RECORDING_INPUT: input,
			RECORDLY_DISABLE_AUTO_UPDATES: "1",
		});
		const start = performance.now();
		app = await _electron.launch({ executablePath: executable, env, timeout: 120_000 });
		report.appPid = app.process().pid;
		await app.evaluate(({ session, dialog }, file) => {
			session.defaultSession.webRequest.onBeforeRequest(
				{ urls: ["http://*/*", "https://*/*"] },
				(details, done) =>
					done({
						cancel: !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(details.url),
					}),
			);
			dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
		}, output);
		page = await app.firstWindow();
		page.setDefaultTimeout(60_000);
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 90_000 });
		report.originalClipEndMs = await page
			.locator('[data-variant="clip"]')
			.getAttribute("data-end-ms");
		report.editorReadyMs = Math.round(performance.now() - start);
		const statuses = await page.evaluate(async () => ({
			vision: await window.electronAPI.getBundledAiStatus(),
			speech: await window.electronAPI.getBundledSpeechStatus(),
		}));
		assert(
			statuses.vision.available && statuses.speech.available,
			"Complete bundled vision and speech assets must be available.",
		);
		check("packaged speech and vision assets available with isolated signed-out profile");
		await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
		const panel = page.locator("[data-auto-edit-panel]");
		const button = panel.getByRole("button", {
			name: "Automatically edit speech and video",
			exact: true,
		});
		await expect(button).toBeEnabled();
		const aiStart = performance.now();
		await button.click();
		await expect(button).toBeEnabled({ timeout: 600_000 });
		report.automaticEditMs = Math.round(performance.now() - aiStart);
		const alerts = await panel.getByRole("alert").allTextContents();
		assert.equal(alerts.length, 0, alerts.join("\n"));
		await expect(
			panel.getByText("Applied. Use Undo to restore the previous timeline.", { exact: true }),
		).toBeVisible();
		report.summary = await panel.getByRole("status").allTextContents();
		await page.screenshot({ path: path.join(artifacts, "automatic-draft.png") });
		await panel.getByRole("button", { name: "Close", exact: true }).click();
		check(
			"real bundled ASR, transcript reasoning and visual inference produce one-click automatic draft",
		);
		await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()
				.find((window) => window.webContents.getURL().includes("windowType=editor"))
				?.webContents.send("menu-save-project"),
		);
		const directory = await page.evaluate(() => window.electronAPI.getProjectsDirectory());
		assert(
			directory.success && within(profile, directory.path),
			"Save directory must stay inside the isolated profile.",
		);
		let saved;
		await expect
			.poll(
				async () => {
					for (const name of await fs.readdir(directory.path)) {
						if (!name.endsWith(".recordly")) continue;
						const file = path.join(directory.path, name);
						try {
							const project = JSON.parse(await fs.readFile(file, "utf8"));
							if (project.editor.autoCaptions?.length) {
								saved = { file, project };
								return true;
							}
						} catch {
							/* Atomic save may still be settling. */
						}
					}
					return false;
				},
				{ timeout: 60_000 },
			)
			.toBe(true);
		report.captions = saved.project.editor.autoCaptions;
		report.clips = saved.project.editor.clipRegions;
		assert.equal(
			saved.project.editor.annotationRegions?.length ?? 0,
			0,
			"Automatic speech drafts must not cover screen controls with generated labels.",
		);
		assert(report.captions.some((caption) => /save/i.test(caption.text)));
		assert(report.captions.some((caption) => /full screen/i.test(caption.text)));
		const originalDuration = Number(probe(input).format.duration);
		const timelineMs = Math.max(...report.clips.map((clip) => clip.endMs));
		report.sourceDurationMs = originalDuration * 1000;
		report.timelineDurationMs = timelineMs;
		const sourceRanges = report.clips.map((clip) => {
			const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
			const fromMs = Number.isFinite(clip.sourceStartMs) ? clip.sourceStartMs : clip.startMs;
			return { fromMs, toMs: fromMs + (clip.endMs - clip.startMs) * speed };
		});
		report.retainedSourceDurationMs = sourceRanges.reduce(
			(sum, range) => sum + range.toMs - range.fromMs,
			0,
		);
		report.omittedSourceDurationMs = report.sourceDurationMs - report.retainedSourceDurationMs;
		assert(
			report.omittedSourceDurationMs > 500,
			"A faster playback rate alone is not a semantic cut: actual source duration must be omitted.",
		);
		const firstTake = fixture.segments[1];
		const retainedFirstTakeMs = sourceRanges.reduce(
			(sum, range) =>
				sum +
				Math.max(
					0,
					Math.min(range.toMs, firstTake.toMs) - Math.max(range.fromMs, firstTake.fromMs),
				),
			0,
		);
		report.omittedFirstTakeMs = firstTake.toMs - firstTake.fromMs - retainedFirstTakeMs;
		const uniqueInstruction = report.captions.find(
			(caption) => /save/i.test(caption.text) && /full screen/i.test(caption.text),
		);
		assert(uniqueInstruction, "The unique instruction must be recognized.");
		const retainedInstructionMs = sourceRanges.reduce(
			(sum, range) =>
				sum +
				Math.max(
					0,
					Math.min(range.toMs, uniqueInstruction.endMs) -
						Math.max(range.fromMs, uniqueInstruction.startMs),
				),
			0,
		);
		report.uniqueInstructionRetained =
			retainedInstructionMs >= uniqueInstruction.endMs - uniqueInstruction.startMs - 5;
		assert(
			report.uniqueInstructionRetained,
			"The complete unique instruction must remain in source ranges.",
		);
		assert(
			report.omittedFirstTakeMs > 500,
			"The positive repeat fixture must omit part of the earlier repeated take, not only silence.",
		);
		assert(
			timelineMs < originalDuration * 1000 - 500,
			"The automatic draft must shorten this repeated/quiet fixture.",
		);
		assert(report.clips.every((clip) => clip.endMs > clip.startMs));
		const savedCopy = path.join(artifacts, "saved-speech.recordly");
		await fs.copyFile(saved.file, savedCopy);
		check(
			"saved project contains actual recognized captions and a shorter non-destructive timeline",
		);
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
		await expect(page.locator('[data-variant="clip"]')).toHaveAttribute(
			"data-end-ms",
			report.originalClipEndMs,
		);
		check("one Undo restores the original clip timeline");
		await app.evaluate(({ dialog }, file) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
		}, savedCopy);
		await page.getByRole("button", { name: "Home", exact: true }).click();
		const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		await home
			.getByRole("complementary", { name: "Library navigation" })
			.getByRole("button", { name: "Import video", exact: true })
			.click();
		await expect(home).not.toBeVisible();
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(report.clips.length);
		await expect
			.poll(async () =>
				Math.max(
					...(await page
						.locator('[data-variant="clip"]')
						.evaluateAll((clips) =>
							clips.map((clip) => Number(clip.getAttribute("data-end-ms"))),
						)),
				),
			)
			.toBe(timelineMs);
		check("saved automatic speech draft reopens with its edited timeline");
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		await page.getByRole("row", { name: "Local", exact: true }).click();
		await page.getByRole("button", { name: "Export Video", exact: true }).click();
		await expect
			.poll(
				async () => {
					try {
						report.export = probe(output);
						return Boolean(
							report.export.streams?.length &&
								Number(report.export.format.duration) > 0,
						);
					} catch {
						return false;
					}
				},
				{ timeout: 240_000 },
			)
			.toBe(true);
		assert(report.export.streams.some((stream) => stream.codec_name === "h264"));
		assert(report.export.streams.some((stream) => stream.codec_name === "aac"));
		assert(Math.abs(Number(report.export.format.duration) * 1000 - timelineMs) < 500);
		const videoStream = report.export.streams.find((stream) => stream.codec_type === "video");
		const audioStream = report.export.streams.find((stream) => stream.codec_type === "audio");
		const videoSeconds = Number(videoStream.duration),
			audioSeconds = Number(audioStream.duration);
		assert(Number.isFinite(videoSeconds) && Number.isFinite(audioSeconds));
		assert(
			Math.abs(videoSeconds - audioSeconds) < 0.2,
			"Exported audio/video durations must agree within 0.2 seconds.",
		);
		const loudness = spawnSync(
			ffmpeg,
			[
				"-hide_banner",
				"-nostats",
				"-i",
				output,
				"-map",
				"0:a:0",
				"-af",
				"volumedetect",
				"-vn",
				"-f",
				"null",
				"-",
			],
			{ windowsHide: true, encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
		);
		assert(
			!loudness.error && loudness.status === 0,
			"Exported AAC must decode for volume analysis.",
		);
		await fs.writeFile(path.join(artifacts, "export-audio-volume.log"), loudness.stderr);
		const match = /mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/.exec(loudness.stderr);
		const meanDb = match ? Number(match[1]) : Number.NaN;
		assert(
			Number.isFinite(meanDb) && meanDb > -60,
			"Exported AAC must contain audible-level synthetic speech above -60 dB mean.",
		);
		report.exportAudioEvidence = {
			meanDb,
			videoSeconds,
			audioSeconds,
			durationDifferenceSeconds: Math.abs(videoSeconds - audioSeconds),
		};
		check(
			"real H264/AAC export matches timeline duration, retains non-silent speech and aligned stream durations",
		);
		const powershell = path.join(
			process.env.SystemRoot || "C:\\Windows",
			"System32/WindowsPowerShell/v1.0/powershell.exe",
		);
		assert(Number.isSafeInteger(report.appPid));
		const remaining = command(
			powershell,
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${report.appPid}' -ErrorAction Stop | Where-Object { $_.Name -in @('llama-server.exe','whisper-cli.exe') }).Count`,
			],
			{ timeout: 30_000 },
		);
		assert.equal(
			Number(remaining.trim()),
			0,
			"Owned speech/reasoning processes must exit after analysis.",
		);
		check("this app instance's speech and reasoning child processes exited");
		report.success = true;
	} catch (error) {
		report.errors.push(String(error.stack || error));
		if (page && !page.isClosed()) {
			await page.screenshot({ path: path.join(artifacts, "failure.png") }).catch(() => {
				/* A failed or closed renderer may no longer support screenshots. */
			});
			await fs.writeFile(
				path.join(artifacts, "body.txt"),
				await page
					.locator("body")
					.innerText()
					.catch(() => ""),
			);
		}
		process.exitCode = 1;
	} finally {
		// app refers only to the test's isolated launch; never enumerate/kill user apps.
		if (app) {
			await app
				.evaluate(({ app: ownApp }) => ownApp.exit(0))
				.catch(() => {
					/* Exiting may disconnect Playwright before its RPC resolves. */
				});
			await app.close().catch(() => {
				/* The owned application may already have exited. */
			});
		}
		await fs.writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
		console.log(JSON.stringify(report, null, 2));
	}
}

function within(root, file) {
	if (typeof file !== "string") return false;
	const relative = path.relative(root, file);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function createFixture(directory, ffmpeg, probe, command) {
	const windows = process.env.SystemRoot || "C:\\Windows";
	const powershell = path.join(windows, "System32/WindowsPowerShell/v1.0/powershell.exe");
	const synthesis = path.join(directory, "synthesize.ps1");
	await fs.writeFile(
		synthesis,
		`param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'en' } | Sort-Object { $_.VoiceInfo.Name -ne 'Microsoft Zira Desktop' } | Select-Object -First 1
  if (-not $voice) { throw 'An installed Windows English SAPI voice is required; no voice is downloaded.' }
  $synth.SelectVoice($voice.VoiceInfo.Name)
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile((Join-Path $OutputDirectory 'save.wav'),$format)
  $synth.Speak('Welcome to the offline video editor.')
  $synth.SetOutputToNull()
  $synth.SetOutputToWaveFile((Join-Path $OutputDirectory 'full.wav'),$format)
  $synth.Speak('Click the blue save button and keep the full screen visible.')
} finally { $synth.Dispose() }
`,
	);
	command(powershell, [
		"-NoProfile",
		"-NonInteractive",
		"-File",
		synthesis,
		"-OutputDirectory",
		directory,
	]);
	let font;
	for (const name of ["segoeui.ttf", "arial.ttf"]) {
		const candidate = path.join(windows, "Fonts", name);
		if (await fs.stat(candidate).catch(() => null)) {
			font = candidate;
			break;
		}
	}
	assert(font, "An installed Segoe UI or Arial font is required.");
	const copiedFont = path.join(directory, "fixture-font.ttf");
	await fs.copyFile(font, copiedFont);
	const image = path.join(directory, "fixture.png");
	try {
		command(
			ffmpeg,
			[
				"-y",
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=c=0xf4f6fa:s=640x360:r=15",
				"-vf",
				"drawbox=x=24:y=24:w=592:h=312:color=white:t=fill,drawtext=fontfile=fixture-font.ttf:text='Offline video editor':x=48:y=48:fontsize=28:fontcolor=0x182a44,drawtext=fontfile=fixture-font.ttf:text='Keep the full screen visible.':x=48:y=112:fontsize=22:fontcolor=0x394b60,drawbox=x=440:y=260:w=140:h=48:color=0x087dff:t=fill,drawtext=fontfile=fixture-font.ttf:text='Save':x=482:y=272:fontsize=22:fontcolor=white",
				"-frames:v",
				"1",
				"-threads",
				"1",
				image,
			],
			{ cwd: directory },
		);
	} finally {
		await fs.unlink(copiedFont);
	}
	const save = path.join(directory, "save.wav"),
		full = path.join(directory, "full.wav");
	const audio = path.join(directory, "combined.wav"),
		input = path.join(directory, "input.mp4");
	command(ffmpeg, [
		"-y",
		"-v",
		"error",
		"-i",
		save,
		"-f",
		"lavfi",
		"-t",
		"2",
		"-i",
		"anullsrc=r=16000:cl=mono",
		"-i",
		full,
		"-f",
		"lavfi",
		"-t",
		"1",
		"-i",
		"anullsrc=r=16000:cl=mono",
		"-f",
		"lavfi",
		"-t",
		"0.5",
		"-i",
		"anullsrc=r=16000:cl=mono",
		"-filter_complex",
		"[4:a][0:a][1:a][0:a][2:a][3:a]concat=n=6:v=0:a=1[out]",
		"-map",
		"[out]",
		"-c:a",
		"pcm_s16le",
		"-ar",
		"16000",
		"-ac",
		"1",
		audio,
	]);
	command(ffmpeg, [
		"-y",
		"-v",
		"error",
		"-loop",
		"1",
		"-i",
		image,
		"-i",
		audio,
		"-r",
		"15",
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"23",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-b:a",
		"64k",
		"-ar",
		"16000",
		"-ac",
		"1",
		"-shortest",
		"-movflags",
		"+faststart",
		input,
	]);
	let fromMs = 0;
	const saveMs = Math.round(Number(probe(save).format.duration) * 1000),
		fullMs = Math.round(Number(probe(full).format.duration) * 1000);
	const segments = [
		["silence", "", 500],
		["speech", "Welcome to the offline video editor.", saveMs],
		["silence", "", 2000],
		["speech", "Welcome to the offline video editor.", saveMs],
		["speech", "Click the blue save button and keep the full screen visible.", fullMs],
		["silence", "", 1000],
	].map(([kind, text, durationMs]) => {
		const segment = { kind, text, fromMs, toMs: fromMs + durationMs };
		fromMs += durationMs;
		return segment;
	});
	const media = probe(input);
	assert(
		media.streams.some(
			(stream) =>
				stream.codec_name === "h264" &&
				stream.width === 640 &&
				stream.height === 360 &&
				stream.avg_frame_rate === "15/1",
		),
	);
	assert(
		media.streams.some(
			(stream) =>
				stream.codec_name === "aac" &&
				Number(stream.sample_rate) === 16000 &&
				stream.channels === 1,
		),
	);
	await fs.writeFile(
		path.join(directory, "fixture.json"),
		JSON.stringify(
			{
				media: input,
				syntheticOnly: true,
				segments,
				mediaDurationSeconds: Number(media.format.duration),
				caveat: "Speech ranges are allocated SAPI WAV spans including natural pauses; not hand-aligned word timestamps.",
			},
			null,
			2,
		),
	);
	return input;
}
