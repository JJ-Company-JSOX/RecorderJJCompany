import fs from "node:fs/promises";
import path from "node:path";

/** Where Recordly keeps the Postiz address and the API key, encrypted by the OS. */
export type Encryption = {
	isEncryptionAvailable(): boolean;
	encryptString(text: string): Buffer;
	decryptString(data: Buffer): string;
};

type Stored = { baseUrl?: unknown; apiKey?: unknown };

export class SocialConfigStore {
	constructor(
		private readonly file: string,
		private readonly encryption: Encryption,
	) {}

	private async read(): Promise<Stored> {
		try {
			const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	}

	/** What the renderer may see: never the key itself. */
	async summary() {
		const stored = await this.read();
		return {
			baseUrl: typeof stored.baseUrl === "string" ? stored.baseUrl : null,
			hasKey: typeof stored.apiKey === "string",
		};
	}

	async credentials() {
		const stored = await this.read();
		if (typeof stored.baseUrl !== "string" || typeof stored.apiKey !== "string") return null;
		try {
			return {
				baseUrl: stored.baseUrl,
				apiKey: this.encryption.decryptString(Buffer.from(stored.apiKey, "base64")),
			};
		} catch {
			// A key encrypted under another Windows user cannot be read: ask for it again.
			return null;
		}
	}

	async save(baseUrl: string, apiKey: string) {
		if (!this.encryption.isEncryptionAvailable())
			throw new Error("This computer cannot store the API key securely.");
		await fs.mkdir(path.dirname(this.file), { recursive: true });
		const temporary = `${this.file}.tmp`;
		await fs.writeFile(
			temporary,
			JSON.stringify({
				baseUrl,
				apiKey: this.encryption.encryptString(apiKey).toString("base64"),
			}),
			{ mode: 0o600 },
		);
		await fs.rename(temporary, this.file);
	}

	async clear() {
		await fs.rm(this.file, { force: true });
	}
}
