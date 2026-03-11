import { describe, expect, it } from "vitest";
import {
	extractIssueIid,
	extractLinearIssueIdentifier,
	extractMergeRequestIid,
	extractMRBranchRef,
	extractMRTitle,
	extractNoteAuthor,
	extractNoteBody,
	extractProjectId,
	extractProjectPath,
	extractSessionKey,
	hasDescriptionChanged,
	hasTitleChanged,
	isIssuePayload,
	isMergeRequestPayload,
	isNoteOnIssue,
	isNoteOnMergeRequest,
	isNotePayload,
	stripMention,
	wasAgentJustAssigned,
	wasAgentJustUnassigned,
} from "../src/gitlab-webhook-utils.js";
import {
	issueAssignedEvent,
	issueDescriptionChangedEvent,
	issueOpenedEvent,
	issueTitleChangedEvent,
	issueUnassignedEvent,
	mrAssignedEvent,
	mrOpenedEvent,
	mrTitleChangedEvent,
	mrUnassignedEvent,
	noteOnIssueEvent,
	noteOnIssuePayload,
	noteOnMREvent,
	noteOnMRPayload,
} from "./fixtures.js";

describe("gitlab-webhook-utils", () => {
	describe("type guards", () => {
		it("isNotePayload returns true for note payloads", () => {
			expect(isNotePayload(noteOnIssueEvent.payload)).toBe(true);
		});

		it("isNotePayload returns false for non-note payloads", () => {
			expect(isNotePayload(issueOpenedEvent.payload)).toBe(false);
		});

		it("isIssuePayload returns true for issue payloads", () => {
			expect(isIssuePayload(issueOpenedEvent.payload)).toBe(true);
		});

		it("isIssuePayload returns false for non-issue payloads", () => {
			expect(isIssuePayload(noteOnIssueEvent.payload)).toBe(false);
		});

		it("isMergeRequestPayload returns true for MR payloads", () => {
			expect(isMergeRequestPayload(mrOpenedEvent.payload)).toBe(true);
		});

		it("isMergeRequestPayload returns false for non-MR payloads", () => {
			expect(isMergeRequestPayload(noteOnIssueEvent.payload)).toBe(false);
		});

		it("isNoteOnIssue returns true for notes on issues", () => {
			expect(isNoteOnIssue(noteOnIssuePayload)).toBe(true);
		});

		it("isNoteOnIssue returns false for notes on MRs", () => {
			expect(isNoteOnIssue(noteOnMRPayload)).toBe(false);
		});

		it("isNoteOnMergeRequest returns true for notes on MRs", () => {
			expect(isNoteOnMergeRequest(noteOnMRPayload)).toBe(true);
		});

		it("isNoteOnMergeRequest returns false for notes on issues", () => {
			expect(isNoteOnMergeRequest(noteOnIssuePayload)).toBe(false);
		});
	});

	describe("field extractors", () => {
		it("extractProjectPath returns path_with_namespace", () => {
			expect(extractProjectPath(noteOnIssueEvent)).toBe("testgroup/my-repo");
		});

		it("extractProjectId returns project ID", () => {
			expect(extractProjectId(noteOnIssueEvent)).toBe(67890);
		});

		it("extractNoteBody returns note text from Note Hook", () => {
			expect(extractNoteBody(noteOnIssueEvent)).toBe(
				"@cyrusagent Please fix the failing tests",
			);
		});

		it("extractNoteBody returns null for non-note events", () => {
			expect(extractNoteBody(issueOpenedEvent)).toBeNull();
		});

		it("extractNoteAuthor returns username from Note Hook", () => {
			expect(extractNoteAuthor(noteOnIssueEvent)).toBe("testuser");
		});

		it("extractNoteAuthor returns null for non-note events", () => {
			expect(extractNoteAuthor(issueOpenedEvent)).toBeNull();
		});

		it("extractIssueIid returns IID from issue payload", () => {
			expect(extractIssueIid(issueOpenedEvent)).toBe(42);
		});

		it("extractIssueIid returns IID from note on issue", () => {
			expect(extractIssueIid(noteOnIssueEvent)).toBe(42);
		});

		it("extractIssueIid returns null for MR events", () => {
			expect(extractIssueIid(mrOpenedEvent)).toBeNull();
		});

		it("extractMergeRequestIid returns IID from MR payload", () => {
			expect(extractMergeRequestIid(mrOpenedEvent)).toBe(10);
		});

		it("extractMergeRequestIid returns IID from note on MR", () => {
			expect(extractMergeRequestIid(noteOnMREvent)).toBe(10);
		});

		it("extractMergeRequestIid returns null for issue events", () => {
			expect(extractMergeRequestIid(issueOpenedEvent)).toBeNull();
		});

		it("extractMRBranchRef returns source branch from MR payload", () => {
			expect(extractMRBranchRef(mrOpenedEvent)).toBe("fix-tests");
		});

		it("extractMRBranchRef returns source branch from note on MR", () => {
			expect(extractMRBranchRef(noteOnMREvent)).toBe("fix-tests");
		});

		it("extractMRBranchRef returns null for issue events", () => {
			expect(extractMRBranchRef(issueOpenedEvent)).toBeNull();
		});

		it("extractMRTitle returns title from MR payload", () => {
			expect(extractMRTitle(mrOpenedEvent)).toBe("Fix failing tests");
		});

		it("extractMRTitle returns null for issue events", () => {
			expect(extractMRTitle(issueOpenedEvent)).toBeNull();
		});
	});

	describe("extractSessionKey", () => {
		it("returns issue session key format", () => {
			expect(extractSessionKey(issueOpenedEvent)).toBe(
				"gitlab:testgroup/my-repo#issue-42",
			);
		});

		it("returns MR session key format", () => {
			expect(extractSessionKey(mrOpenedEvent)).toBe(
				"gitlab:testgroup/my-repo!10",
			);
		});

		it("returns issue session key for notes on issues", () => {
			expect(extractSessionKey(noteOnIssueEvent)).toBe(
				"gitlab:testgroup/my-repo#issue-42",
			);
		});

		it("returns MR session key for notes on MRs", () => {
			expect(extractSessionKey(noteOnMREvent)).toBe(
				"gitlab:testgroup/my-repo!10",
			);
		});
	});

	describe("wasAgentJustAssigned", () => {
		it("returns true when agent was just assigned to issue", () => {
			expect(wasAgentJustAssigned(issueAssignedEvent, "cyrusagent")).toBe(true);
		});

		it("returns false when agent was not assigned", () => {
			expect(wasAgentJustAssigned(issueOpenedEvent, "cyrusagent")).toBe(false);
		});

		it("returns true when agent was just assigned to MR", () => {
			expect(wasAgentJustAssigned(mrAssignedEvent, "cyrusagent")).toBe(true);
		});

		it("returns false for note events", () => {
			expect(wasAgentJustAssigned(noteOnIssueEvent, "cyrusagent")).toBe(false);
		});
	});

	describe("wasAgentJustUnassigned", () => {
		it("returns true when agent was just unassigned from issue", () => {
			expect(wasAgentJustUnassigned(issueUnassignedEvent, "cyrusagent")).toBe(
				true,
			);
		});

		it("returns false when agent is still assigned", () => {
			expect(wasAgentJustUnassigned(issueAssignedEvent, "cyrusagent")).toBe(
				false,
			);
		});

		it("returns true when agent was just unassigned from MR", () => {
			expect(wasAgentJustUnassigned(mrUnassignedEvent, "cyrusagent")).toBe(
				true,
			);
		});
	});

	describe("hasTitleChanged / hasDescriptionChanged", () => {
		it("hasTitleChanged returns true when title changed", () => {
			expect(hasTitleChanged(issueTitleChangedEvent)).toBe(true);
		});

		it("hasTitleChanged returns false when title not changed", () => {
			expect(hasTitleChanged(issueOpenedEvent)).toBe(false);
		});

		it("hasDescriptionChanged returns true when description changed", () => {
			expect(hasDescriptionChanged(issueDescriptionChangedEvent)).toBe(true);
		});

		it("hasDescriptionChanged returns false for note events", () => {
			expect(hasDescriptionChanged(noteOnIssueEvent)).toBe(false);
		});

		it("hasTitleChanged works with MR events", () => {
			expect(hasTitleChanged(mrTitleChangedEvent)).toBe(true);
		});
	});

	describe("stripMention", () => {
		it("strips default @cyrusagent mention", () => {
			expect(stripMention("@cyrusagent Please fix the tests")).toBe(
				"Please fix the tests",
			);
		});

		it("strips custom mention handle", () => {
			expect(stripMention("@mybot Do something", "@mybot")).toBe(
				"Do something",
			);
		});

		it("handles mention in the middle of text", () => {
			expect(stripMention("Hey @cyrusagent fix this")).toBe("Hey fix this");
		});

		it("returns original text when no mention present", () => {
			expect(stripMention("No mention here")).toBe("No mention here");
		});
	});

	describe("extractLinearIssueIdentifier", () => {
		it("extracts identifier from username-prefixed branch", () => {
			expect(
				extractLinearIssueIdentifier("cyrustester/eng-97-fix-shader"),
			).toBe("ENG-97");
		});

		it("extracts identifier from cyrus-prefixed branch", () => {
			expect(extractLinearIssueIdentifier("cyrus/def-123-feature-name")).toBe(
				"DEF-123",
			);
		});

		it("extracts identifier from bare branch", () => {
			expect(extractLinearIssueIdentifier("DEF-123-feature-name")).toBe(
				"DEF-123",
			);
		});

		it("extracts identifier from slash-separated branch", () => {
			expect(extractLinearIssueIdentifier("DEF-123/feature-name")).toBe(
				"DEF-123",
			);
		});

		it("extracts standalone identifier", () => {
			expect(extractLinearIssueIdentifier("DEF-123")).toBe("DEF-123");
		});

		it("returns null for branch without Linear identifier", () => {
			expect(extractLinearIssueIdentifier("fix-tests")).toBeNull();
		});

		it("returns null for simple branch names", () => {
			expect(extractLinearIssueIdentifier("main")).toBeNull();
		});

		it("returns null for empty string", () => {
			expect(extractLinearIssueIdentifier("")).toBeNull();
		});

		it("returns null for feature branch without issue number", () => {
			expect(extractLinearIssueIdentifier("feat/add-login-page")).toBeNull();
		});
	});
});
