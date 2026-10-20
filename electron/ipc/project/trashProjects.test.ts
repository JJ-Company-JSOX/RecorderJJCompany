import { expect, it, vi } from "vitest";
import path from "node:path";
import { trashLibraryProjects } from "./trashProjects";
it("rejects paths outside the project library before touching files", async () => {
	const trash = vi.fn();
	await expect(
		trashLibraryProjects(["/private/tmp/a.recordly", "/private/tmp/private.txt"], {
			list: async () => ({ entries: [{ path: "/private/tmp/a.recordly" }] }),
			trash,
			thumbnailPath: (p) => p + ".png",
		}),
	).rejects.toThrow("not in the library");
	expect(trash).not.toHaveBeenCalled();
});
it("trashes only selected project files, deduplicates paths, and reports partial failures", async () => {
	const first = path.resolve("/private/tmp/a.recordly");
	const second = path.resolve("/private/tmp/b.recordly");
	const trash = vi.fn(async (p: string) => {
		if (p.endsWith("b.recordly")) throw Error("locked");
	});
	const result = await trashLibraryProjects([first, first, second], {
		list: async () => ({
			entries: [{ path: first }, { path: second }],
		}),
		trash,
		thumbnailPath: (p) => p + ".missing.png",
	});
	expect(result.deleted).toEqual([first]);
	expect(result.errors).toEqual(["Could not trash b.recordly"]);
	expect(trash.mock.calls.map(([p]) => p)).toEqual([first, second]);
});
