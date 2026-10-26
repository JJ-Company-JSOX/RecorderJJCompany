// Keep the usual npm build entry on the same platform-specific packaging paths.
// In particular, Windows builds must include the client model payload.
import { spawn } from "node:child_process";
const script = { win32: "build:win", darwin: "build:mac", linux: "build:linux" }[process.platform];
if (!script || !process.env.npm_execpath) throw Error("Run npm run build on a supported platform.");
const child = spawn(process.execPath, [process.env.npm_execpath, "run", script], {
	stdio: "inherit",
	env: process.env,
	shell: false,
});
child.on("error", (error) => {
	console.error(error.message);
	process.exitCode = 1;
});
child.on("exit", (code, signal) => {
	process.exitCode = signal ? 1 : (code ?? 1);
});
