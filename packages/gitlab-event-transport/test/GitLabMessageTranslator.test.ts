import { describe, expect, it } from "vitest";
import { GitLabMessageTranslator } from "../src/GitLabMessageTranslator.js";
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
	noteOnMREvent,
} from "./fixtures.js";

describe("GitLabMessageTranslator", () => {
	const translator = new GitLabMessageTranslator("cyrusagent");

	describe("canTranslate", () => {
		it("returns true for valid GitLab webhook events", () => {
			expect(translator.canTranslate(noteOnIssueEvent)).toBe(true);
			expect(translator.canTranslate(issueOpenedEvent)).toBe(true);
			expect(translator.canTranslate(mrOpenedEvent)).toBe(true);
		});

		it("returns false for non-object values", () => {
			expect(translator.canTranslate(null)).toBe(false);
			expect(translator.canTranslate("string")).toBe(false);
			expect(translator.canTranslate(undefined)).toBe(false);
		});

		it("returns false for objects with wrong event type", () => {
			expect(
				translator.canTranslate({ eventType: "Push Hook", payload: {} }),
			).toBe(false);
		});
	});

	describe("Note Hook translation", () => {
		it("translates note on issue as SessionStartMessage", () => {
			const result = translator.translate(noteOnIssueEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			const message = result.message;
			expect(message.action).toBe("session_start");
			expect(message.source).toBe("gitlab");
			expect(message.sessionKey).toBe("gitlab:testgroup/my-repo#issue-42");
			expect(message.workItemIdentifier).toBe("testgroup/my-repo#42");

			if (message.action === "session_start") {
				expect(message.initialPrompt).toBe(
					"@cyrusagent Please fix the failing tests",
				);
				expect(message.title).toBe("Fix failing tests");
				expect(message.platformData.eventType).toBe("Note Hook");
			}
		});

		it("translates note on MR as SessionStartMessage", () => {
			const result = translator.translate(noteOnMREvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			const message = result.message;
			expect(message.action).toBe("session_start");
			expect(message.source).toBe("gitlab");
			expect(message.sessionKey).toBe("gitlab:testgroup/my-repo!10");
			expect(message.workItemIdentifier).toBe("testgroup/my-repo!10");

			if (message.action === "session_start") {
				expect(message.initialPrompt).toBe(
					"@cyrusagent This function needs better error handling",
				);
				expect(message.title).toBe("Fix failing tests");
			}
		});

		it("translates note as UserPromptMessage", () => {
			const result = translator.translateAsUserPrompt(noteOnIssueEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			const message = result.message;
			expect(message.action).toBe("user_prompt");
			expect(message.source).toBe("gitlab");
			expect(message.sessionKey).toBe("gitlab:testgroup/my-repo#issue-42");

			if (message.action === "user_prompt") {
				expect(message.content).toBe(
					"@cyrusagent Please fix the failing tests",
				);
			}
		});

		it("translates MR note as UserPromptMessage", () => {
			const result = translator.translateAsUserPrompt(noteOnMREvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			const message = result.message;
			expect(message.action).toBe("user_prompt");
			expect(message.sessionKey).toBe("gitlab:testgroup/my-repo!10");
		});

		it("rejects translateAsUserPrompt for non-note events", () => {
			const result = translator.translateAsUserPrompt(issueOpenedEvent);

			expect(result.success).toBe(false);
			if (result.success) return;
			expect(result.reason).toContain("Cannot translate");
		});
	});

	describe("Issue Hook translation", () => {
		it("translates issue opened with bot assigned as SessionStartMessage", () => {
			const result = translator.translate(issueOpenedEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			const message = result.message;
			expect(message.action).toBe("session_start");
			expect(message.source).toBe("gitlab");
			expect(message.sessionKey).toBe("gitlab:testgroup/my-repo#issue-42");

			if (message.action === "session_start") {
				expect(message.title).toBe("Fix failing tests");
				expect(message.labels).toEqual(["bug"]);
				expect(message.platformData.eventType).toBe("Issue Hook");
			}
		});

		it("translates issue assignment change as SessionStartMessage", () => {
			const result = translator.translate(issueAssignedEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.action).toBe("session_start");
		});

		it("translates issue unassignment as UnassignMessage", () => {
			const result = translator.translate(issueUnassignedEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.action).toBe("unassign");
			expect(result.message.source).toBe("gitlab");
			expect(result.message.sessionKey).toBe(
				"gitlab:testgroup/my-repo#issue-42",
			);
		});

		it("translates issue title change as ContentUpdateMessage", () => {
			const result = translator.translate(issueTitleChangedEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.action).toBe("content_update");
			if (result.message.action === "content_update") {
				expect(result.message.changes.previousTitle).toBe("Fix failing tests");
				expect(result.message.changes.newTitle).toBe("Updated title");
			}
		});

		it("translates issue description change as ContentUpdateMessage", () => {
			const result = translator.translate(issueDescriptionChangedEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.action).toBe("content_update");
			if (result.message.action === "content_update") {
				expect(result.message.changes.previousDescription).toBe(
					"Some tests are failing in CI",
				);
				expect(result.message.changes.newDescription).toBe("New description");
			}
		});
	});

	describe("Merge Request Hook translation", () => {
		it("translates MR opened with bot assigned as SessionStartMessage", () => {
			const result = translator.translate(mrOpenedEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			const message = result.message;
			expect(message.action).toBe("session_start");
			expect(message.source).toBe("gitlab");
			expect(message.sessionKey).toBe("gitlab:testgroup/my-repo!10");

			if (message.action === "session_start") {
				expect(message.title).toBe("Fix failing tests");
				expect(message.platformData.eventType).toBe("Merge Request Hook");
			}
		});

		it("translates MR assignment change as SessionStartMessage", () => {
			const result = translator.translate(mrAssignedEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.action).toBe("session_start");
		});

		it("translates MR unassignment as UnassignMessage", () => {
			const result = translator.translate(mrUnassignedEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.action).toBe("unassign");
			expect(result.message.sessionKey).toBe("gitlab:testgroup/my-repo!10");
		});

		it("translates MR title change as ContentUpdateMessage", () => {
			const result = translator.translate(mrTitleChangedEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.action).toBe("content_update");
			if (result.message.action === "content_update") {
				expect(result.message.changes.previousTitle).toBe("Fix failing tests");
				expect(result.message.changes.newTitle).toBe("Updated MR title");
			}
		});
	});

	describe("organizationId from context", () => {
		it("uses context organizationId when provided", () => {
			const result = translator.translate(noteOnIssueEvent, {
				organizationId: "custom-org-123",
			});

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.organizationId).toBe("custom-org-123");
		});

		it("falls back to project ID as organizationId", () => {
			const result = translator.translate(noteOnIssueEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.organizationId).toBe("67890");
		});
	});

	describe("author information", () => {
		it("populates author from webhook user data", () => {
			const result = translator.translate(noteOnIssueEvent);

			expect(result.success).toBe(true);
			if (!result.success) return;

			expect(result.message.author).toEqual({
				id: "12345",
				name: "testuser",
				avatarUrl:
					"https://gitlab.com/uploads/-/system/user/avatar/12345/avatar.png",
			});
		});
	});
});
