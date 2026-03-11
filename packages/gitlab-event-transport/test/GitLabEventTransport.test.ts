import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitLabEventTransport } from "../src/GitLabEventTransport.js";
import type { GitLabEventTransportConfig } from "../src/types.js";
import { issueOpenedPayload, noteOnIssuePayload } from "./fixtures.js";

// Mock Fastify
function createMockFastify() {
	const routes: Record<string, { handler: Function; opts?: unknown }> = {};
	return {
		post: vi.fn((path: string, opts: unknown, handler: Function) => {
			routes[path] = { handler, opts };
		}),
		routes,
	};
}

function createMockRequest(
	headers: Record<string, string>,
	body: unknown,
	rawBody?: string,
) {
	return {
		headers,
		body,
		rawBody: rawBody ?? JSON.stringify(body),
	};
}

function createMockReply() {
	const reply = {
		code: vi.fn().mockReturnThis(),
		send: vi.fn().mockReturnThis(),
	};
	return reply;
}

describe("GitLabEventTransport", () => {
	let mockFastify: ReturnType<typeof createMockFastify>;
	let transport: GitLabEventTransport;

	beforeEach(() => {
		mockFastify = createMockFastify();
	});

	describe("token verification mode", () => {
		beforeEach(() => {
			const config: GitLabEventTransportConfig = {
				fastifyServer:
					mockFastify as unknown as GitLabEventTransportConfig["fastifyServer"],
				verificationMode: "token",
				secret: "my-gitlab-secret",
			};
			transport = new GitLabEventTransport(config);
			transport.register();
		});

		it("registers POST /gitlab-webhook endpoint", () => {
			expect(mockFastify.post).toHaveBeenCalledWith(
				"/gitlab-webhook",
				expect.any(Object),
				expect.any(Function),
			);
		});

		it("accepts valid X-Gitlab-Token", async () => {
			const handler = mockFastify.routes["/gitlab-webhook"]!.handler;
			const request = createMockRequest(
				{
					"x-gitlab-token": "my-gitlab-secret",
					"x-gitlab-event": "Note Hook",
				},
				noteOnIssuePayload,
			);
			const reply = createMockReply();

			const eventListener = vi.fn();
			transport.on("event", eventListener);

			await handler(request, reply);

			expect(reply.code).toHaveBeenCalledWith(200);
			expect(eventListener).toHaveBeenCalledOnce();
		});

		it("rejects missing X-Gitlab-Token", async () => {
			const handler = mockFastify.routes["/gitlab-webhook"]!.handler;
			const request = createMockRequest(
				{ "x-gitlab-event": "Note Hook" },
				noteOnIssuePayload,
			);
			const reply = createMockReply();

			await handler(request, reply);

			expect(reply.code).toHaveBeenCalledWith(401);
		});

		it("rejects invalid X-Gitlab-Token", async () => {
			const handler = mockFastify.routes["/gitlab-webhook"]!.handler;
			const request = createMockRequest(
				{
					"x-gitlab-token": "wrong-secret",
					"x-gitlab-event": "Note Hook",
				},
				noteOnIssuePayload,
			);
			const reply = createMockReply();

			await handler(request, reply);

			expect(reply.code).toHaveBeenCalledWith(401);
		});
	});

	describe("proxy verification mode", () => {
		beforeEach(() => {
			const config: GitLabEventTransportConfig = {
				fastifyServer:
					mockFastify as unknown as GitLabEventTransportConfig["fastifyServer"],
				verificationMode: "proxy",
				secret: "my-api-key",
			};
			transport = new GitLabEventTransport(config);
			transport.register();
		});

		it("accepts valid Bearer token", async () => {
			const handler = mockFastify.routes["/gitlab-webhook"]!.handler;
			const request = createMockRequest(
				{
					authorization: "Bearer my-api-key",
					"x-gitlab-event": "Note Hook",
				},
				noteOnIssuePayload,
			);
			const reply = createMockReply();

			const eventListener = vi.fn();
			transport.on("event", eventListener);

			await handler(request, reply);

			expect(reply.code).toHaveBeenCalledWith(200);
			expect(eventListener).toHaveBeenCalledOnce();
		});

		it("rejects missing Authorization header", async () => {
			const handler = mockFastify.routes["/gitlab-webhook"]!.handler;
			const request = createMockRequest(
				{ "x-gitlab-event": "Note Hook" },
				noteOnIssuePayload,
			);
			const reply = createMockReply();

			await handler(request, reply);

			expect(reply.code).toHaveBeenCalledWith(401);
		});

		it("rejects invalid Bearer token", async () => {
			const handler = mockFastify.routes["/gitlab-webhook"]!.handler;
			const request = createMockRequest(
				{
					authorization: "Bearer wrong-key",
					"x-gitlab-event": "Note Hook",
				},
				noteOnIssuePayload,
			);
			const reply = createMockReply();

			await handler(request, reply);

			expect(reply.code).toHaveBeenCalledWith(401);
		});
	});

	describe("event processing", () => {
		beforeEach(() => {
			const config: GitLabEventTransportConfig = {
				fastifyServer:
					mockFastify as unknown as GitLabEventTransportConfig["fastifyServer"],
				verificationMode: "proxy",
				secret: "my-api-key",
			};
			transport = new GitLabEventTransport(config);
			transport.register();
		});

		it("ignores unsupported event types", async () => {
			const handler = mockFastify.routes["/gitlab-webhook"]!.handler;
			const request = createMockRequest(
				{
					authorization: "Bearer my-api-key",
					"x-gitlab-event": "Push Hook",
				},
				{},
			);
			const reply = createMockReply();

			await handler(request, reply);

			expect(reply.code).toHaveBeenCalledWith(200);
			expect(reply.send).toHaveBeenCalledWith(
				expect.objectContaining({ ignored: true }),
			);
		});

		it("rejects missing X-Gitlab-Event header", async () => {
			const handler = mockFastify.routes["/gitlab-webhook"]!.handler;
			const request = createMockRequest(
				{ authorization: "Bearer my-api-key" },
				noteOnIssuePayload,
			);
			const reply = createMockReply();

			await handler(request, reply);

			expect(reply.code).toHaveBeenCalledWith(400);
		});

		it("emits event and message for Note Hook", async () => {
			const handler = mockFastify.routes["/gitlab-webhook"]!.handler;
			const request = createMockRequest(
				{
					authorization: "Bearer my-api-key",
					"x-gitlab-event": "Note Hook",
				},
				noteOnIssuePayload,
			);
			const reply = createMockReply();

			const eventListener = vi.fn();
			const messageListener = vi.fn();
			transport.on("event", eventListener);
			transport.on("message", messageListener);

			await handler(request, reply);

			expect(eventListener).toHaveBeenCalledOnce();
			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					eventType: "Note Hook",
					payload: noteOnIssuePayload,
				}),
			);
			expect(messageListener).toHaveBeenCalledOnce();
		});

		it("emits event and message for Issue Hook", async () => {
			const handler = mockFastify.routes["/gitlab-webhook"]!.handler;
			const request = createMockRequest(
				{
					authorization: "Bearer my-api-key",
					"x-gitlab-event": "Issue Hook",
				},
				issueOpenedPayload,
			);
			const reply = createMockReply();

			const eventListener = vi.fn();
			transport.on("event", eventListener);

			await handler(request, reply);

			expect(eventListener).toHaveBeenCalledOnce();
			expect(eventListener).toHaveBeenCalledWith(
				expect.objectContaining({
					eventType: "Issue Hook",
				}),
			);
		});

		it("returns 500 on processing failure", async () => {
			const handler = mockFastify.routes["/gitlab-webhook"]!.handler;
			// Cause an error by providing invalid data that triggers an exception
			const request = {
				headers: {
					authorization: "Bearer my-api-key",
					"x-gitlab-event": "Note Hook",
				},
				get body() {
					throw new Error("Parse error");
				},
			};
			const reply = createMockReply();

			await handler(request, reply);

			expect(reply.code).toHaveBeenCalledWith(500);
		});
	});
});
