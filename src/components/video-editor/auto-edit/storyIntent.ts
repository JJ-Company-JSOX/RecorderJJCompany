import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { emptyStoryWorkspace, type StoryWorkspace } from "./storyWorkspace";

const SETTING = "recordly.story.nextIntent.v1";
const MAX_AGE_MS = 30 * 60 * 1000;
export interface StoryIntent {
	version: 1;
	id: string;
	prompt: string;
	createdAt: number;
	sourcePath?: string;
}
const sourceKey = (value: string) => {
	const normalized = value.replace(/\\/g, "/");
	return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
		? normalized.toLowerCase()
		: normalized;
};
function currentIntent(
	now: number,
	raw = loadAppSetting<Partial<StoryIntent>>(SETTING),
): StoryIntent | null {
	if (
		!raw ||
		raw.version !== 1 ||
		typeof raw.id !== "string" ||
		!raw.id ||
		raw.id.length > 100 ||
		typeof raw.prompt !== "string" ||
		!raw.prompt.trim() ||
		raw.prompt.length > 2000 ||
		typeof raw.createdAt !== "number" ||
		!Number.isFinite(raw.createdAt) ||
		raw.createdAt > now ||
		now - raw.createdAt > MAX_AGE_MS ||
		(raw.sourcePath !== undefined &&
			(typeof raw.sourcePath !== "string" || raw.sourcePath.length > 4096))
	)
		return null;
	return raw as StoryIntent;
}
/** Called only after actual recording activation, or a successful media import. No AI work. */
export function stageStoryIntent(
	prompt: string,
	sourcePath?: string,
	now = Date.now(),
): string | null {
	const text = prompt.trim().slice(0, 2000);
	if (!text) {
		saveAppSetting(SETTING, null);
		return null;
	}
	const id = crypto.randomUUID();
	const value: StoryIntent = {
		version: 1,
		id,
		prompt: text,
		createdAt: now,
		...(sourcePath ? { sourcePath } : {}),
	};
	return saveAppSetting(SETTING, value) ? id : null;
}
/**
 * A recording's request is staged when it starts; while it runs and when it stops, its age
 * is restarted so a long recording does not let the brief expire before the editor opens.
 */
export function refreshStoryIntent(id: string | null, now = Date.now()) {
	if (!id) return;
	const raw = loadAppSetting<Partial<StoryIntent>>(SETTING);
	if (raw?.id === id && currentIntent(now, { ...raw, createdAt: now } as StoryIntent))
		saveAppSetting(SETTING, { ...raw, createdAt: now });
}
/** A canceled recording can discard only its own request, not a newer import request. */
export function discardStoryIntent(id: string | null) {
	if (id && loadAppSetting<Partial<StoryIntent>>(SETTING)?.id === id)
		saveAppSetting(SETTING, null);
}
/** New media only. Saved-project loading must use the workspace saved in that project. */
export function consumeStoryIntent(sourcePath: string, now = Date.now()): StoryWorkspace | null {
	const intent = currentIntent(now);
	if (!intent) return null;
	if (intent.sourcePath && sourceKey(intent.sourcePath) !== sourceKey(sourcePath)) return null;
	// Clear before returning so another editor hydration cannot claim the same request.
	if (!saveAppSetting(SETTING, null)) return null;
	return {
		...emptyStoryWorkspace(),
		storyMode: true,
		brief: { ...emptyStoryWorkspace().brief, topic: intent.prompt },
	};
}
