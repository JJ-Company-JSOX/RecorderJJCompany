import http from "node:http";
import { acquireBundledOllama, BUNDLED_OLLAMA_MODEL } from "./bundledOllama";
import {
	type EditPlan,
	mergeLocalReview,
} from "../../../src/components/video-editor/auto-edit/plan";

export interface LocalModelInfo {
	name: string;
	sizeBytes: number;
	license: string;
	capabilities?: string[];
	runtime?: "bundled" | "external";
}
export interface PlanReviewer {
	review(plan: EditPlan, model: string, signal?: AbortSignal): Promise<EditPlan>;
}

function validateModelName(model: string) {
	if (!/^[a-zA-Z0-9_.:/-]{1,120}$/.test(model) || /(?:^|[-:/])cloud(?:$|[-:/])/i.test(model))
		throw new Error("Only installed local models are allowed");
}

/** The bundled qwen3:1.7b and other installed Qwen3 tags such as qwen3:4b. */
const thinksByDefault = (model: string | undefined) =>
	model === BUNDLED_OLLAMA_MODEL || /^qwen3:/i.test(model ?? "");

/** Direct loopback HTTP bypasses proxies. Redirects and remote endpoints are never followed. */
export async function localRequest(
	route: "/api/chat" | "/api/show" | "/api/tags",
	payload?: object,
	signal?: AbortSignal,
	maxBodyBytes = 500_000,
	modelName?: string,
): Promise<unknown> {
	signal?.throwIfAborted();
	const requestedModel = modelName ?? (payload as { model?: string } | undefined)?.model;
	// Qwen3 models think by default; on a CPU that costs minutes and output budget the JSON needs.
	const requestPayload =
		route === "/api/chat" && thinksByDefault(requestedModel) && payload && !("think" in payload)
			? { ...payload, think: false }
			: payload;
	const body = requestPayload ? JSON.stringify(requestPayload) : "";
	if (Buffer.byteLength(body) > Math.min(3_000_000, maxBodyBytes))
		throw new Error("Plan too large for local review");
	const lease = await acquireBundledOllama(requestedModel, signal);
	try {
		return await new Promise((resolve, reject) => {
			const req = http.request(
				{
					signal,
					hostname: "127.0.0.1",
					port: lease?.port ?? 11434,
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
						if (text.length > 1_000_000)
							req.destroy(new Error("Local response too large"));
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
	} finally {
		lease?.release();
	}
}

/** Inspect already installed weights. Reject Ollama cloud models before sending any plan. */
export async function inspectLocalModel(
	model: string,
	signal?: AbortSignal,
): Promise<LocalModelInfo> {
	validateModelName(model);
	const lease = await acquireBundledOllama(model, signal);
	try {
		const tags = (await localRequest("/api/tags", undefined, signal, 500_000, model)) as {
			models?: { name: string; size: number; remote_model?: string; remote_host?: string }[];
		};
		const installed = tags.models?.find(
			(m) => m.name === model || m.name === `${model}:latest`,
		);
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
			runtime: lease ? "bundled" : "external",
		};
	} finally {
		lease?.release();
	}
}

/**
 * Ollama turns this schema into a grammar, so even a small model can only answer with the
 * candidates' own ids, each inside its original range, and with no more edits than candidates.
 * With plain JSON mode a small model sometimes replied in another shape, which failed the run.
 */
export function reviewSchema(candidates: { id: string; startMs: number; endMs: number }[]) {
	const ranges = candidates
		.map((c) => ({ id: c.id, min: Math.ceil(c.startMs), max: Math.floor(c.endMs) }))
		.filter((c) => c.min < c.max);
	const time = (c: (typeof ranges)[number]) => ({
		type: "integer",
		minimum: c.min,
		maximum: c.max,
	});
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			edits: {
				type: "array",
				maxItems: ranges.length,
				...(ranges.length
					? {
							items: {
								anyOf: ranges.map((c) => ({
									type: "object",
									additionalProperties: false,
									properties: {
										id: { const: c.id },
										startMs: time(c),
										endMs: time(c),
									},
									required: ["id", "startMs", "endMs"],
								})),
							},
						}
					: {}),
			},
		},
		required: ["edits"],
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
				format: reviewSchema(candidates),
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
