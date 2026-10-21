import fs from "node:fs/promises";
import path from "node:path";
import type { Encryption } from "../config";

/** A social account the customer connected straight to Recordly (no Postiz server). */
export type DirectAccount = {
	platform: "youtube";
	id: string;
	name: string;
	email?: string;
	picture?: string;
};
type Stored = DirectAccount & { token: string };

/** Keeps connected accounts in userData; each refresh token is encrypted by the OS. */
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
							a?.platform === "youtube" &&
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

	/** What the page may see: never a token. */
	async list(): Promise<DirectAccount[]> {
		return (await this.read()).map(({ token: _token, ...account }) => account);
	}

	async add(account: DirectAccount, refreshToken: string) {
		if (!this.encryption.isEncryptionAvailable())
			throw new Error("This computer cannot store the sign-in securely.");
		const token = this.encryption.encryptString(refreshToken).toString("base64");
		const others = (await this.read()).filter(
			(a) => !(a.platform === account.platform && a.id === account.id),
		);
		await this.write([...others, { ...account, token }]);
	}

	async refreshToken(platform: DirectAccount["platform"], id: string) {
		const found = (await this.read()).find((a) => a.platform === platform && a.id === id);
		if (!found) return null;
		try {
			return this.encryption.decryptString(Buffer.from(found.token, "base64"));
		} catch {
			return null;
		}
	}

	async remove(platform: DirectAccount["platform"], id: string) {
		await this.write(
			(await this.read()).filter((a) => !(a.platform === platform && a.id === id)),
		);
	}
}
