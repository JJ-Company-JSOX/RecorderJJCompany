import { describe, expect, it } from "vitest";
import {
	MAX_TEXT_LENGTH,
	redactText,
	reviewReady,
	scanSensitiveText,
	videoFileError,
	videoMetadataValid,
} from "./preflight";

describe("local sensitive text preflight", () => {
	it("finds SG/MY identifiers and phone formats in mixed-language synthetic text", () => {
		const input =
			"请联络 alex@example.com, telefon +60 12-345 6789, SG +65 8123 4567. NRIC S1234567D, IC 900101-14-5678. 中国13812345678";
		const result = scanSensitiveText(input);
		expect(result.complete).toBe(true);
		expect(new Set(result.findings.map((item) => item.kind))).toEqual(
			new Set(["email", "phone", "sg-id", "my-id"]),
		);
		for (const value of [
			"alex@example.com",
			"+60 12-345 6789",
			"+65 8123 4567",
			"S1234567D",
			"900101-14-5678",
			"13812345678",
		]) {
			expect(
				result.findings.some((item) => input.slice(item.start, item.end) === value),
			).toBe(true);
		}
	});
	it("detects provider keys, bearer tokens, generic secrets and private key headers", () => {
		const input = `AKIA${"A".repeat(16)} ghp_${"a".repeat(30)} Bearer abcdefgh.12345678 api_key='abcdef123456' -----BEGIN PRIVATE KEY-----`;
		expect(
			scanSensitiveText(input).findings.filter((item) => item.kind === "secret"),
		).toHaveLength(5);
	});
	it("normalizes full-width ASCII without changing match offsets", () => {
		const input = "电话：＋６５ ８１２３ ４５６７";
		const result = scanSensitiveText(input);
		expect(input.slice(result.findings[0].start, result.findings[0].end)).toBe(
			"＋６５ ８１２３ ４５６７",
		);
	});
	it("redacts overlapping matches and keeps surrounding multilingual text", () => {
		const input = "你好 token=alex@example.com tamat";
		const result = scanSensitiveText(input);
		expect(result.findings).toHaveLength(2);
		expect(redactText(input, result.findings)).toBe("你好 [REDACTED] tamat");
	});
	it("does not place raw values or snippets in scan results", () => {
		const result = scanSensitiveText("Contact alex@example.com");
		expect(JSON.stringify(result)).not.toContain("alex");
		expect(Object.keys(result.findings[0]).sort()).toEqual(["end", "id", "kind", "start"]);
	});
	it("fails closed for excess input or candidate counts", () => {
		expect(scanSensitiveText("a".repeat(MAX_TEXT_LENGTH + 1)).complete).toBe(false);
		const result = scanSensitiveText("a@example.com ".repeat(101));
		expect(result.complete).toBe(false);
		expect(result.findings).toHaveLength(100);
	});
	it("can be called repeatedly without leaking regex cursor state", () => {
		expect(scanSensitiveText("alex@example.com")).toEqual(
			scanSensitiveText("alex@example.com"),
		);
		expect(scanSensitiveText("Click Save / 点击保存 / Klik Simpan").findings).toHaveLength(0);
	});
	it("requires metadata, a complete inspection, each decision and every disclosure", () => {
		const scan = scanSensitiveText("alex@example.com");
		const valid = {
			mediaValid: true,
			scan,
			reviewed: new Set(scan.findings.map((item) => item.id)),
			visualReviewed: true,
			googleConsent: true,
			geminiConsent: true,
		};
		expect(reviewReady(valid)).toBe(true);
		for (const flag of [
			"mediaValid",
			"visualReviewed",
			"googleConsent",
			"geminiConsent",
		] as const) {
			expect(reviewReady({ ...valid, [flag]: false })).toBe(false);
		}
		expect(reviewReady({ ...valid, reviewed: new Set() })).toBe(false);
		expect(reviewReady({ ...valid, scan: null })).toBe(false);
		expect(reviewReady({ ...valid, scan: { ...scan, complete: false } })).toBe(false);
	});
	it("checks nonempty files, extensions and size without reading video binary as text", () => {
		expect(videoFileError({ name: "demo.mp4", size: 100 })).toBeNull();
		expect(videoFileError({ name: "demo.exe", size: 100 })).toBe("type");
		expect(videoFileError({ name: "demo.MOV", size: 0 })).toBe("size");
		expect(videoFileError({ name: "demo.webm", size: 500 * 1024 * 1024 + 1 })).toBe("size");
	});
	it("rejects undecodable, over-duration and over-resolution metadata including portrait", () => {
		expect(videoMetadataValid(600, 3840, 2160)).toBe(true);
		expect(videoMetadataValid(5, 2160, 3840)).toBe(true);
		for (const [duration, width, height] of [
			[NaN, 100, 100],
			[Infinity, 100, 100],
			[0, 100, 100],
			[601, 100, 100],
			[5, 3840, 3840],
			[5, 0, 100],
		]) {
			expect(videoMetadataValid(duration, width, height)).toBe(false);
		}
	});
});
