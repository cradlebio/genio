/**
 * Utility functions for processing GitLab webhook payloads
 */

import type {
	GitLabIssuePayload,
	GitLabMergeRequestPayload,
	GitLabNotePayload,
	GitLabWebhookEvent,
} from "./types.js";

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for Note Hook payloads
 */
export function isNotePayload(
	payload: GitLabWebhookEvent["payload"],
): payload is GitLabNotePayload {
	return payload.object_kind === "note";
}

/**
 * Type guard for Issue Hook payloads
 */
export function isIssuePayload(
	payload: GitLabWebhookEvent["payload"],
): payload is GitLabIssuePayload {
	return payload.object_kind === "issue";
}

/**
 * Type guard for Merge Request Hook payloads
 */
export function isMergeRequestPayload(
	payload: GitLabWebhookEvent["payload"],
): payload is GitLabMergeRequestPayload {
	return payload.object_kind === "merge_request";
}

/**
 * Check if a note is on an issue
 */
export function isNoteOnIssue(payload: GitLabNotePayload): boolean {
	return (
		payload.object_attributes.noteable_type === "Issue" && payload.issue != null
	);
}

/**
 * Check if a note is on a merge request
 */
export function isNoteOnMergeRequest(payload: GitLabNotePayload): boolean {
	return (
		payload.object_attributes.noteable_type === "MergeRequest" &&
		payload.merge_request != null
	);
}

// ============================================================================
// FIELD EXTRACTORS
// ============================================================================

/**
 * Extract project path_with_namespace from a webhook event
 */
export function extractProjectPath(event: GitLabWebhookEvent): string {
	return event.payload.project.path_with_namespace;
}

/**
 * Extract project ID from a webhook event
 */
export function extractProjectId(event: GitLabWebhookEvent): number {
	return event.payload.project.id;
}

/**
 * Extract the note body from a Note Hook event
 */
export function extractNoteBody(event: GitLabWebhookEvent): string | null {
	if (!isNotePayload(event.payload)) return null;
	return event.payload.object_attributes.note;
}

/**
 * Extract the note author username from a Note Hook event
 */
export function extractNoteAuthor(event: GitLabWebhookEvent): string | null {
	if (!isNotePayload(event.payload)) return null;
	return event.payload.user.username;
}

/**
 * Extract the issue IID from a webhook event
 */
export function extractIssueIid(event: GitLabWebhookEvent): number | null {
	const { payload } = event;
	if (isIssuePayload(payload)) {
		return payload.object_attributes.iid;
	}
	if (isNotePayload(payload) && payload.issue) {
		return payload.issue.iid;
	}
	return null;
}

/**
 * Extract the merge request IID from a webhook event
 */
export function extractMergeRequestIid(
	event: GitLabWebhookEvent,
): number | null {
	const { payload } = event;
	if (isMergeRequestPayload(payload)) {
		return payload.object_attributes.iid;
	}
	if (isNotePayload(payload) && payload.merge_request) {
		return payload.merge_request.iid;
	}
	return null;
}

/**
 * Extract the MR source branch ref from a webhook event
 */
export function extractMRBranchRef(event: GitLabWebhookEvent): string | null {
	const { payload } = event;
	if (isMergeRequestPayload(payload)) {
		return payload.object_attributes.source_branch;
	}
	if (isNotePayload(payload) && payload.merge_request) {
		return payload.merge_request.source_branch;
	}
	return null;
}

/**
 * Extract the MR title from a webhook event
 */
export function extractMRTitle(event: GitLabWebhookEvent): string | null {
	const { payload } = event;
	if (isMergeRequestPayload(payload)) {
		return payload.object_attributes.title;
	}
	if (isNotePayload(payload) && payload.merge_request) {
		return payload.merge_request.title;
	}
	return null;
}

/**
 * Extract a unique session key for the GitLab webhook event.
 * Format: gitlab:{path_with_namespace}#issue-{iid} for issues
 *         gitlab:{path_with_namespace}!{iid} for merge requests
 */
export function extractSessionKey(event: GitLabWebhookEvent): string | null {
	const projectPath = extractProjectPath(event);
	const issueIid = extractIssueIid(event);
	const mrIid = extractMergeRequestIid(event);

	if (mrIid != null) {
		return `gitlab:${projectPath}!${mrIid}`;
	}
	if (issueIid != null) {
		return `gitlab:${projectPath}#issue-${issueIid}`;
	}
	return null;
}

/**
 * Check if the agent was just assigned to the work item via changes.assignees
 */
export function wasAgentJustAssigned(
	event: GitLabWebhookEvent,
	botUsername: string,
): boolean {
	const { payload } = event;

	if (!isIssuePayload(payload) && !isMergeRequestPayload(payload)) {
		return false;
	}

	const changes = payload.changes;
	if (!changes?.assignees) return false;

	const { previous, current } = changes.assignees;
	const wasPreviously = previous.some((a) => a.username === botUsername);
	const isNow = current.some((a) => a.username === botUsername);

	return !wasPreviously && isNow;
}

/**
 * Check if the agent was just unassigned from the work item via changes.assignees
 */
export function wasAgentJustUnassigned(
	event: GitLabWebhookEvent,
	botUsername: string,
): boolean {
	const { payload } = event;

	if (!isIssuePayload(payload) && !isMergeRequestPayload(payload)) {
		return false;
	}

	const changes = payload.changes;
	if (!changes?.assignees) return false;

	const { previous, current } = changes.assignees;
	const wasPreviously = previous.some((a) => a.username === botUsername);
	const isNow = current.some((a) => a.username === botUsername);

	return wasPreviously && !isNow;
}

/**
 * Check if the title changed in a webhook event
 */
export function hasTitleChanged(event: GitLabWebhookEvent): boolean {
	const { payload } = event;
	if (!isIssuePayload(payload) && !isMergeRequestPayload(payload)) {
		return false;
	}
	return payload.changes?.title != null;
}

/**
 * Check if the description changed in a webhook event
 */
export function hasDescriptionChanged(event: GitLabWebhookEvent): boolean {
	const { payload } = event;
	if (!isIssuePayload(payload) && !isMergeRequestPayload(payload)) {
		return false;
	}
	return payload.changes?.description != null;
}

/**
 * Strip a @mention from a comment body to get the actual instructions
 */
export function stripMention(
	commentBody: string,
	mentionHandle: string = "@cyrusagent",
): string {
	return commentBody
		.replace(
			new RegExp(
				`\\s*${mentionHandle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`,
				"gi",
			),
			" ",
		)
		.trim();
}

/**
 * Extract a Linear issue identifier (e.g., "DEF-123") from a branch name.
 * Returns null if no identifier pattern is found.
 *
 * Handles formats: "username/def-123-title", "def-123-title", "DEF-123/title", "DEF-123"
 */
export function extractLinearIssueIdentifier(
	branchName: string,
): string | null {
	const match = branchName.match(/(?:^|[/])([a-zA-Z]+-\d+)(?:[-/]|$)/);
	return match?.[1] ? match[1].toUpperCase() : null;
}
