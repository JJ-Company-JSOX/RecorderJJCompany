// Pure local text inspection. Never send these inputs or matches to a provider/log.
export const MAX_TEXT_LENGTH = 50_000;
export const MAX_FINDINGS = 100;
export type SensitiveKind = "email" | "phone" | "sg-id" | "my-id" | "secret";
export interface Finding {
	id: string;
	kind: SensitiveKind;
	start: number;
	end: number;
}
export interface ScanResult {
	findings: Finding[];
	complete: boolean;
}

// Format candidates, not checksum/identity validation. Bounded patterns avoid
// pathological backtracking on pasted documents. Full-width ASCII is one-to-one.
const rules: [SensitiveKind, RegExp][] = [
	["email", /(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,5}(?![\w.-])/g],
	["sg-id", /(?<![A-Za-z0-9])[STFGM]\d{7}[A-Z](?![A-Za-z0-9])/gi],
	["my-id", /(?<!\d)\d{6}[- ]?\d{2}[- ]?\d{4}(?!\d)/g],
	["phone", /(?<![\w\d])(?:\+?65[ -]?)?[689]\d{3}[ -]?\d{4}(?!\d)/g],
	["phone", /(?<![\w\d])(?:\+?60[ -]?|0)1\d[ -]?\d{3,4}[ -]?\d{4}(?!\d)/g],
	["phone", /(?<![\w\d])(?:\+?86[ -]?)?1[3-9]\d{9}(?!\d)/g],
	["secret", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
	[
		"secret",
		/\b(?:AIza[\w-]{35}|gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|sk-[A-Za-z0-9_-]{16,255})\b/g,
	],
	["secret", /\bBearer[ \t]+[A-Za-z0-9._~+/-]{8,512}={0,2}/gi],
	[
		"secret",
		/\b(?:api[_ -]?key|secret|token|password)[ \t]{0,8}[:=][ \t]{0,8}["']?[^\s"',;]{6,256}/gi,
	],
	["secret", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

export function scanSensitiveText(input: string): ScanResult {
	if (input.length > MAX_TEXT_LENGTH) return { findings: [], complete: false };
	const normalized = input.replace(/[！-～]/g, (char) =>
		String.fromCharCode(char.charCodeAt(0) - 0xfee0),
	);
	const findings: Finding[] = [];
	for (const [kind, pattern] of rules) {
		pattern.lastIndex = 0;
		for (const match of normalized.matchAll(pattern)) {
			const start = match.index!,
				end = start + match[0].length;
			// Overlapping classes remain visible, but identical matches aren't duplicated.
			const id = `${kind}:${start}:${end}`;
			if (findings.some((item) => item.id === id)) continue;
			if (findings.length === MAX_FINDINGS) return { findings, complete: false };
			findings.push({ id, kind, start, end });
		}
	}
	return {
		findings: findings.sort((a, b) => a.start - b.start || b.end - a.end),
		complete: true,
	};
}

export function redactText(input: string, findings: Finding[]): string {
	let cursor = 0,
		result = "";
	for (const item of [...findings].sort((a, b) => a.start - b.start)) {
		if (item.end <= cursor) continue;
		result += input.slice(cursor, Math.max(cursor, item.start)) + "[REDACTED]";
		cursor = item.end;
	}
	return result + input.slice(cursor);
}

export function videoFileError(file: Pick<File, "name" | "size">): "type" | "size" | null {
	if (!/\.(mp4|mov|webm)$/i.test(file.name)) return "type";
	if (file.size <= 0 || file.size > 500 * 1024 * 1024) return "size";
	return null;
}

export function videoMetadataValid(duration: number, width: number, height: number): boolean {
	return (
		Number.isFinite(duration) &&
		duration > 0 &&
		duration <= 600 &&
		Number.isInteger(width) &&
		Number.isInteger(height) &&
		width > 0 &&
		height > 0 &&
		Math.max(width, height) <= 3840 &&
		Math.min(width, height) <= 2160
	);
}

export function reviewReady(input: {
	mediaValid: boolean;
	scan: ScanResult | null;
	reviewed: ReadonlySet<string>;
	visualReviewed: boolean;
	googleConsent: boolean;
	geminiConsent: boolean;
}): boolean {
	return (
		input.mediaValid &&
		input.scan?.complete === true &&
		input.scan.findings.every((finding) => input.reviewed.has(finding.id)) &&
		input.visualReviewed &&
		input.googleConsent &&
		input.geminiConsent
	);
}
