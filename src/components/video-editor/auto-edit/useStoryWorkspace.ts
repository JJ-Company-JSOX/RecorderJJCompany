import { type Dispatch, type SetStateAction, useState } from "react";
import { emptyStoryWorkspace, type StoryWorkspace } from "./storyWorkspace";

/** Keep draft edits in the same state that project saving/history reads. */
export function useStoryWorkspace(
	workspace: StoryWorkspace | null | undefined,
	onChange?: Dispatch<SetStateAction<StoryWorkspace | null>>,
) {
	const [local, setLocal] = useState<StoryWorkspace | null>(emptyStoryWorkspace);
	const value = (onChange ? workspace : local) ?? emptyStoryWorkspace();
	const update = onChange ?? setLocal;
	return <K extends keyof StoryWorkspace>(
		key: K,
	): [StoryWorkspace[K], Dispatch<SetStateAction<StoryWorkspace[K]>>] => [
		value[key],
		(next) =>
			update((previous) => {
				const before = previous ?? emptyStoryWorkspace();
				return {
					...before,
					[key]:
						typeof next === "function"
							? (next as (value: StoryWorkspace[K]) => StoryWorkspace[K])(before[key])
							: next,
				};
			}),
	];
}
