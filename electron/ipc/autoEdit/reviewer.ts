import http from "node:http";
import {
	type EditPlan,
	mergeLocalReview,
} from "../../../src/components/video-editor/auto-edit/plan";

export interface LocalModelInfo {
	name: string;
	sizeBytes: number;
	license: string;
	capabilities?: string[];
}
export interface PlanReviewer {
	review(plan: EditPlan, model: string, signal?: AbortSignal): Promise<EditPlan>;
}

function validateModelName(model: string) {
	if (!/^[a-zA-Z0-9_.:/-]{1,120}$/.test(model) || /(?:^|[-:/])cloud(?:$|[-:/])/i.test(model))
		throw new Error("Only installed local models are allowed");
}

/** Direct loopback HTTP bypasses proxies. Redirects and remote endpoints are never followed. */
export function localRequest(
	route: "/api/chat" | "/api/show" | "/api/tags",
	payload?: object,
	signal?: AbortSignal,
): Promise<unknown> {
	signal?.throwIfAborted();
	const body = payload ? JSON.stringify(payload) : "";
	if (Buffer.byteLength(body) > 500_000) throw new Error("Plan too large for local review");
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				signal,
				hostname: "127.0.0.1",
				port: 11434,
				path: route,
				method: payload ? "POST" : "GET",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
				},
			},
			(res) => {
				if (res.statusCode !== 200) {
					res.resume();
					reject(new Error("Local model unavailable"));
					return;
				}
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					text += chunk;
					if (text.length > 1_000_000) req.destroy(new Error("Local response too large"));
				});
				res.on("error", reject);
				res.on("end", () => {
					try {
						resolve(JSON.parse(text));
					} catch {
						reject(new Error("Invalid local response"));
					}
				});
			},
		);
		const timer = setTimeout(
			() => req.destroy(new Error("Local AI request timed out")),
			route === "/api/chat" ? 120_000 : 8_000,
		);
		req.on("close", () => clearTimeout(timer));
		req.on("error", reject);
		req.end(body);
	});
}

/** Inspect already installed weights. Reject Ollama cloud models before sending any plan. */
export async function inspectLocalModel(
	model: string,
	signal?: AbortSignal,
): Promise<LocalModelInfo> {
	validateModelName(model);
	const tags = (await localRequest("/api/tags", undefined, signal)) as {
		models?: { name: string; size: number; remote_model?: string; remote_host?: string }[];
	};
	const installed = tags.models?.find((m) => m.name === model || m.name === `${model}:latest`);
	if (
		!installed ||
		!Number.isFinite(installed.size) ||
		installed.size <= 0 ||
		installed.remote_model ||
		installed.remote_host
	)
		throw new Error("Installed local weights not found");
	const info = (await localRequest("/api/show", { model }, signal)) as {
		license?: string;
		remote_model?: string;
		remote_host?: string;
		model_info?: object;
		capabilities?: string[];
	};
	if (info.remote_model || info.remote_host || !info.model_info || !info.license?.trim())
		throw new Error("Local model or license could not be verified");
	return {
		name: installed.name,
		sizeBytes: installed.size,
		license: info.license,
		capabilities: info.capabilities,
	};
}

/** Uses only an existing user-operated model. Never downloads weights. */
export class LocalPlanReviewer implements PlanReviewer {
	async review(plan: EditPlan, model: string, signal?: AbortSignal): Promise<EditPlan> {
		await inspectLocalModel(model, signal);
		const candidates = plan.suggestions
			.filter((s) => !s.blocked)
			.map(({ id, kind, startMs, endMs, reason }) => ({ id, kind, startMs, endMs, reason }));
		if (candidates.length > 200)
			throw new Error("Local review supports up to 200 suggestions per run");
		const parsed = (await localRequest(
			"/api/chat",
			{
				model,
				stream: false,
				format: "json",
				keep_alive: 0,
				options: { temperature: 0, num_ctx: 4096, num_predict: 2048 },
				messages: [
					{
						role: "system",
						content:
							'Review rule-based recording edits. Reply with {"edits":[{"id":"...","startMs":0,"endMs":1000}]}. Retain only useful candidates. You may shorten a range inside its original bounds or omit it. Never add candidates. Do not expand ranges. No other changes.',
					},
					{ role: "user", content: JSON.stringify(candidates) },
				],
			},
			signal,
		)) as { message: { content: string } };
		signal?.throwIfAborted();
		const reviewed = mergeLocalReview(
			{ ...plan, suggestions: plan.suggestions.filter((s) => !s.blocked) },
			JSON.parse(parsed.message.content).edits,
		);
		return {
			...reviewed,
			suggestions: [...reviewed.suggestions, ...plan.suggestions.filter((s) => s.blocked)],
		};
	}
}
