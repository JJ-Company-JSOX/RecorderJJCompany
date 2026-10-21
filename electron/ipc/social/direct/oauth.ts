import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

/**
 * OAuth for a desktop app with no server (RFC 8252): the user signs in on the platform's
 * own page in their browser, which redirects to a one-time listener on 127.0.0.1.
 * PKCE ties the returned code to this app instance.
 */
export function pkcePair() {
	const verifier = randomBytes(48).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge, state: randomBytes(24).toString("base64url") };
}

const PAGE = (message: string) =>
	`<!doctype html><meta charset="utf-8"><title>Recordly</title><body style="font-family:system-ui;padding:3rem;text-align:center"><h2>${message}</h2><p>You can close this tab and return to Recordly.</p></body>`;

/** Starts the loopback listener; `code` resolves with the authorization code. */
export async function startLoopback(
	state: string,
	{ signal, timeoutMs = 5 * 60_000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
	let settle!: { resolve: (code: string) => void; reject: (error: Error) => void };
	const code = new Promise<string>((resolve, reject) => {
		settle = { resolve, reject };
	});
	const server = http.createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== "/" || !url.searchParams.has("state")) {
			response.writeHead(404).end();
			return;
		}
		const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
		response.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
		response.end(PAGE(ok ? "Account connected" : "Sign-in was not completed"));
		if (ok) settle.resolve(url.searchParams.get("code") as string);
		else
			settle.reject(
				new Error(
					url.searchParams.get("error") === "access_denied"
						? "Sign-in was cancelled."
						: "Sign-in failed. Try again.",
				),
			);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const close = () => server.close();
	const timer = setTimeout(
		() => settle.reject(new Error("Sign-in timed out. Try again.")),
		timeoutMs,
	);
	const abort = () => settle.reject(new Error("Sign-in was cancelled."));
	signal?.addEventListener("abort", abort, { once: true });
	void code
		.catch(() => undefined)
		.finally(() => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			close();
		});
	const { port } = server.address() as { port: number };
	return { redirectUri: `http://127.0.0.1:${port}`, code };
}

/** Reads the claims of an ID token received directly from the provider over TLS. */
export function idTokenClaims(idToken: unknown): Record<string, unknown> {
	if (typeof idToken !== "string") return {};
	try {
		return JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
	} catch {
		return {};
	}
}
