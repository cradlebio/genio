import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitLabCommentService } from "../src/GitLabCommentService.js";

describe("GitLabCommentService", () => {
	let service: GitLabCommentService;
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		service = new GitLabCommentService({
			apiBaseUrl: "https://gitlab.example.com",
		});
		fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("postIssueNote", () => {
		it("posts a note to the correct issue endpoint", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						id: 123,
						body: "Test comment",
						created_at: "2025-01-15T10:30:00Z",
						author: { id: 1, username: "bot", name: "Bot" },
					}),
			});

			const result = await service.postIssueNote({
				token: "test-token",
				projectId: 67890,
				issueIid: 42,
				body: "Test comment",
			});

			expect(fetchSpy).toHaveBeenCalledWith(
				"https://gitlab.example.com/api/v4/projects/67890/issues/42/notes",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"PRIVATE-TOKEN": "test-token",
					}),
				}),
			);
			expect(result.id).toBe(123);
			expect(result.body).toBe("Test comment");
		});

		it("URL-encodes string project IDs", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						id: 123,
						body: "Test",
						created_at: "2025-01-15T10:30:00Z",
						author: { id: 1, username: "bot", name: "Bot" },
					}),
			});

			await service.postIssueNote({
				token: "test-token",
				projectId: "testgroup/my-repo",
				issueIid: 42,
				body: "Test",
			});

			expect(fetchSpy).toHaveBeenCalledWith(
				"https://gitlab.example.com/api/v4/projects/testgroup%2Fmy-repo/issues/42/notes",
				expect.any(Object),
			);
		});

		it("throws on API error", async () => {
			fetchSpy.mockResolvedValue({
				ok: false,
				status: 403,
				statusText: "Forbidden",
				text: () => Promise.resolve("Access denied"),
			});

			await expect(
				service.postIssueNote({
					token: "bad-token",
					projectId: 67890,
					issueIid: 42,
					body: "Test",
				}),
			).rejects.toThrow("[GitLabCommentService] Failed to post issue note");
		});
	});

	describe("postMergeRequestNote", () => {
		it("posts a note to the correct MR endpoint", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						id: 456,
						body: "MR comment",
						created_at: "2025-01-15T10:30:00Z",
						author: { id: 1, username: "bot", name: "Bot" },
					}),
			});

			const result = await service.postMergeRequestNote({
				token: "test-token",
				projectId: 67890,
				mergeRequestIid: 10,
				body: "MR comment",
			});

			expect(fetchSpy).toHaveBeenCalledWith(
				"https://gitlab.example.com/api/v4/projects/67890/merge_requests/10/notes",
				expect.objectContaining({
					method: "POST",
				}),
			);
			expect(result.id).toBe(456);
		});

		it("throws on API error", async () => {
			fetchSpy.mockResolvedValue({
				ok: false,
				status: 404,
				statusText: "Not Found",
				text: () => Promise.resolve("MR not found"),
			});

			await expect(
				service.postMergeRequestNote({
					token: "test-token",
					projectId: 67890,
					mergeRequestIid: 999,
					body: "Test",
				}),
			).rejects.toThrow(
				"[GitLabCommentService] Failed to post merge request note",
			);
		});
	});

	describe("addEmojiReaction", () => {
		it("adds emoji to an issue note", async () => {
			fetchSpy.mockResolvedValue({ ok: true });

			await service.addEmojiReaction({
				token: "test-token",
				projectId: 67890,
				noteableType: "issues",
				noteableIid: 42,
				noteId: 999,
				name: "eyes",
			});

			expect(fetchSpy).toHaveBeenCalledWith(
				"https://gitlab.example.com/api/v4/projects/67890/issues/42/notes/999/award_emoji",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ name: "eyes" }),
				}),
			);
		});

		it("adds emoji to an MR note", async () => {
			fetchSpy.mockResolvedValue({ ok: true });

			await service.addEmojiReaction({
				token: "test-token",
				projectId: 67890,
				noteableType: "merge_requests",
				noteableIid: 10,
				noteId: 888,
				name: "thumbsup",
			});

			expect(fetchSpy).toHaveBeenCalledWith(
				"https://gitlab.example.com/api/v4/projects/67890/merge_requests/10/notes/888/award_emoji",
				expect.any(Object),
			);
		});

		it("throws on API error", async () => {
			fetchSpy.mockResolvedValue({
				ok: false,
				status: 403,
				statusText: "Forbidden",
				text: () => Promise.resolve("Forbidden"),
			});

			await expect(
				service.addEmojiReaction({
					token: "test-token",
					projectId: 67890,
					noteableType: "issues",
					noteableIid: 42,
					noteId: 999,
					name: "eyes",
				}),
			).rejects.toThrow("[GitLabCommentService] Failed to add emoji reaction");
		});
	});

	describe("default API URL", () => {
		it("uses https://gitlab.com by default", async () => {
			const defaultService = new GitLabCommentService();
			fetchSpy.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						id: 1,
						body: "test",
						created_at: "2025-01-15T10:30:00Z",
						author: { id: 1, username: "bot", name: "Bot" },
					}),
			});

			await defaultService.postIssueNote({
				token: "token",
				projectId: 1,
				issueIid: 1,
				body: "test",
			});

			expect(fetchSpy).toHaveBeenCalledWith(
				expect.stringContaining("https://gitlab.com/api/v4/"),
				expect.any(Object),
			);
		});
	});
});
