/**
 * Service for posting comments back to GitLab issues and merge requests.
 *
 * Uses the GitLab REST API v4 with a personal access token
 * to post notes on issues and merge requests.
 */

export interface GitLabCommentServiceConfig {
	/** GitLab API base URL (default: https://gitlab.com) */
	apiBaseUrl?: string;
}

/**
 * Parameters for posting a note on a GitLab issue
 */
export interface PostIssueNoteParams {
	/** GitLab API token (personal access token or OAuth token) */
	token: string;
	/** Project ID (numeric) or URL-encoded project path */
	projectId: number | string;
	/** Issue IID (project-scoped ID) */
	issueIid: number;
	/** Note body (markdown) */
	body: string;
}

/**
 * Parameters for posting a note on a GitLab merge request
 */
export interface PostMergeRequestNoteParams {
	/** GitLab API token */
	token: string;
	/** Project ID (numeric) or URL-encoded project path */
	projectId: number | string;
	/** Merge request IID (project-scoped ID) */
	mergeRequestIid: number;
	/** Note body (markdown) */
	body: string;
}

/**
 * Parameters for adding an emoji reaction to a note
 */
export interface AddEmojiReactionParams {
	/** GitLab API token */
	token: string;
	/** Project ID (numeric) or URL-encoded project path */
	projectId: number | string;
	/** The type of noteable: "issues" or "merge_requests" */
	noteableType: "issues" | "merge_requests";
	/** IID of the issue/MR */
	noteableIid: number;
	/** Note ID to react to */
	noteId: number;
	/** Emoji name (e.g., "eyes", "thumbsup", "heart") */
	name: string;
}

/**
 * Response from GitLab API after creating a note
 */
export interface GitLabNoteResponse {
	id: number;
	body: string;
	created_at: string;
	author: {
		id: number;
		username: string;
		name: string;
	};
}

export class GitLabCommentService {
	private apiBaseUrl: string;

	constructor(config?: GitLabCommentServiceConfig) {
		this.apiBaseUrl = config?.apiBaseUrl ?? "https://gitlab.com";
	}

	/**
	 * Post a note on a GitLab issue.
	 *
	 * @see https://docs.gitlab.com/ee/api/notes.html#create-new-issue-note
	 */
	async postIssueNote(
		params: PostIssueNoteParams,
	): Promise<GitLabNoteResponse> {
		const { token, projectId, issueIid, body } = params;
		const encodedProjectId = this.encodeProjectId(projectId);
		const url = `${this.apiBaseUrl}/api/v4/projects/${encodedProjectId}/issues/${issueIid}/notes`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"PRIVATE-TOKEN": token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ body }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[GitLabCommentService] Failed to post issue note: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		return (await response.json()) as GitLabNoteResponse;
	}

	/**
	 * Post a note on a GitLab merge request.
	 *
	 * @see https://docs.gitlab.com/ee/api/notes.html#create-new-merge-request-note
	 */
	async postMergeRequestNote(
		params: PostMergeRequestNoteParams,
	): Promise<GitLabNoteResponse> {
		const { token, projectId, mergeRequestIid, body } = params;
		const encodedProjectId = this.encodeProjectId(projectId);
		const url = `${this.apiBaseUrl}/api/v4/projects/${encodedProjectId}/merge_requests/${mergeRequestIid}/notes`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"PRIVATE-TOKEN": token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ body }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[GitLabCommentService] Failed to post merge request note: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}

		return (await response.json()) as GitLabNoteResponse;
	}

	/**
	 * Add an emoji reaction (award emoji) to a note.
	 *
	 * @see https://docs.gitlab.com/ee/api/award_emoji.html#award-a-new-emoji-on-a-comment
	 */
	async addEmojiReaction(params: AddEmojiReactionParams): Promise<void> {
		const { token, projectId, noteableType, noteableIid, noteId, name } =
			params;
		const encodedProjectId = this.encodeProjectId(projectId);
		const url = `${this.apiBaseUrl}/api/v4/projects/${encodedProjectId}/${noteableType}/${noteableIid}/notes/${noteId}/award_emoji`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"PRIVATE-TOKEN": token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name }),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[GitLabCommentService] Failed to add emoji reaction: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}
	}

	/**
	 * Encode project ID for use in API URLs.
	 * Numeric IDs are used as-is; string paths are URL-encoded.
	 */
	private encodeProjectId(projectId: number | string): string {
		if (typeof projectId === "number") {
			return String(projectId);
		}
		return encodeURIComponent(projectId);
	}
}
