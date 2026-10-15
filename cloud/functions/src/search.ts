import type { StudioService } from "./service.js";
export interface SearchRequest {
	workspaceId: string;
	uid: string;
	query: unknown;
	mode: "keyword" | "semantic";
	embed?: (text: string) => Promise<number[]>;
}
/** Server derives tenant/user identity; callers cannot supply a different tenant via search filters. */
export interface StudioSearchEngine {
	search(request: SearchRequest): Promise<unknown[]>;
}
export class FirestoreSearchEngine implements StudioSearchEngine {
	constructor(private service: StudioService) {}
	async search(request: SearchRequest) {
		if (request.mode === "keyword")
			return this.service.keywordSearch(request.workspaceId, request.uid, request.query);
		if (!request.embed) throw Error("Embedding provider required");
		return this.service.semanticSearch(
			request.workspaceId,
			request.uid,
			request.query,
			request.embed,
		);
	}
}
