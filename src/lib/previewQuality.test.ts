import { describe, expect, it } from "vitest";
import { getPreviewResolution } from "./previewQuality";

describe("preview resolution budget", () => {
	it("caps high DPI preview work while retaining CSS geometry", () => {
		expect(getPreviewResolution(900, 500, 2, "balanced")).toBe(1);
		expect(getPreviewResolution(2560, 1440, 2, "balanced")).toBe(0.5);
	});
	it("allows full display density and handles invalid density", () => {
		expect(getPreviewResolution(900, 500, 2, "full")).toBe(2);
		expect(getPreviewResolution(0, 0, Number.NaN, "balanced")).toBe(1);
	});
});
