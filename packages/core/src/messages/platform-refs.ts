/**
 * Platform-specific Reference Types
 *
 * These types define the platform-specific data structures that are preserved
 * in the platformData field of internal messages. They provide type-safe access
 * to the original webhook payload data when handlers need platform-specific details.
 *
 * @module messages/platform-refs
 */

import type * as LinearSDK from "@linear/sdk";

// ============================================================================
// LINEAR PLATFORM REFERENCES
// ============================================================================

/**
 * Linear platform reference types.
 * These map to Linear SDK types used in webhook payloads.
 */
export interface LinearPlatformRef {
	/** Agent session data from webhook */
	agentSession: {
		/** Session ID */
		id: string;
		/** Session status */
		status: string;
		/** Session type */
		type?: string;
		/** External link */
		externalLink?: string;
		/** Creator ID */
		creatorId?: string;
		/** Comment that triggered the session (if any) */
		comment?: {
			id: string;
			body?: string;
		};
		/** Issue associated with the session */
		issue: LinearPlatformRef["issue"];
	};

	/** Issue data from webhook */
	issue: {
		/** Issue ID */
		id: string;
		/** Human-readable identifier (e.g., "DEF-123") */
		identifier: string;
		/** Issue title */
		title: string;
		/** Issue description */
		description?: string;
		/** Issue URL */
		url: string;
		/** Branch name */
		branchName?: string;
		/** Team associated with the issue */
		team?: {
			id: string;
			name?: string;
			key?: string;
		};
		/** Project associated with the issue */
		project?: {
			id: string;
			name?: string;
			key?: string;
		};
		/** Labels attached to the issue */
		labels?: Array<{
			id: string;
			name: string;
		}>;
	};

	/** Comment data from webhook */
	comment: {
		/** Comment ID */
		id: string;
		/** Comment body */
		body?: string;
		/** Comment author */
		user?: {
			id: string;
			name?: string;
			displayName?: string;
			email?: string;
		};
	};

	/** Agent activity data from webhook */
	agentActivity: {
		/** Activity ID */
		id: string;
		/** Activity type */
		type?: string;
		/** Activity signal (e.g., "stop") */
		signal?: LinearSDK.AgentActivitySignal;
		/** Activity content */
		content?: {
			/** Content type */
			type?: string;
			/** Content body (for user prompts) */
			body?: string;
		};
	};
}

// ============================================================================
// GITHUB PLATFORM REFERENCES
// ============================================================================

/**
 * GitHub platform reference types.
 * These map to GitHub webhook payload structures.
 */
export interface GitHubPlatformRef {
	/** Repository data from webhook */
	repository: {
		/** Repository ID */
		id: number;
		/** Repository name */
		name: string;
		/** Full repository name (owner/repo) */
		fullName: string;
		/** Repository HTML URL */
		htmlUrl: string;
		/** Clone URL */
		cloneUrl: string;
		/** SSH URL */
		sshUrl: string;
		/** Default branch */
		defaultBranch: string;
		/** Repository owner */
		owner: {
			login: string;
			id: number;
		};
	};

	/** Pull request data from webhook */
	pullRequest: {
		/** PR ID */
		id: number;
		/** PR number */
		number: number;
		/** PR title */
		title: string;
		/** PR body */
		body: string | null;
		/** PR state */
		state: string;
		/** PR HTML URL */
		htmlUrl: string;
		/** Head branch ref */
		headRef: string;
		/** Head branch SHA */
		headSha: string;
		/** Base branch ref */
		baseRef: string;
		/** PR author */
		user: {
			login: string;
			id: number;
		};
	};

	/** Issue data from webhook (used for issue comments) */
	issue: {
		/** Issue ID */
		id: number;
		/** Issue number */
		number: number;
		/** Issue title */
		title: string;
		/** Issue body */
		body: string | null;
		/** Issue state */
		state: string;
		/** Issue HTML URL */
		htmlUrl: string;
		/** Issue author */
		user: {
			login: string;
			id: number;
		};
		/** Present when the issue is actually a PR */
		isPullRequest: boolean;
	};

	/** Comment data from webhook */
	comment: {
		/** Comment ID */
		id: number;
		/** Comment body */
		body: string;
		/** Comment HTML URL */
		htmlUrl: string;
		/** Comment author */
		user: {
			login: string;
			id: number;
			avatarUrl: string;
		};
		/** Comment creation timestamp */
		createdAt: string;
		/** For PR review comments: the file path */
		path?: string;
		/** For PR review comments: the diff hunk */
		diffHunk?: string;
	};
}

// ============================================================================
// GITLAB PLATFORM REFERENCES
// ============================================================================

/**
 * GitLab platform reference types.
 * These map to GitLab webhook payload structures.
 */
export interface GitLabPlatformRef {
	/** Project data from webhook */
	project: {
		/** Project ID */
		id: number;
		/** Project name */
		name: string;
		/** Full project path (group/project) */
		pathWithNamespace: string;
		/** Project web URL */
		webUrl: string;
		/** HTTP clone URL */
		httpUrl: string;
		/** SSH clone URL */
		sshUrl: string;
		/** Default branch */
		defaultBranch: string;
		/** Namespace info */
		namespace: {
			name: string;
			path: string;
			id: number;
		};
	};

	/** Issue data from webhook */
	issue: {
		/** Global ID */
		id: number;
		/** Project-scoped ID (shown in UI) */
		iid: number;
		/** Issue title */
		title: string;
		/** Issue description */
		description: string | null;
		/** Issue state */
		state: string;
		/** Issue web URL */
		url: string;
		/** Action that triggered the webhook */
		action?: string;
		/** Assigned users */
		assignees: Array<{
			id: number;
			username: string;
			name: string;
		}>;
		/** Labels */
		labels: Array<{
			id: number;
			title: string;
		}>;
	};

	/** Merge request data from webhook */
	mergeRequest: {
		/** Global ID */
		id: number;
		/** Project-scoped ID (shown in UI) */
		iid: number;
		/** MR title */
		title: string;
		/** MR description */
		description: string | null;
		/** MR state */
		state: string;
		/** MR web URL */
		url: string;
		/** Action that triggered the webhook */
		action?: string;
		/** Source branch */
		sourceBranch: string;
		/** Target branch */
		targetBranch: string;
		/** Last commit SHA */
		lastCommitSha: string;
		/** Assigned users */
		assignees: Array<{
			id: number;
			username: string;
			name: string;
		}>;
		/** MR author */
		author: {
			id: number;
			username: string;
			name: string;
		};
	};

	/** Note (comment) data from webhook */
	note: {
		/** Note ID */
		id: number;
		/** Note body (markdown) */
		body: string;
		/** Type of object the note is on */
		noteableType: string;
		/** IID of the noteable object */
		noteableIid: number;
		/** Note web URL */
		url: string;
		/** Note author */
		author: {
			id: number;
			username: string;
			name: string;
		};
		/** Creation timestamp */
		createdAt: string;
	};
}

// ============================================================================
// SLACK PLATFORM REFERENCES (Future)
// ============================================================================

/**
 * Slack platform reference types.
 * Placeholder for future Slack integration.
 */
export interface SlackPlatformRef {
	/** Channel data */
	channel: {
		/** Channel ID */
		id: string;
		/** Channel name */
		name?: string;
	};

	/** Thread data */
	thread: {
		/** Thread timestamp */
		ts: string;
		/** Parent message timestamp */
		parentTs?: string;
	};

	/** Message data */
	message: {
		/** Message timestamp */
		ts: string;
		/** Message text */
		text: string;
		/** Message author */
		user: {
			id: string;
			name?: string;
		};
	};
}
