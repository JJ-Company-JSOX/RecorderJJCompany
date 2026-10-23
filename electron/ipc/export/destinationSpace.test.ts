import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureExportDestinationSpace } from "./destinationSpace";

afterEach(() => vi.restoreAllMocks());
describe("export destination space", () => {
	it("checks an existing ancestor for a new output directory", async () => {
		const destination = path.join(
			os.tmpdir(),
			`jsox-not-created-${Date.now()}`,
			"nested",
			"export.mp4",
		);
		await expect(ensureExportDestinationSpace(destination, 1024)).resolves.toBeUndefined();
		await expect(fs.access(path.dirname(destination))).rejects.toThrow();
	});
	it("rejects a full volume before writing anything", async () => {
		vi.spyOn(fs, "statfs").mockResolvedValue({ bavail: 1n, bsize: 4096n } as never);
		await expect(
			ensureExportDestinationSpace(path.join(os.tmpdir(), "export.mp4"), 10000),
		).rejects.toThrow("Not enough disk space");
	});
	it("uses available blocks rather than privileged free blocks", async () => {
		vi.spyOn(fs, "statfs").mockResolvedValue({
			bfree: 1000000n,
			bavail: 0n,
			bsize: 4096n,
		} as never);
		await expect(
			ensureExportDestinationSpace(path.join(os.tmpdir(), "export.mp4"), 100),
		).rejects.toThrow("available: 0 MiB");
	});
	it("rejects invalid lengths and preserves permission failures", async () => {
		await expect(ensureExportDestinationSpace("video.mp4", NaN)).rejects.toThrow(
			"Invalid export size",
		);
		vi.spyOn(fs, "access").mockRejectedValue(
			Object.assign(new Error("denied"), { code: "EACCES" }),
		);
		await expect(ensureExportDestinationSpace("video.mp4", 10)).rejects.toThrow("denied");
	});
});
