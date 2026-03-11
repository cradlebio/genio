/**
 * Shared test fixtures for GitLab event transport tests
 */
import type {
	GitLabAssignee,
	GitLabIssueAttributes,
	GitLabIssuePayload,
	GitLabLabel,
	GitLabMergeRequestAttributes,
	GitLabMergeRequestPayload,
	GitLabNoteAttributes,
	GitLabNotePayload,
	GitLabProject,
	GitLabUser,
	GitLabWebhookEvent,
} from "../src/types.js";

export const testUser: GitLabUser = {
	id: 12345,
	name: "Test User",
	username: "testuser",
	avatar_url:
		"https://gitlab.com/uploads/-/system/user/avatar/12345/avatar.png",
	email: "testuser@example.com",
};

export const botUser: GitLabUser = {
	id: 99999,
	name: "Cyrus Bot",
	username: "cyrusagent",
	avatar_url:
		"https://gitlab.com/uploads/-/system/user/avatar/99999/avatar.png",
};

export const testProject: GitLabProject = {
	id: 67890,
	name: "my-repo",
	path_with_namespace: "testgroup/my-repo",
	web_url: "https://gitlab.com/testgroup/my-repo",
	git_http_url: "https://gitlab.com/testgroup/my-repo.git",
	git_ssh_url: "git@gitlab.com:testgroup/my-repo.git",
	default_branch: "main",
	namespace: "testgroup",
};

export const testIssueAttributes: GitLabIssueAttributes = {
	id: 42001,
	iid: 42,
	title: "Fix failing tests",
	description: "Some tests are failing in CI",
	state: "opened",
	action: "open",
	url: "https://gitlab.com/testgroup/my-repo/-/issues/42",
	created_at: "2025-01-15T10:30:00Z",
	updated_at: "2025-01-15T10:30:00Z",
};

export const testMergeRequestAttributes: GitLabMergeRequestAttributes = {
	id: 42002,
	iid: 10,
	title: "Fix failing tests",
	description: "Fixes test failures in CI",
	state: "opened",
	action: "open",
	source_branch: "fix-tests",
	target_branch: "main",
	last_commit: {
		id: "abc123def456",
		message: "fix: resolve test failures",
	},
	url: "https://gitlab.com/testgroup/my-repo/-/merge_requests/10",
	created_at: "2025-01-15T10:30:00Z",
	updated_at: "2025-01-15T10:30:00Z",
};

export const testNoteAttributes: GitLabNoteAttributes = {
	id: 999,
	note: "@cyrusagent Please fix the failing tests",
	noteable_type: "Issue",
	noteable_id: 42001,
	url: "https://gitlab.com/testgroup/my-repo/-/issues/42#note_999",
	created_at: "2025-01-15T10:30:00Z",
	updated_at: "2025-01-15T10:30:00Z",
};

export const testMRNoteAttributes: GitLabNoteAttributes = {
	id: 888,
	note: "@cyrusagent This function needs better error handling",
	noteable_type: "MergeRequest",
	noteable_id: 42002,
	url: "https://gitlab.com/testgroup/my-repo/-/merge_requests/10#note_888",
	created_at: "2025-01-15T10:30:00Z",
	updated_at: "2025-01-15T10:30:00Z",
};

export const testBotAssignee: GitLabAssignee = {
	id: 99999,
	name: "Cyrus Bot",
	username: "cyrusagent",
	avatar_url:
		"https://gitlab.com/uploads/-/system/user/avatar/99999/avatar.png",
};

export const testAssignee: GitLabAssignee = {
	id: 12345,
	name: "Test User",
	username: "testuser",
	avatar_url:
		"https://gitlab.com/uploads/-/system/user/avatar/12345/avatar.png",
};

export const testLabel: GitLabLabel = {
	id: 100,
	title: "bug",
	color: "#d9534f",
};

// ============================================================================
// NOTE PAYLOADS
// ============================================================================

export const noteOnIssuePayload: GitLabNotePayload = {
	object_kind: "note",
	user: testUser,
	project: testProject,
	object_attributes: testNoteAttributes,
	issue: testIssueAttributes,
};

export const noteOnMRPayload: GitLabNotePayload = {
	object_kind: "note",
	user: testUser,
	project: testProject,
	object_attributes: testMRNoteAttributes,
	merge_request: testMergeRequestAttributes,
};

// ============================================================================
// ISSUE PAYLOADS
// ============================================================================

export const issueOpenedPayload: GitLabIssuePayload = {
	object_kind: "issue",
	user: testUser,
	project: testProject,
	object_attributes: { ...testIssueAttributes, action: "open" },
	assignees: [testBotAssignee],
	labels: [testLabel],
};

export const issueAssignedPayload: GitLabIssuePayload = {
	object_kind: "issue",
	user: testUser,
	project: testProject,
	object_attributes: { ...testIssueAttributes, action: "update" },
	assignees: [testBotAssignee],
	labels: [testLabel],
	changes: {
		assignees: {
			previous: [testAssignee],
			current: [testAssignee, testBotAssignee],
		},
	},
};

export const issueUnassignedPayload: GitLabIssuePayload = {
	object_kind: "issue",
	user: testUser,
	project: testProject,
	object_attributes: { ...testIssueAttributes, action: "update" },
	assignees: [testAssignee],
	labels: [testLabel],
	changes: {
		assignees: {
			previous: [testAssignee, testBotAssignee],
			current: [testAssignee],
		},
	},
};

export const issueTitleChangedPayload: GitLabIssuePayload = {
	object_kind: "issue",
	user: testUser,
	project: testProject,
	object_attributes: {
		...testIssueAttributes,
		action: "update",
		title: "Updated title",
	},
	assignees: [testBotAssignee],
	labels: [testLabel],
	changes: {
		title: { previous: "Fix failing tests", current: "Updated title" },
	},
};

export const issueDescriptionChangedPayload: GitLabIssuePayload = {
	object_kind: "issue",
	user: testUser,
	project: testProject,
	object_attributes: {
		...testIssueAttributes,
		action: "update",
		description: "New description",
	},
	assignees: [testBotAssignee],
	labels: [testLabel],
	changes: {
		description: {
			previous: "Some tests are failing in CI",
			current: "New description",
		},
	},
};

// ============================================================================
// MERGE REQUEST PAYLOADS
// ============================================================================

export const mrOpenedPayload: GitLabMergeRequestPayload = {
	object_kind: "merge_request",
	user: testUser,
	project: testProject,
	object_attributes: { ...testMergeRequestAttributes, action: "open" },
	assignees: [testBotAssignee],
	labels: [testLabel],
};

export const mrAssignedPayload: GitLabMergeRequestPayload = {
	object_kind: "merge_request",
	user: testUser,
	project: testProject,
	object_attributes: { ...testMergeRequestAttributes, action: "update" },
	assignees: [testBotAssignee],
	labels: [],
	changes: {
		assignees: {
			previous: [],
			current: [testBotAssignee],
		},
	},
};

export const mrUnassignedPayload: GitLabMergeRequestPayload = {
	object_kind: "merge_request",
	user: testUser,
	project: testProject,
	object_attributes: { ...testMergeRequestAttributes, action: "update" },
	assignees: [],
	labels: [],
	changes: {
		assignees: {
			previous: [testBotAssignee],
			current: [],
		},
	},
};

export const mrTitleChangedPayload: GitLabMergeRequestPayload = {
	object_kind: "merge_request",
	user: testUser,
	project: testProject,
	object_attributes: {
		...testMergeRequestAttributes,
		action: "update",
		title: "Updated MR title",
	},
	assignees: [testBotAssignee],
	labels: [],
	changes: {
		title: { previous: "Fix failing tests", current: "Updated MR title" },
	},
};

// ============================================================================
// WEBHOOK EVENTS
// ============================================================================

export const noteOnIssueEvent: GitLabWebhookEvent = {
	eventType: "Note Hook",
	payload: noteOnIssuePayload,
};

export const noteOnMREvent: GitLabWebhookEvent = {
	eventType: "Note Hook",
	payload: noteOnMRPayload,
};

export const issueOpenedEvent: GitLabWebhookEvent = {
	eventType: "Issue Hook",
	payload: issueOpenedPayload,
};

export const issueAssignedEvent: GitLabWebhookEvent = {
	eventType: "Issue Hook",
	payload: issueAssignedPayload,
};

export const issueUnassignedEvent: GitLabWebhookEvent = {
	eventType: "Issue Hook",
	payload: issueUnassignedPayload,
};

export const issueTitleChangedEvent: GitLabWebhookEvent = {
	eventType: "Issue Hook",
	payload: issueTitleChangedPayload,
};

export const issueDescriptionChangedEvent: GitLabWebhookEvent = {
	eventType: "Issue Hook",
	payload: issueDescriptionChangedPayload,
};

export const mrOpenedEvent: GitLabWebhookEvent = {
	eventType: "Merge Request Hook",
	payload: mrOpenedPayload,
};

export const mrAssignedEvent: GitLabWebhookEvent = {
	eventType: "Merge Request Hook",
	payload: mrAssignedPayload,
};

export const mrUnassignedEvent: GitLabWebhookEvent = {
	eventType: "Merge Request Hook",
	payload: mrUnassignedPayload,
};

export const mrTitleChangedEvent: GitLabWebhookEvent = {
	eventType: "Merge Request Hook",
	payload: mrTitleChangedPayload,
};
