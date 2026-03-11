/**
 * GitLab Message Translator
 *
 * Translates GitLab webhook events into unified internal messages for the
 * internal message bus.
 *
 * @module gitlab-event-transport/GitLabMessageTranslator
 */

import { randomUUID } from "node:crypto";
import type {
	ContentUpdateMessage,
	GitLabContentUpdatePlatformData,
	GitLabPlatformRef,
	GitLabSessionStartPlatformData,
	GitLabUnassignPlatformData,
	GitLabUserPromptPlatformData,
	IMessageTranslator,
	SessionStartMessage,
	TranslationContext,
	TranslationResult,
	UnassignMessage,
	UserPromptMessage,
} from "cyrus-core";
import {
	hasDescriptionChanged,
	hasTitleChanged,
	isNoteOnIssue,
	isNoteOnMergeRequest,
	wasAgentJustAssigned,
	wasAgentJustUnassigned,
} from "./gitlab-webhook-utils.js";
import type {
	GitLabIssueAttributes,
	GitLabIssuePayload,
	GitLabMergeRequestAttributes,
	GitLabMergeRequestPayload,
	GitLabNotePayload,
	GitLabProject,
	GitLabWebhookEvent,
} from "./types.js";

/**
 * Translates GitLab webhook events into internal messages.
 *
 * Note: Like the GitHub translator, defaults to SessionStartMessage.
 * The EdgeWorker determines whether to use SessionStartMessage vs
 * UserPromptMessage based on whether an active session exists.
 */
export class GitLabMessageTranslator
	implements IMessageTranslator<GitLabWebhookEvent>
{
	private botUsername: string;

	constructor(botUsername?: string) {
		this.botUsername = botUsername ?? "";
	}

	/**
	 * Check if this translator can handle the given event.
	 */
	canTranslate(event: unknown): event is GitLabWebhookEvent {
		if (!event || typeof event !== "object") {
			return false;
		}

		const e = event as Record<string, unknown>;
		return (
			typeof e.eventType === "string" &&
			(e.eventType === "Note Hook" ||
				e.eventType === "Issue Hook" ||
				e.eventType === "Merge Request Hook") &&
			e.payload !== null &&
			typeof e.payload === "object"
		);
	}

	/**
	 * Translate a GitLab webhook event into an internal message.
	 */
	translate(
		event: GitLabWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		if (event.eventType === "Note Hook") {
			return this.translateNote(event, context);
		}

		if (event.eventType === "Issue Hook") {
			return this.translateIssue(event, context);
		}

		if (event.eventType === "Merge Request Hook") {
			return this.translateMergeRequest(event, context);
		}

		return {
			success: false,
			reason: `Unsupported GitLab event type: ${event.eventType}`,
		};
	}

	/**
	 * Create a UserPromptMessage from a GitLab event.
	 * Called by EdgeWorker when it determines the message is a follow-up
	 * to an existing session.
	 */
	translateAsUserPrompt(
		event: GitLabWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		if (event.eventType !== "Note Hook") {
			return {
				success: false,
				reason: `Cannot translate ${event.eventType} as user prompt`,
			};
		}

		return this.translateNoteAsUserPrompt(event, context);
	}

	// ============================================================================
	// NOTE HOOK TRANSLATION
	// ============================================================================

	private translateNote(
		event: GitLabWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const payload = event.payload as GitLabNotePayload;

		if (isNoteOnIssue(payload) && payload.issue) {
			return this.translateNoteOnIssue(event, payload, context);
		}

		if (isNoteOnMergeRequest(payload) && payload.merge_request) {
			return this.translateNoteOnMergeRequest(event, payload, context);
		}

		return {
			success: false,
			reason: `Note is not on an issue or merge request (noteable_type: ${payload.object_attributes.noteable_type})`,
		};
	}

	private translateNoteOnIssue(
		event: GitLabWebhookEvent,
		payload: GitLabNotePayload,
		context?: TranslationContext,
	): TranslationResult {
		const { user, project, object_attributes: note, issue } = payload;
		const organizationId = context?.organizationId || String(project.id);
		const sessionKey = `gitlab:${project.path_with_namespace}#issue-${issue!.iid}`;

		const platformData: GitLabSessionStartPlatformData = {
			eventType: event.eventType as "Note Hook",
			project: this.buildProjectRef(project),
			issue: this.buildIssueRef(issue!),
			note: this.buildNoteRef(note, user, issue!.iid),
			gitlabApiToken: context?.metadata?.gitlabApiToken as string | undefined,
		};

		const message: SessionStartMessage = {
			id: randomUUID(),
			source: "gitlab",
			action: "session_start",
			receivedAt: note.created_at,
			organizationId,
			sessionKey,
			workItemId: String(issue!.id),
			workItemIdentifier: `${project.path_with_namespace}#${issue!.iid}`,
			author: {
				id: String(user.id),
				name: user.username,
				avatarUrl: user.avatar_url,
			},
			initialPrompt: note.note,
			title: issue!.title,
			description: issue!.description ?? undefined,
			platformData,
		};

		return { success: true, message };
	}

	private translateNoteOnMergeRequest(
		event: GitLabWebhookEvent,
		payload: GitLabNotePayload,
		context?: TranslationContext,
	): TranslationResult {
		const {
			user,
			project,
			object_attributes: note,
			merge_request: mr,
		} = payload;
		const organizationId = context?.organizationId || String(project.id);
		const sessionKey = `gitlab:${project.path_with_namespace}!${mr!.iid}`;

		const platformData: GitLabSessionStartPlatformData = {
			eventType: event.eventType as "Note Hook",
			project: this.buildProjectRef(project),
			mergeRequest: this.buildMergeRequestRef(mr!),
			note: this.buildNoteRef(note, user, mr!.iid),
			gitlabApiToken: context?.metadata?.gitlabApiToken as string | undefined,
		};

		const message: SessionStartMessage = {
			id: randomUUID(),
			source: "gitlab",
			action: "session_start",
			receivedAt: note.created_at,
			organizationId,
			sessionKey,
			workItemId: String(mr!.id),
			workItemIdentifier: `${project.path_with_namespace}!${mr!.iid}`,
			author: {
				id: String(user.id),
				name: user.username,
				avatarUrl: user.avatar_url,
			},
			initialPrompt: note.note,
			title: mr!.title,
			description: mr!.description ?? undefined,
			platformData,
		};

		return { success: true, message };
	}

	private translateNoteAsUserPrompt(
		event: GitLabWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const payload = event.payload as GitLabNotePayload;
		const { user, project, object_attributes: note } = payload;

		const organizationId = context?.organizationId || String(project.id);

		let sessionKey: string;
		let workItemId: string;
		let workItemIdentifier: string;

		if (isNoteOnMergeRequest(payload) && payload.merge_request) {
			sessionKey = `gitlab:${project.path_with_namespace}!${payload.merge_request.iid}`;
			workItemId = String(payload.merge_request.id);
			workItemIdentifier = `${project.path_with_namespace}!${payload.merge_request.iid}`;
		} else if (isNoteOnIssue(payload) && payload.issue) {
			sessionKey = `gitlab:${project.path_with_namespace}#issue-${payload.issue.iid}`;
			workItemId = String(payload.issue.id);
			workItemIdentifier = `${project.path_with_namespace}#${payload.issue.iid}`;
		} else {
			return {
				success: false,
				reason: "Note is not on an issue or merge request",
			};
		}

		const platformData: GitLabUserPromptPlatformData = {
			eventType: "Note Hook",
			project: this.buildProjectRef(project),
			note: this.buildNoteRef(
				note,
				user,
				payload.merge_request?.iid ?? payload.issue?.iid ?? 0,
			),
			gitlabApiToken: context?.metadata?.gitlabApiToken as string | undefined,
		};

		const message: UserPromptMessage = {
			id: randomUUID(),
			source: "gitlab",
			action: "user_prompt",
			receivedAt: note.created_at,
			organizationId,
			sessionKey,
			workItemId,
			workItemIdentifier,
			author: {
				id: String(user.id),
				name: user.username,
				avatarUrl: user.avatar_url,
			},
			content: note.note,
			platformData,
		};

		return { success: true, message };
	}

	// ============================================================================
	// ISSUE HOOK TRANSLATION
	// ============================================================================

	private translateIssue(
		event: GitLabWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const payload = event.payload as GitLabIssuePayload;
		const { object_attributes: issue } = payload;
		const action = issue.action;

		// Agent was just unassigned
		if (
			action === "update" &&
			this.botUsername &&
			wasAgentJustUnassigned(event, this.botUsername)
		) {
			return this.translateIssueUnassign(event, payload, context);
		}

		// Title or description changed
		if (
			action === "update" &&
			(hasTitleChanged(event) || hasDescriptionChanged(event))
		) {
			return this.translateIssueContentUpdate(event, payload, context);
		}

		// Agent was just assigned (via changes)
		if (
			action === "update" &&
			this.botUsername &&
			wasAgentJustAssigned(event, this.botUsername)
		) {
			return this.translateIssueSessionStart(event, payload, context);
		}

		// New issue opened with agent already assigned
		if (action === "open") {
			const isAssigned =
				this.botUsername &&
				payload.assignees.some((a) => a.username === this.botUsername);
			if (isAssigned) {
				return this.translateIssueSessionStart(event, payload, context);
			}
		}

		return {
			success: false,
			reason: `Issue Hook with action '${action}' not relevant`,
		};
	}

	private translateIssueSessionStart(
		_event: GitLabWebhookEvent,
		payload: GitLabIssuePayload,
		context?: TranslationContext,
	): TranslationResult {
		const { user, project, object_attributes: issue } = payload;
		const organizationId = context?.organizationId || String(project.id);
		const sessionKey = `gitlab:${project.path_with_namespace}#issue-${issue.iid}`;

		const platformData: GitLabSessionStartPlatformData = {
			eventType: "Issue Hook",
			project: this.buildProjectRef(project),
			issue: this.buildIssueRef(issue, payload.assignees, payload.labels),
			gitlabApiToken: context?.metadata?.gitlabApiToken as string | undefined,
		};

		const message: SessionStartMessage = {
			id: randomUUID(),
			source: "gitlab",
			action: "session_start",
			receivedAt: issue.updated_at || issue.created_at,
			organizationId,
			sessionKey,
			workItemId: String(issue.id),
			workItemIdentifier: `${project.path_with_namespace}#${issue.iid}`,
			author: {
				id: String(user.id),
				name: user.username,
				avatarUrl: user.avatar_url,
			},
			initialPrompt: issue.description ?? issue.title,
			title: issue.title,
			description: issue.description ?? undefined,
			labels: payload.labels?.map((l) => l.title),
			platformData,
		};

		return { success: true, message };
	}

	private translateIssueUnassign(
		_event: GitLabWebhookEvent,
		payload: GitLabIssuePayload,
		context?: TranslationContext,
	): TranslationResult {
		const { user, project, object_attributes: issue } = payload;
		const organizationId = context?.organizationId || String(project.id);
		const sessionKey = `gitlab:${project.path_with_namespace}#issue-${issue.iid}`;

		const platformData: GitLabUnassignPlatformData = {
			eventType: "Issue Hook",
			project: this.buildProjectRef(project),
			issue: this.buildIssueRef(issue, payload.assignees, payload.labels),
		};

		const message: UnassignMessage = {
			id: randomUUID(),
			source: "gitlab",
			action: "unassign",
			receivedAt: issue.updated_at || issue.created_at,
			organizationId,
			sessionKey,
			workItemId: String(issue.id),
			workItemIdentifier: `${project.path_with_namespace}#${issue.iid}`,
			author: {
				id: String(user.id),
				name: user.username,
				avatarUrl: user.avatar_url,
			},
			platformData,
		};

		return { success: true, message };
	}

	private translateIssueContentUpdate(
		_event: GitLabWebhookEvent,
		payload: GitLabIssuePayload,
		context?: TranslationContext,
	): TranslationResult {
		const { user, project, object_attributes: issue } = payload;
		const organizationId = context?.organizationId || String(project.id);
		const sessionKey = `gitlab:${project.path_with_namespace}#issue-${issue.iid}`;

		const changes = payload.changes;
		const platformData: GitLabContentUpdatePlatformData = {
			eventType: "Issue Hook",
			project: this.buildProjectRef(project),
			issue: this.buildIssueRef(issue, payload.assignees, payload.labels),
			previousAttributes: changes as unknown as Record<string, unknown>,
		};

		const message: ContentUpdateMessage = {
			id: randomUUID(),
			source: "gitlab",
			action: "content_update",
			receivedAt: issue.updated_at || issue.created_at,
			organizationId,
			sessionKey,
			workItemId: String(issue.id),
			workItemIdentifier: `${project.path_with_namespace}#${issue.iid}`,
			author: {
				id: String(user.id),
				name: user.username,
				avatarUrl: user.avatar_url,
			},
			changes: {
				previousTitle: changes?.title?.previous,
				newTitle: changes?.title?.current,
				previousDescription: changes?.description?.previous ?? undefined,
				newDescription: changes?.description?.current ?? undefined,
			},
			platformData,
		};

		return { success: true, message };
	}

	// ============================================================================
	// MERGE REQUEST HOOK TRANSLATION
	// ============================================================================

	private translateMergeRequest(
		event: GitLabWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const payload = event.payload as GitLabMergeRequestPayload;
		const { object_attributes: mr } = payload;
		const action = mr.action;

		// Agent was just unassigned
		if (
			action === "update" &&
			this.botUsername &&
			wasAgentJustUnassigned(event, this.botUsername)
		) {
			return this.translateMRUnassign(event, payload, context);
		}

		// Title or description changed
		if (
			action === "update" &&
			(hasTitleChanged(event) || hasDescriptionChanged(event))
		) {
			return this.translateMRContentUpdate(event, payload, context);
		}

		// Agent was just assigned (via changes)
		if (
			action === "update" &&
			this.botUsername &&
			wasAgentJustAssigned(event, this.botUsername)
		) {
			return this.translateMRSessionStart(event, payload, context);
		}

		// New MR opened with agent assigned
		if (action === "open") {
			const isAssigned =
				this.botUsername &&
				payload.assignees?.some((a) => a.username === this.botUsername);
			if (isAssigned) {
				return this.translateMRSessionStart(event, payload, context);
			}
		}

		return {
			success: false,
			reason: `Merge Request Hook with action '${action}' not relevant`,
		};
	}

	private translateMRSessionStart(
		_event: GitLabWebhookEvent,
		payload: GitLabMergeRequestPayload,
		context?: TranslationContext,
	): TranslationResult {
		const { user, project, object_attributes: mr } = payload;
		const organizationId = context?.organizationId || String(project.id);
		const sessionKey = `gitlab:${project.path_with_namespace}!${mr.iid}`;

		const platformData: GitLabSessionStartPlatformData = {
			eventType: "Merge Request Hook",
			project: this.buildProjectRef(project),
			mergeRequest: this.buildMergeRequestRef(mr, payload.assignees),
			gitlabApiToken: context?.metadata?.gitlabApiToken as string | undefined,
		};

		const message: SessionStartMessage = {
			id: randomUUID(),
			source: "gitlab",
			action: "session_start",
			receivedAt: mr.updated_at || mr.created_at,
			organizationId,
			sessionKey,
			workItemId: String(mr.id),
			workItemIdentifier: `${project.path_with_namespace}!${mr.iid}`,
			author: {
				id: String(user.id),
				name: user.username,
				avatarUrl: user.avatar_url,
			},
			initialPrompt: mr.description ?? mr.title,
			title: mr.title,
			description: mr.description ?? undefined,
			labels: payload.labels?.map((l) => l.title),
			platformData,
		};

		return { success: true, message };
	}

	private translateMRUnassign(
		_event: GitLabWebhookEvent,
		payload: GitLabMergeRequestPayload,
		context?: TranslationContext,
	): TranslationResult {
		const { user, project, object_attributes: mr } = payload;
		const organizationId = context?.organizationId || String(project.id);
		const sessionKey = `gitlab:${project.path_with_namespace}!${mr.iid}`;

		const platformData: GitLabUnassignPlatformData = {
			eventType: "Merge Request Hook",
			project: this.buildProjectRef(project),
			mergeRequest: this.buildMergeRequestRef(mr, payload.assignees),
		};

		const message: UnassignMessage = {
			id: randomUUID(),
			source: "gitlab",
			action: "unassign",
			receivedAt: mr.updated_at || mr.created_at,
			organizationId,
			sessionKey,
			workItemId: String(mr.id),
			workItemIdentifier: `${project.path_with_namespace}!${mr.iid}`,
			author: {
				id: String(user.id),
				name: user.username,
				avatarUrl: user.avatar_url,
			},
			platformData,
		};

		return { success: true, message };
	}

	private translateMRContentUpdate(
		_event: GitLabWebhookEvent,
		payload: GitLabMergeRequestPayload,
		context?: TranslationContext,
	): TranslationResult {
		const { user, project, object_attributes: mr } = payload;
		const organizationId = context?.organizationId || String(project.id);
		const sessionKey = `gitlab:${project.path_with_namespace}!${mr.iid}`;

		const changes = payload.changes;
		const platformData: GitLabContentUpdatePlatformData = {
			eventType: "Merge Request Hook",
			project: this.buildProjectRef(project),
			mergeRequest: this.buildMergeRequestRef(mr, payload.assignees),
			previousAttributes: changes as unknown as Record<string, unknown>,
		};

		const message: ContentUpdateMessage = {
			id: randomUUID(),
			source: "gitlab",
			action: "content_update",
			receivedAt: mr.updated_at || mr.created_at,
			organizationId,
			sessionKey,
			workItemId: String(mr.id),
			workItemIdentifier: `${project.path_with_namespace}!${mr.iid}`,
			author: {
				id: String(user.id),
				name: user.username,
				avatarUrl: user.avatar_url,
			},
			changes: {
				previousTitle: changes?.title?.previous,
				newTitle: changes?.title?.current,
				previousDescription: changes?.description?.previous ?? undefined,
				newDescription: changes?.description?.current ?? undefined,
			},
			platformData,
		};

		return { success: true, message };
	}

	// ============================================================================
	// HELPER METHODS
	// ============================================================================

	private buildProjectRef(
		project: GitLabProject,
	): GitLabPlatformRef["project"] {
		// GitLab namespace field is a string in webhook payloads
		const namespacePath = project.path_with_namespace
			.split("/")
			.slice(0, -1)
			.join("/");
		return {
			id: project.id,
			name: project.name,
			pathWithNamespace: project.path_with_namespace,
			webUrl: project.web_url,
			httpUrl: project.git_http_url,
			sshUrl: project.git_ssh_url,
			defaultBranch: project.default_branch,
			namespace: {
				name: project.namespace,
				path: namespacePath,
				id: project.id, // Namespace ID not in webhook; use project ID
			},
		};
	}

	private buildIssueRef(
		issue: GitLabIssueAttributes,
		assignees?: Array<{ id: number; username: string; name: string }>,
		labels?: Array<{ id: number; title: string }>,
	): GitLabPlatformRef["issue"] {
		return {
			id: issue.id,
			iid: issue.iid,
			title: issue.title,
			description: issue.description,
			state: issue.state,
			url: issue.url,
			action: issue.action,
			assignees: (assignees ?? []).map((a) => ({
				id: a.id,
				username: a.username,
				name: a.name,
			})),
			labels: (labels ?? []).map((l) => ({
				id: l.id,
				title: l.title,
			})),
		};
	}

	private buildMergeRequestRef(
		mr: GitLabMergeRequestAttributes,
		assignees?: Array<{ id: number; username: string; name: string }>,
	): GitLabPlatformRef["mergeRequest"] {
		return {
			id: mr.id,
			iid: mr.iid,
			title: mr.title,
			description: mr.description,
			state: mr.state,
			url: mr.url,
			action: mr.action,
			sourceBranch: mr.source_branch,
			targetBranch: mr.target_branch,
			lastCommitSha: mr.last_commit.id,
			assignees: (assignees ?? []).map((a) => ({
				id: a.id,
				username: a.username,
				name: a.name,
			})),
			author: {
				id: 0, // Not available in MR attributes directly
				username: "",
				name: "",
			},
		};
	}

	private buildNoteRef(
		note: GitLabNotePayload["object_attributes"],
		user: GitLabNotePayload["user"],
		noteableIid: number,
	): GitLabPlatformRef["note"] {
		return {
			id: note.id,
			body: note.note,
			noteableType: note.noteable_type,
			noteableIid,
			url: note.url,
			author: {
				id: user.id,
				username: user.username,
				name: user.name,
			},
			createdAt: note.created_at,
		};
	}
}
