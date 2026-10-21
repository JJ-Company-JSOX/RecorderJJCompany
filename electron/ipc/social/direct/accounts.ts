import fs from "node:fs/promises";
import path from "node:path";
import { isPlatform, type Platform } from "../publish";

/** Electron's safeStorage: encryption tied to the signed-in Windows user. */
export type Encryption = {
	isEncryptionAvailable(): boolean;
	encryptString(text: string): Buffer;
	decryptString(data: Buffer): string;
};

/** A social account the customer connected straight to Recordly. */
export type DirectAccount = {
	platform: Platform;
	id: string;
	name: string;
	/** e.g. the Google email, or the Facebook page's category. */
	detail?: string;
	picture?: string;
};
type Stored = DirectAccount & { token: string };

/** Keeps connected accounts in userData; each account's credential is encrypted by the OS. */
export class DirectAccountStore {
	constructor(
		private readonly file: string,
		private readonly encryption: Encryption,
	) {}

	private async read(): Promise<Stored[]> {
		try {
			const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
			return Array.isArray(parsed)
				? parsed.filter(
						(a) =>
							isPlatform(a?.platform) &&
							typeof a.id === "string" &&
							typeof a.name === "string" &&
							typeof a.token === "string",
					)
				: [];
		} catch {
			return [];
		}
	}

	private async write(accounts: Stored[]) {
		await fs.mkdir(path.dirname(this.file), { recursive: true });
		const temporary = `${this.file}.tmp`;
		await fs.writeFile(temporary, JSON.stringify(accounts), { mode: 0o600 });
		await fs.rename(temporary, this.file);
	}

	/** What the page may see: never a credential. */
	async list(): Promise<DirectAccount[]> {
		return (await this.read()).map(({ token: _token, ...account }) => account);
	}

	/** Adds or replaces accounts (one sign-in can return several, e.g. Facebook pages). */
	async save(entries: Array<{ account: DirectAccount; credential: string }>) {
		if (!this.encryption.isEncryptionAvailable())
			throw new Error("This computer cannot store the sign-in securely.");
		const key = (a: DirectAccount) => `${a.platform}:${a.id}`;
		const replaced = new Set(entries.map((e) => key(e.account)));
		const kept = (await this.read()).filter((a) => !replaced.has(key(a)));
		const added = entries.map(({ account, credential }) => ({
			...account,
			token: this.encryption.encryptString(credential).toString("base64"),
		}));
		await this.write([...kept, ...added]);
	}

	async credential(platform: Platform, id: string) {
		const found = (await this.read()).find((a) => a.platform === platform && a.id === id);
		if (!found) return null;
		try {
			return this.encryption.decryptString(Buffer.from(found.token, "base64"));
		} catch {
			return null;
		}
	}

	async remove(platform: Platform, id: string) {
		await this.write(
			(await this.read()).filter((a) => !(a.platform === platform && a.id === id)),
		);
	}
}
