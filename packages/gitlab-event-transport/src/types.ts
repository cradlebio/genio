/**
 * Types for GitLab event transport
 */

import type { InternalMessage } from "cyrus-core";
import type { FastifyInstance } from "fastify";

/**
 * Verification mode for GitLab webhooks
 * - 'token': Verify X-Gitlab-Token header via timing-safe comparison
 * - 'proxy': Use Authorization Bearer token for authentication (forwarded from CYHOST)
 */
export type GitLabVerificationMode = "token" | "proxy";

/**
 * Configuration for GitLabEventTransport
 */
export interface GitLabEventTransportConfig {
	/** Fastify server instance to mount routes on */
	fastifyServer: FastifyInstance;
	/** Verification mode: 'token' or 'proxy' */
	verificationMode: GitLabVerificationMode;
	/** Secret for verification (GITLAB_WEBHOOK_TOKEN for token, CYRUS_API_KEY for proxy) */
	secret: string;
	/** Bot username to filter out self-authored events */
	botUsername?: string;
}

/**
 * Events emitted by GitLabEventTransport
 */
export interface GitLabEventTransportEvents {
	/** Emitted when a GitLab webhook is received and verified */
	event: (event: GitLabWebhookEvent) => void;
	/** Emitted when a unified internal message is received */
	message: (message: InternalMessage) => void;
	/** Emitted when an error occurs */
	error: (error: Error) => void;
}

/**
 * Supported GitLab webhook event types
 */
export type GitLabEventType = "Note Hook" | "Issue Hook" | "Merge Request Hook";

/**
 * Processed GitLab webhook event that is emitted to listeners
 */
export interface GitLabWebhookEvent {
	/** The GitLab event type */
	eventType: GitLabEventType;
	/** The full GitLab webhook payload */
	payload: GitLabNotePayload | GitLabIssuePayload | GitLabMergeRequestPayload;
}

// ============================================================================
// GitLab Webhook Payload Types
// ============================================================================

/**
 * GitLab user object
 */
export interface GitLabUser {
	id: number;
	name: string;
	username: string;
	avatar_url: string;
	email?: string;
}

/**
 * GitLab project object
 */
export interface GitLabProject {
	id: number;
	name: string;
	path_with_namespace: string;
	web_url: string;
	git_http_url: string;
	git_ssh_url: string;
	default_branch: string;
	namespace: string;
}

/**
 * GitLab issue attributes (object_attributes in Issue Hook)
 */
export interface GitLabIssueAttributes {
	id: number;
	iid: number;
	title: string;
	description: string | null;
	state: string;
	action?: string;
	url: string;
	created_at: string;
	updated_at: string;
}

/**
 * GitLab merge request attributes (object_attributes in Merge Request Hook)
 */
export interface GitLabMergeRequestAttributes {
	id: number;
	iid: number;
	title: string;
	description: string | null;
	state: string;
	action?: string;
	source_branch: string;
	target_branch: string;
	last_commit: {
		id: string;
		message: string;
		author_name?: string;
	};
	url: string;
	created_at: string;
	updated_at: string;
}

/**
 * GitLab note attributes (object_attributes in Note Hook)
 */
export interface GitLabNoteAttributes {
	id: number;
	note: string;
	noteable_type: string;
	noteable_id: number;
	url: string;
	created_at: string;
	updated_at: string;
}

/**
 * GitLab label object
 */
export interface GitLabLabel {
	id: number;
	title: string;
	color: string;
	description?: string;
}

/**
 * GitLab assignee (minimal)
 */
export interface GitLabAssignee {
	id: number;
	name: string;
	username: string;
	avatar_url: string;
}

/**
 * GitLab changes field - each changed property has { previous, current } pairs
 */
export interface GitLabChanges {
	title?: { previous: string; current: string };
	description?: { previous: string | null; current: string | null };
	assignees?: { previous: GitLabAssignee[]; current: GitLabAssignee[] };
}

/**
 * Payload for Note Hook webhook events (comments)
 */
export interface GitLabNotePayload {
	object_kind: "note";
	user: GitLabUser;
	project: GitLabProject;
	object_attributes: GitLabNoteAttributes;
	/** Present when the note is on an issue */
	issue?: GitLabIssueAttributes;
	/** Present when the note is on a merge request */
	merge_request?: GitLabMergeRequestAttributes;
}

/**
 * Payload for Issue Hook webhook events
 */
export interface GitLabIssuePayload {
	object_kind: "issue";
	user: GitLabUser;
	project: GitLabProject;
	object_attributes: GitLabIssueAttributes;
	assignees: GitLabAssignee[];
	labels: GitLabLabel[];
	changes?: GitLabChanges;
}

/**
 * Payload for Merge Request Hook webhook events
 */
export interface GitLabMergeRequestPayload {
	object_kind: "merge_request";
	user: GitLabUser;
	project: GitLabProject;
	object_attributes: GitLabMergeRequestAttributes;
	assignees?: GitLabAssignee[];
	labels?: GitLabLabel[];
	changes?: GitLabChanges;
}
