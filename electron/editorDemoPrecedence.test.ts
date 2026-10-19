import { describe, expect, it } from "vitest";
import { resolveInitialDemoInput } from "./editorStartupView";

describe("demo launch precedence", () => {
	const demo = { devInput: "C:/isolated/input.mp4", devWebcam: "C:/isolated/webcam.mp4" };
	it("opens the explicitly requested demo only for an empty initial session", () => {
		expect(resolveInitialDemoInput(demo)).toEqual({
			devOpenInput: demo.devInput,
			devOpenWebcam: demo.devWebcam,
		});
	});
	it.each([
		"projectPath",
		"videoPath",
		"recordingVideoPath",
	] as const)("never replaces a real %s on a new editor/reload", (key) => {
		expect(resolveInitialDemoInput({ ...demo, [key]: "C:/user/fresh-recording.mp4" })).toEqual(
			{},
		);
	});
	it("does not inject a detached demo webcam into normal launches", () => {
		expect(resolveInitialDemoInput({ devWebcam: demo.devWebcam })).toEqual({});
	});
});
