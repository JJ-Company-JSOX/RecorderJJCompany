import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
async function setup(
	page: Page,
	vision = false,
	deferred = false,
	options: {
		originalCaptions?: boolean;
		repeat?: boolean;
		speech?: "ok" | "deferred" | "no-audio" | "missing-model";
	} = {},
) {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(
		page,
		({ vision, deferred, options }) => {
			localStorage.setItem("recordly.locale", "en");
			window.electronAPI.inspectAutoEditLocalModel = async (name) => ({
				success: true,
				info: {
					name,
					sizeBytes: 2500000000,
					license: "Apache-2.0",
					capabilities: vision ? ["completion", "vision"] : ["completion"],
				},
			});
			window.electronAPI.draftVideoStory = async (request, model, language) => {
				document.documentElement.dataset.storyRequest = JSON.stringify({
					request,
					model,
					language,
				});
				if (deferred)
					await new Promise<void>((resolve) =>
						window.addEventListener("finish-story", () => resolve(), { once: true }),
					);
				return {
					success: true,
					draft: {
						cues: request.scenes.map((s) => ({
							id: s.id,
							startMs: s.startMs,
							endMs: s.endMs,
							stage: "Hook",
							title: "Create offline",
							text: "Show your product clearly.",
						})),
					},
				};
			};
			window.electronAPI.getBundledSpeechStatus = async () => ({
				available: options.speech !== "missing-model",
			});
			window.electronAPI.getWhisperSmallModelStatus = async () => ({
				success: true,
				exists: false,
				path: null,
			});
			let speechProgress:
				| ((state: {
						phase: "preparing" | "transcribing" | "complete" | "cancelled" | "error";
				  }) => void)
				| undefined;
			window.electronAPI.onAutoCaptionProgress = (callback) => {
				speechProgress = callback;
				return () => {
					speechProgress = undefined;
				};
			};
			window.electronAPI.cancelAutoCaptionGeneration = async () => {
				document.documentElement.dataset.speechCanceled = "true";
				return { success: true, cancelled: true };
			};
			window.electronAPI.generateAutoCaptions = async (input) => {
				document.documentElement.dataset.speechRequest = JSON.stringify(input);
				document.documentElement.dataset.speechCalls = String(
					Number(document.documentElement.dataset.speechCalls ?? 0) + 1,
				);
				speechProgress?.({ phase: "transcribing" });
				if (options.speech === "deferred")
					await new Promise<void>((resolve) =>
						window.addEventListener("finish-speech", () => resolve(), { once: true }),
					);
				if (options.speech === "no-audio")
					return { success: false, errorCode: "no-audio", message: "No audio" };
				speechProgress?.({ phase: "complete" });
				return {
					success: true,
					cues: [
						{
							id: "recognized-1",
							startMs: 1000,
							endMs: 2000,
							text: "This editor works offline.",
							words: [
								{ text: "This editor works offline.", startMs: 1000, endMs: 2000 },
							],
						},
					],
				};
			};
			window.electronAPI.narrateAutoEditLocally = async () => {
				throw Error("Tutorial should not run");
			};
			window.electronAPI.getBundledTtsStatus = async () => ({
				available: true,
				voices: { en: true, zh: true, ms: false },
				engine: "kokoro",
				voiceList: [
					{
						id: 3,
						language: "en",
						gender: "female",
						default: true,
						labels: { en: "Heart", zh: "Heart", ms: "Heart" },
					},
				],
			});
			window.electronAPI.synthesizeAutoEditNarration = async (cues, language) => {
				document.documentElement.dataset.storyTts = JSON.stringify({ cues, language });
				document.documentElement.dataset.storyTtsCount = String(
					Number(document.documentElement.dataset.storyTtsCount ?? 0) + 1,
				);
				return {
					success: true,
					clips: cues.map((c) => ({
						id: c.id,
						audioPath: `${location.origin}/story-voice.wav`,
						durationMs: 1000,
					})),
				};
			};
			window.electronAPI.onMenuSaveProject = (callback) => {
				const handler = () => void callback();
				window.addEventListener("save-story", handler);
				return () => window.removeEventListener("save-story", handler);
			};
			window.electronAPI.saveProjectFile = async (project) => {
				sessionStorage.setItem("story-project", JSON.stringify(project));
				return { success: true, path: "/story.recordly" };
			};
			window.electronAPI.loadCurrentProjectFile = async () => {
				const saved = sessionStorage.getItem("story-project");
				return saved
					? { success: true, path: "/story.recordly", project: JSON.parse(saved) }
					: options.originalCaptions || options.repeat
						? {
								success: true,
								path: "/story-input.recordly",
								project: {
									version: 2,
									videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
									editor: {
										clipRegions: Array.from(
											{ length: options.repeat ? 3 : 1 },
											(_, i) => ({
												id: `input-${i}`,
												startMs: i * 6000,
												endMs: (i + 1) * 6000,
												sourceStartMs: 0,
												sourceMinMs: 0,
												sourceMaxMs: 6000,
												speed: 1,
											}),
										),
										autoCaptions: options.originalCaptions
											? [
													{
														id: "original-speech",
														startMs: 1000,
														endMs: 2000,
														text: "The product works offline.",
													},
												]
											: [],
									},
								},
							}
						: { success: false };
			};
		},
		{ vision, deferred, options },
	);
	const wav = Buffer.alloc(44 + 48000 * 2);
	wav.write("RIFF");
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(48000, 24);
	wav.writeUInt32LE(96000, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(wav.length - 44, 40);
	for (let i = 0; i < 48000; i++)
		wav.writeInt16LE(Math.round(Math.sin((i * Math.PI * 880) / 48000) * 4000), 44 + i * 2);
	await page.route("**/story-voice.wav*", (r) =>
		r.fulfill({ body: wav, contentType: "audio/wav" }),
	);
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]').first()).toHaveAttribute(
		"data-end-ms",
		"6000",
		{
			timeout: 20000,
		},
	);
	await page.getByRole("combobox", { name: "AI mode", exact: true }).selectOption("ollama");
	await page.getByRole("button", { name: "Check local model", exact: true }).click();
	await page
		.getByRole("button", { name: "Add AI voice-over and subtitles", exact: true })
		.click();
	await page.getByRole("combobox", { name: "Narration task", exact: true }).selectOption("story");
}
const brief = async (page: Page) => {
	await page.getByLabel("Topic / product", { exact: true }).fill("Introduce JSOX Recorder");
	await page.getByLabel("Audience", { exact: true }).fill("First-time customers");
	await page
		.getByLabel("Verified features and selling points", { exact: true })
		.fill("Record and edit offline.");
	await page
		.getByLabel("What should viewers do at the end?", { exact: true })
		.fill("Try a short recording");
};
test("a brief-only story becomes editable titles, text subtitles and real audio timeline clips, then saves and reopens", async ({
	page,
}) => {
	await setup(page);
	const draft = page.getByRole("button", { name: "Draft video story", exact: true });
	await expect(draft).toBeDisabled();
	await expect(page.locator("[data-story-brief]")).toContainText(
		"qwen3:4b only understands text",
	);
	await page.getByLabel("Analyze sampled video frames", { exact: true }).uncheck();
	await draft.click();
	await expect(
		page.getByText(
			"Enter a creative request or topic first. Product facts and scene notes can be added below.",
			{ exact: true },
		),
	).toBeVisible();
	await brief(page);
	await draft.click();
	await expect(page.getByLabel("story-1", { exact: true })).toHaveValue(
		"Show your product clearly.",
	);
	const sent = JSON.parse((await page.locator("html").getAttribute("data-story-request"))!);
	expect(sent.request.brief).toMatchObject({
		topic: "Introduce JSOX Recorder",
		audience: "First-time customers",
		ending: "Try a short recording",
		analyzeVideo: false,
	});
	expect(sent.request.scenes).toEqual([
		{ id: "story-1", startMs: 0, endMs: 6000, sourceTimeMs: 3000 },
	]);
	await page.getByLabel("story-1", { exact: true }).fill("Make your product story clear.");
	await page.getByLabel("title-story-1", { exact: true }).fill("Your product, clearly");
	await page.screenshot({ path: "/tmp/recordly-video-story.png", animations: "disabled" });
	await page
		.getByRole("checkbox", {
			name: "I've reviewed these lines; approve for narration",
			exact: true,
		})
		.check();
	await page.getByRole("button", { name: "Add scene titles to timeline", exact: true }).click();
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(1);
	await page
		.getByRole("button", { name: "Add narration as text subtitles", exact: true })
		.click();
	await page.getByRole("button", { name: "Generate narration audio", exact: true }).click();
	await expect(page.locator('[data-variant="audio"]')).toHaveCount(1);
	await page.evaluate(() => window.dispatchEvent(new Event("save-story")));
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(sessionStorage.getItem("story-project") ?? "{}").editor?.audioRegions
						?.length,
			),
		)
		.toBe(1);
	const editor = await page.evaluate(
		() => JSON.parse(sessionStorage.getItem("story-project")!).editor,
	);
	expect(editor.annotationRegions[0]).toMatchObject({
		content: "Your product, clearly",
		startMs: 0,
		endMs: 6000,
	});
	expect(editor.autoCaptions.map((c: { text: string }) => c.text).join(" ")).toContain(
		"Make your product story clear.",
	);
	await page.reload();
	await expect(page.locator('[data-variant="audio"]')).toHaveCount(1);
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(1);
});
test("vision model sends explicit frame-analysis intent, cancellation rejects late story output", async ({
	page,
}) => {
	await setup(page, true, true);
	await brief(page);
	await page.getByRole("button", { name: "Draft video story", exact: true }).click();
	await expect(page.locator("[data-task-wait]")).toBeVisible();
	const sent = JSON.parse((await page.locator("html").getAttribute("data-story-request"))!);
	expect(sent.request.brief.analyzeVideo).toBe(true);
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.evaluate(() => window.dispatchEvent(new Event("finish-story")));
	await expect(page.getByLabel("story-1", { exact: true })).toHaveCount(0);
	await expect(page.locator('[data-variant="audio"]')).toHaveCount(0);
});

test("changed briefs and invalid scene timing cannot add stale story audio or text", async ({
	page,
}) => {
	await setup(page);
	await page.getByLabel("Analyze sampled video frames", { exact: true }).uncheck();
	await brief(page);
	await page.getByRole("button", { name: "Draft video story", exact: true }).click();
	await expect(page.getByLabel("story-1", { exact: true })).toHaveValue(
		"Show your product clearly.",
	);
	await page
		.getByRole("checkbox", {
			name: "I've reviewed these lines; approve for narration",
			exact: true,
		})
		.check();
	await page
		.getByLabel("Topic / product", { exact: true })
		.fill("A completely different product");
	await page.getByRole("button", { name: "Add scene titles to timeline", exact: true }).click();
	await expect(
		page.getByText("The brief changed. Draft the story again before adding audio or text.", {
			exact: true,
		}),
	).toBeVisible();
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(0);
	await page.getByLabel("Topic / product", { exact: true }).fill("Introduce JSOX Recorder");
	await page.getByLabel("End (seconds) story-1", { exact: true }).fill("99");
	await page
		.getByRole("checkbox", {
			name: "I've reviewed these lines; approve for narration",
			exact: true,
		})
		.check();
	await page.getByRole("button", { name: "Generate narration audio", exact: true }).click();
	await expect(
		page.getByText(
			"Operation failed; timeline unchanged. Story times must stay inside a video clip and cannot overlap. Adjust them or draft again.",
			{ exact: true },
		),
	).toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-story-tts");
});

test("unfinished story workspace survives reopening with review required and can then generate English audio", async ({
	page,
}) => {
	await setup(page);
	await page.getByLabel("Analyze sampled video frames", { exact: true }).uncheck();
	await brief(page);
	await page.getByRole("button", { name: "Draft video story", exact: true }).click();
	await page.getByLabel("story-1", { exact: true }).fill("Keep my unfinished story.");
	await page.getByLabel("title-story-1", { exact: true }).fill("Saved heading");
	await page.getByLabel("Start (seconds) story-1", { exact: true }).fill("1");
	await page
		.getByRole("checkbox", {
			name: "I've reviewed these lines; approve for narration",
			exact: true,
		})
		.check();
	await page.evaluate(() => window.dispatchEvent(new Event("save-story")));
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(sessionStorage.getItem("story-project") ?? "{}").editor
						?.storyWorkspace?.edits?.["story-1"],
			),
		)
		.toBe("Keep my unfinished story.");
	await page.reload();
	await expect(page.getByLabel("Topic / product", { exact: true })).toHaveValue(
		"Introduce JSOX Recorder",
	);
	await expect(page.getByLabel("story-1", { exact: true })).toHaveValue(
		"Keep my unfinished story.",
	);
	await expect(page.getByLabel("title-story-1", { exact: true })).toHaveValue("Saved heading");
	await expect(page.getByLabel("Start (seconds) story-1", { exact: true })).toHaveValue("1");
	const approve = page.getByRole("checkbox", {
		name: "I've reviewed these lines; approve for narration",
		exact: true,
	});
	await expect(approve).not.toBeChecked();
	await expect(
		page.getByRole("button", { name: "Generate narration audio", exact: true }),
	).toBeDisabled();
	await approve.check();
	await page.getByRole("button", { name: "Generate narration audio", exact: true }).click();
	await expect(page.locator('[data-variant="audio"]')).toHaveCount(1);
	await expect(page.locator("html")).toHaveAttribute(
		"data-story-tts",
		JSON.stringify({
			cues: [{ id: "story-1", text: "Keep my unfinished story." }],
			language: "en",
		}),
	);

	await page.getByRole("button", { name: "Check or change Ollama model", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Check local model", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Check local model", exact: true }).click();
	await page
		.getByRole("button", { name: "Add AI voice-over and subtitles", exact: true })
		.click();
	await expect(page.getByLabel("story-1", { exact: true })).toHaveValue(
		"Keep my unfinished story.",
	);
	await expect(
		page.getByRole("button", { name: "Draft video story", exact: true }),
	).toBeEnabled();
});

test("repairing scene fit reuses prepared audio and changing one line regenerates only that line", async ({
	page,
}) => {
	await setup(page, false, false, { repeat: true });
	await page.getByLabel("Analyze sampled video frames", { exact: true }).uncheck();
	await brief(page);
	await page.getByRole("button", { name: "Draft video story", exact: true }).click();
	await page.getByLabel("End (seconds) story-1", { exact: true }).fill("0.5");
	const approve = page.getByRole("checkbox", {
		name: "I've reviewed these lines; approve for narration",
		exact: true,
	});
	await approve.check();
	await page.getByRole("button", { name: "Generate narration audio", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("The voice is longer than its scene");
	await expect(page.locator('[data-variant="audio"]')).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-story-tts-count", "1");
	await page.getByLabel("End (seconds) story-1", { exact: true }).fill("2");
	await approve.check();
	await page.getByRole("button", { name: "Generate narration audio", exact: true }).click();
	await expect(page.locator('[data-variant="audio"]')).toHaveCount(3);
	await expect(page.locator("html")).toHaveAttribute("data-story-tts-count", "1");
	await page.getByLabel("story-2", { exact: true }).fill("Only this second line changed.");
	await expect(
		page.getByText(/The timeline still contains earlier narration audio/),
	).toBeVisible();
	await approve.check();
	await page.getByRole("button", { name: "Generate narration audio", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-story-tts-count", "2");
	const sent = JSON.parse((await page.locator("html").getAttribute("data-story-tts"))!);
	expect(sent.cues).toEqual([{ id: "story-2", text: "Only this second line changed." }]);
});

test("original subtitle context is opt-in, mapped to the timeline and disclosed", async ({
	page,
}) => {
	await setup(page, false, false, { originalCaptions: true });
	await page.getByLabel("Analyze sampled video frames", { exact: true }).uncheck();
	await brief(page);
	const consent = page.getByLabel("Use existing speech subtitles as story context", {
		exact: true,
	});
	await expect(consent).not.toBeChecked();
	await page.getByRole("button", { name: "Draft video story", exact: true }).click();
	let sent = JSON.parse((await page.locator("html").getAttribute("data-story-request"))!);
	expect(sent.request.transcript).toBeUndefined();
	await consent.check();
	await expect(
		page.getByText("Subtitle context included: 1/1; omitted: 0.", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Draft video story", exact: true }).click();
	await expect
		.poll(
			async () =>
				JSON.parse((await page.locator("html").getAttribute("data-story-request"))!).request
					.transcript,
		)
		.toEqual([{ startMs: 1000, endMs: 2000, text: "The product works offline." }]);
	await page
		.getByRole("button", { name: "Create or review original subtitles", exact: true })
		.click();
	await expect(page.getByRole("radio", { name: "Captions", exact: true })).toBeChecked();
});

test("central preview shows only the story line bound to each repeated footage occurrence", async ({
	page,
}) => {
	await setup(page, false, false, { repeat: true });
	await page.getByLabel("Analyze sampled video frames", { exact: true }).uncheck();
	await brief(page);
	await page.getByRole("button", { name: "Draft video story", exact: true }).click();
	await page.getByLabel("story-1", { exact: true }).fill("First product scene.");
	await page.getByLabel("story-2", { exact: true }).fill("Second product scene.");
	await page.getByLabel("story-3", { exact: true }).fill("Final product scene.");
	await page
		.getByRole("checkbox", {
			name: "I've reviewed these lines; approve for narration",
			exact: true,
		})
		.check();
	await page
		.getByRole("button", { name: "Add narration as text subtitles", exact: true })
		.click();
	const caption = page.getByRole("button", { name: "Edit current caption", exact: true });
	await expect(caption).toContainText("First product scene.");
	await page.getByRole("button", { name: "6.0 s", exact: true }).click();
	await expect(caption).toContainText("Second product scene.");
	await expect(caption).not.toContainText("First product scene.");
	await page.getByRole("button", { name: "12.0 s", exact: true }).click();
	await expect(caption).toContainText("Final product scene.");
	await expect(caption).not.toContainText("Second product scene.");
});

test("CPU flow recognizes original speech, drafts a topic-only story, saves evidence and opens the existing export menu", async ({
	page,
}) => {
	await setup(page, false, false, { speech: "ok" });
	await page.getByRole("button", { name: "Use lightweight CPU settings", exact: true }).click();
	await expect(
		page.getByLabel("Analyze sampled video frames", { exact: true }),
	).not.toBeChecked();
	await page
		.getByLabel("Topic / product", { exact: true })
		.fill("Introduce my product for first-time customers.");
	await page.getByLabel("Narration target (seconds, optional)", { exact: true }).fill("30");
	await page
		.getByRole("combobox", { name: "Original speech language", exact: true })
		.selectOption("en");
	await page
		.getByRole("button", { name: "Analyze original audio and draft story", exact: true })
		.click();
	await expect(page.getByLabel("story-1", { exact: true })).toHaveValue(
		"Show your product clearly.",
	);
	const sent = JSON.parse((await page.locator("html").getAttribute("data-story-request"))!);
	expect(sent.request.brief).toMatchObject({
		autoTranscribe: true,
		includeTranscript: true,
		analyzeVideo: false,
		targetSpeechSeconds: 30,
	});
	expect(sent.request.transcript).toEqual([
		{ startMs: 1000, endMs: 2000, text: "This editor works offline." },
	]);
	await expect(page.locator("html")).toHaveAttribute("data-speech-calls", "1");
	await page
		.getByRole("button", { name: "Analyze original audio and draft story", exact: true })
		.click();
	await expect(page.getByLabel("story-1", { exact: true })).toHaveValue(
		"Show your product clearly.",
	);
	await expect(page.locator("html")).toHaveAttribute("data-speech-calls", "1");
	await page
		.getByRole("checkbox", {
			name: "I've reviewed these lines; approve for narration",
			exact: true,
		})
		.check();
	await page.getByRole("button", { name: "Generate narration audio", exact: true }).click();
	await expect(page.locator('[data-variant="audio"]')).toHaveCount(1);
	await page.evaluate(() => window.dispatchEvent(new Event("save-story")));
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(sessionStorage.getItem("story-project") ?? "{}").editor
						?.storyWorkspace?.sourceSpeech?.cues?.length,
			),
		)
		.toBe(1);
	const saved = await page.evaluate(
		() => JSON.parse(sessionStorage.getItem("story-project")!).editor,
	);
	expect(saved.autoCaptions.every((c: { id: string }) => c.id.startsWith("narration-"))).toBe(
		true,
	);
	await page.getByRole("button", { name: "Export this video", exact: true }).click();
	await expect(page.locator('[aria-label="Publish"]').first()).toBeVisible();
});

test("turning off speech context skips recognition after choosing CPU settings", async ({
	page,
}) => {
	await setup(page, false, false, { speech: "ok" });
	await page.getByRole("button", { name: "Use lightweight CPU settings", exact: true }).click();
	await page
		.getByLabel("Use existing speech subtitles as story context", { exact: true })
		.uncheck();
	await page.getByLabel("Topic / product", { exact: true }).fill("Introduce my product.");
	await page.getByRole("button", { name: "Draft video story", exact: true }).click();
	await expect(page.getByLabel("story-1", { exact: true })).toHaveValue(
		"Show your product clearly.",
	);
	const sent = JSON.parse((await page.locator("html").getAttribute("data-story-request"))!);
	expect(sent.request.brief).toMatchObject({ autoTranscribe: false, includeTranscript: false });
	expect(sent.request.transcript).toBeUndefined();
	await expect(page.locator("html")).not.toHaveAttribute("data-speech-calls");
});

test("canceling original-audio recognition cannot start story inference or apply a late transcript", async ({
	page,
}) => {
	await setup(page, false, false, { speech: "deferred" });
	await page.getByRole("button", { name: "Use lightweight CPU settings", exact: true }).click();
	await brief(page);
	await page
		.getByRole("button", { name: "Analyze original audio and draft story", exact: true })
		.click();
	await expect(page.locator("html")).toHaveAttribute("data-speech-calls", "1");
	await expect(page.getByText("Recognizing original speech", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-speech-canceled", "true");
	await page.evaluate(() => window.dispatchEvent(new Event("finish-speech")));
	await expect(page.locator("html")).not.toHaveAttribute("data-story-request");
	await expect(page.getByLabel("story-1", { exact: true })).toHaveCount(0);
	await page.evaluate(() => window.dispatchEvent(new Event("save-story")));
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(sessionStorage.getItem("story-project") ?? "{}").editor
						?.storyWorkspace?.sourceSpeech,
			),
		)
		.toBeNull();
});

for (const speech of ["no-audio", "missing-model"] as const)
	test(`${speech} offers a usable brief-only path without overwriting source subtitles`, async ({
		page,
	}) => {
		await setup(page, false, false, { speech });
		await page
			.getByRole("button", { name: "Use lightweight CPU settings", exact: true })
			.click();
		await brief(page);
		await page
			.getByRole("button", { name: "Analyze original audio and draft story", exact: true })
			.click();
		await expect(page.getByRole("alert")).toContainText(
			speech === "no-audio" ? "No original audio" : "speech model is missing",
		);
		await expect(page.locator("html")).not.toHaveAttribute("data-story-request");
		await page
			.getByRole("button", { name: "Continue with brief / frames only", exact: true })
			.click();
		await page.getByRole("button", { name: "Draft video story", exact: true }).click();
		await expect(page.getByLabel("story-1", { exact: true })).toHaveValue(
			"Show your product clearly.",
		);
	});
