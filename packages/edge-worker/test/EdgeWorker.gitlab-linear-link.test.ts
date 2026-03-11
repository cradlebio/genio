import { readFile } from "node:fs/promises";
import { LinearClient } from "@linear/sdk";
import { ClaudeRunner } from "cyrus-claude-runner";
import { LinearEventTransport } from "cyrus-linear-event-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";
import { TEST_CYRUS_HOME } from "./test-dirs.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
}));

// Mock dependencies
vi.mock("cyrus-claude-runner");
vi.mock("cyrus-codex-runner");
vi.mock("cyrus-linear-event-transport");
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("cyrus-core", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		isAgentSessionCreatedWebhook: vi.fn(),
		isAgentSessionPromptedWebhook: vi.fn(),
		PersistenceManager: vi.fn().mockImplementation(() => ({
			loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
			saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
		})),
	};
});
vi.mock("file-type");

/**
 * Tests that GitLab MR sessions on branches named after Linear issues
 * get linked to the corresponding Linear issue for activity posting.
 */
describe("EdgeWorker - GitLab-to-Linear Activity Linking", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockLinearClient: any;
	let mockClaudeRunner: any;
	let mockAgentSessionManager: any;
	let mockSession: any;

	const mockRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repo",
		repositoryPath: "/test/repo",
		workspaceBaseDir: "/test/workspaces",
		baseBranch: "main",
		linearToken: "test-token",
		linearWorkspaceId: "test-workspace",
		gitlabUrl: "testgroup/my-repo",
		isActive: true,
		allowedTools: ["Read", "Edit"],
	};

	function createNoteOnMREvent(sourceBranch: string) {
		return {
			type: "webhook" as const,
			payload: {
				object_kind: "note",
				event_type: "note",
				user: { username: "testuser" },
				project: {
					id: 67890,
					path_with_namespace: "testgroup/my-repo",
				},
				object_attributes: {
					id: 100,
					note: "@cyrusagent Fix this bug please",
					noteable_type: "MergeRequest",
				},
				merge_request: {
					iid: 10,
					title: "Fix stuff",
					source_branch: sourceBranch,
				},
			},
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock console methods
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		// Mock LinearClient
		mockLinearClient = {
			issue: vi.fn().mockResolvedValue({
				id: "issue-123",
				identifier: "TEST-123",
				title: "Test Issue",
				branchName: "test-branch",
				state: { name: "Todo" },
				team: { id: "team-123" },
				labels: vi.fn().mockResolvedValue({ nodes: [] }),
			}),
			workflowStates: vi.fn().mockResolvedValue({ nodes: [] }),
			updateIssue: vi.fn().mockResolvedValue({ success: true }),
			createAgentActivity: vi.fn().mockResolvedValue({ success: true }),
			comments: vi.fn().mockResolvedValue({ nodes: [] }),
			rawRequest: vi.fn(),
		};
		vi.mocked(LinearClient).mockImplementation(() => mockLinearClient);

		// Mock ClaudeRunner
		mockClaudeRunner = {
			supportsStreamingInput: true,
			start: vi.fn().mockResolvedValue({ sessionId: "claude-session-123" }),
			startStreaming: vi
				.fn()
				.mockResolvedValue({ sessionId: "claude-session-123" }),
			stop: vi.fn(),
			isStreaming: vi.fn().mockReturnValue(false),
			addStreamMessage: vi.fn(),
			updatePromptVersions: vi.fn(),
		};
		vi.mocked(ClaudeRunner).mockImplementation(() => mockClaudeRunner);

		// Mock session - mutable object so we can check externalSessionId
		mockSession = {
			id: "gitlab-session",
			externalSessionId: undefined,
			claudeSessionId: "claude-session-123",
			workspace: { path: "/test/workspaces/MR-10", isGitWorktree: false },
			claudeRunner: mockClaudeRunner,
			metadata: {},
			issue: { branchName: "cyrus/DEF-123-feature" },
		};

		// Mock AgentSessionManager
		mockAgentSessionManager = {
			createLinearAgentSession: vi.fn(),
			getSession: vi.fn().mockReturnValue(mockSession),
			addAgentRunner: vi.fn(),
			getAllAgentRunners: vi.fn().mockReturnValue([]),
			serializeState: vi.fn().mockReturnValue({ sessions: {}, entries: {} }),
			restoreState: vi.fn(),
			getActiveSessionsByBranchName: vi.fn().mockReturnValue([]),
			on: vi.fn(),
		};
		vi.mocked(AgentSessionManager).mockImplementation(
			() => mockAgentSessionManager,
		);

		// Mock SharedApplicationServer
		vi.mocked(SharedApplicationServer).mockImplementation(
			() =>
				({
					start: vi.fn().mockResolvedValue(undefined),
					stop: vi.fn().mockResolvedValue(undefined),
					getFastifyInstance: vi.fn().mockReturnValue({ post: vi.fn() }),
					getWebhookUrl: vi
						.fn()
						.mockReturnValue("http://localhost:3456/webhook"),
					registerOAuthCallbackHandler: vi.fn(),
				}) as any,
		);

		// Mock LinearEventTransport
		vi.mocked(LinearEventTransport).mockImplementation(
			() =>
				({
					register: vi.fn(),
					on: vi.fn(),
					removeAllListeners: vi.fn(),
				}) as any,
		);

		// Mock readFile
		vi.mocked(readFile).mockResolvedValue("" as any);

		mockConfig = {
			proxyUrl: "http://localhost:3000",
			cyrusHome: TEST_CYRUS_HOME,
			repositories: [mockRepository],
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: "/test/workspaces/MR-10",
					isGitWorktree: false,
				}),
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);

		// Inject mock issue tracker
		const mockIssueTracker = {
			fetchIssue: vi.fn().mockImplementation(async (id: string) => ({
				id: `linear-issue-id-for-${id}`,
				identifier: id,
				title: `Issue ${id}`,
			})),
			getIssueLabels: vi.fn().mockResolvedValue([]),
			createAgentSessionOnIssue: vi.fn().mockResolvedValue({
				success: true,
				agentSession: { id: "linear-agent-session-456" },
			}),
		};
		(edgeWorker as any).issueTrackers.set(mockRepository.id, mockIssueTracker);

		// Mock gitService.createGitWorktree
		(edgeWorker as any).gitService = {
			createGitWorktree: vi.fn().mockResolvedValue({
				path: "/test/workspaces/MR-10",
				isGitWorktree: false,
			}),
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should set externalSessionId when branch contains a Linear issue identifier", async () => {
		const event = createNoteOnMREvent("cyrus/DEF-123-feature");

		const handleGitLabWebhook = (edgeWorker as any).handleGitLabWebhook.bind(
			edgeWorker,
		);
		await handleGitLabWebhook(event);

		// Verify the session's externalSessionId was set
		expect(mockSession.externalSessionId).toBe("linear-agent-session-456");
	});

	it("should call fetchIssue with the uppercase identifier", async () => {
		const event = createNoteOnMREvent("cyrustester/eng-97-fix-shader");

		const handleGitLabWebhook = (edgeWorker as any).handleGitLabWebhook.bind(
			edgeWorker,
		);
		await handleGitLabWebhook(event);

		const mockIssueTracker = (edgeWorker as any).issueTrackers.get(
			mockRepository.id,
		);
		expect(mockIssueTracker.fetchIssue).toHaveBeenCalledWith("ENG-97");
		expect(mockSession.externalSessionId).toBe("linear-agent-session-456");
	});

	it("should not set externalSessionId when branch has no Linear identifier", async () => {
		const event = createNoteOnMREvent("fix-tests");

		const handleGitLabWebhook = (edgeWorker as any).handleGitLabWebhook.bind(
			edgeWorker,
		);
		await handleGitLabWebhook(event);

		// externalSessionId should remain undefined
		expect(mockSession.externalSessionId).toBeUndefined();

		// fetchIssue should not have been called
		const mockIssueTracker = (edgeWorker as any).issueTrackers.get(
			mockRepository.id,
		);
		expect(mockIssueTracker.fetchIssue).not.toHaveBeenCalled();
	});

	it("should gracefully handle fetchIssue failure and continue session", async () => {
		// Make fetchIssue throw
		const mockIssueTracker = (edgeWorker as any).issueTrackers.get(
			mockRepository.id,
		);
		mockIssueTracker.fetchIssue.mockRejectedValue(new Error("Issue not found"));

		const event = createNoteOnMREvent("cyrus/FAKE-999-thing");

		const handleGitLabWebhook = (edgeWorker as any).handleGitLabWebhook.bind(
			edgeWorker,
		);
		await handleGitLabWebhook(event);

		// externalSessionId should remain undefined (linking failed gracefully)
		expect(mockSession.externalSessionId).toBeUndefined();

		// Session should still have been created and runner started
		expect(mockAgentSessionManager.createLinearAgentSession).toHaveBeenCalled();
		expect(mockClaudeRunner.start).toHaveBeenCalled();
	});
});
