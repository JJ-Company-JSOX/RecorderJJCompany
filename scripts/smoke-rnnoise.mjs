// Synthetic-only validation. No microphone, desktop capture, private media or network.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv.includes("--run")) {
	console.log("Run --run to validate the bundled RNNoise executable using synthetic PCM.");
	process.exit(0);
}
const dir = await fs.mkdtemp(path.join(root, ".tmp/rnnoise-smoke-"));
const exe = path.join(root, "vendor/offline-tools/win32-x64/rnnoise/rnnoise-cli.exe");
const wav = path.join(dir, "synthetic-speech.wav");
const ps = `Add-Type -AssemblyName System.Speech; $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; $voice.SetOutputToWaveFile('${wav.replace(/'/g, "''")}'); $voice.Speak('Welcome to the offline video editor. Click the blue save button and keep the full screen visible.'); $voice.Dispose();`;
execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
	windowsHide: true,
	stdio: "pipe",
});
const pcm = path.join(dir, "speech.s16le");
execFileSync(
	createRequire(import.meta.url)("ffmpeg-static"),
	["-nostdin", "-v", "error", "-y", "-i", wav, "-ar", "48000", "-ac", "1", "-f", "s16le", pcm],
	{ windowsHide: true, stdio: "pipe" },
);
const speech = await fs.readFile(pcm);
let last = speech.length / 2 - 1;
while (last > 0 && Math.abs(speech.readInt16LE(last * 2)) < 300) last--;
const N = 24000 + last + 1,
	source = Buffer.alloc(N * 2);
let seed = 7919;
for (let i = 0; i < N; i++) {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	const noise = (seed / 4294967296 - 0.5) * 500;
	const voice = i < 24000 ? 0 : speech.readInt16LE((i - 24000) * 2);
	source.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(voice + noise))), i * 2);
}
await fs.writeFile(path.join(dir, "source.s16le"), source);
const start = performance.now();
execFileSync(exe, [path.join(dir, "source.s16le"), path.join(dir, "raw.s16le"), "--raw-delay"], {
	windowsHide: true,
	stdio: "pipe",
});
execFileSync(exe, [path.join(dir, "source.s16le"), path.join(dir, "aligned.s16le")], {
	windowsHide: true,
	stdio: "pipe",
});
const raw = await fs.readFile(path.join(dir, "raw.s16le")),
	aligned = await fs.readFile(path.join(dir, "aligned.s16le"));
assert.equal(aligned.length, source.length);
assert.equal(raw.length, source.length + 1920);
assert.deepEqual(aligned, raw.subarray(1920));
// Independently find algorithm delay using sample waveform cross-correlation.
const correlation = (lag) => {
	let xy = 0,
		xx = 0,
		yy = 0;
	for (let i = 30000; i < N - 3000; i += 3) {
		const x = source.readInt16LE(i * 2),
			y = raw.readInt16LE((i + lag) * 2);
		xy += x * y;
		xx += x * x;
		yy += y * y;
	}
	return xy / Math.sqrt(xx * yy);
};
let best = { lag: 0, correlation: -1 };
for (let lag = 0; lag <= 1440; lag++) {
	const c = correlation(lag);
	if (c > best.correlation) best = { lag, correlation: c };
}
assert.ok(Math.abs(best.lag - 960) <= 2, `Unverified RNNoise latency ${JSON.stringify(best)}`);
assert.ok(best.correlation > 0.7, `Poor waveform retention ${best.correlation}`);
let tail = 0;
for (let i = N - 137; i < N; i++) tail += aligned.readInt16LE(i * 2) ** 2;
assert.ok(tail > 0, "Tail was discarded");
for (const samples of [0, 1, 137, 479, 480, 481, 959, 960, 961]) {
	const file = path.join(dir, `length-${samples}.s16le`),
		out = path.join(dir, `length-${samples}-out.s16le`);
	await fs.writeFile(file, source.subarray(0, samples * 2));
	execFileSync(exe, [file, out], { windowsHide: true, stdio: "pipe" });
	assert.equal((await fs.stat(out)).size, samples * 2);
}
const rms = (b, a, z) => {
	let sum = 0;
	for (let i = a; i < z; i++) sum += b.readInt16LE(i * 2) ** 2;
	return Math.sqrt(sum / (z - a));
};
const report = {
	success: true,
	syntheticOnly: true,
	samples: N,
	sampleRate: 48000,
	elapsedMs: performance.now() - start,
	measuredLatency: best,
	tailRms: rms(aligned, N - 137, N),
	noiseReductionDb:
		20 * Math.log10(rms(source, 9600, 22000) / Math.max(1e-10, rms(aligned, 9600, 22000))),
	checks: [
		"exact sample count",
		"independent latency correlation",
		"padding/drain tail",
		"byte exact compensation",
		"tiny and frame-boundary inputs",
	],
};
await fs.writeFile(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, reportPath: path.join(dir, "report.json") }, null, 2));
