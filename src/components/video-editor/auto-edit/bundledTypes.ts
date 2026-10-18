export const BUNDLED_MODEL_ID = "jsox-bundled-vision";
export interface BundledAiStatus {
	available: boolean;
	modelName: string;
	modelBytes: number;
	freeMemoryBytes: number;
	requiredMemoryBytes: number;
	reason?: "unsupported" | "missing";
}
