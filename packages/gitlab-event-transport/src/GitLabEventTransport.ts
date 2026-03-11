import { timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import type { TranslationContext } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { GitLabMessageTranslator } from "./GitLabMessageTranslator.js";
import type {
	GitLabEventTransportConfig,
	GitLabEventTransportEvents,
	GitLabEventType,
	GitLabIssuePayload,
	GitLabMergeRequestPayload,
	GitLabNotePayload,
	GitLabVerificationMode,
	GitLabWebhookEvent,
} from "./types.js";

export declare interface GitLabEventTransport {
	on<K extends keyof GitLabEventTransportEvents>(
		event: K,
		listener: GitLabEventTransportEvents[K],
	): this;
	emit<K extends keyof GitLabEventTransportEvents>(
		event: K,
		...args: Parameters<GitLabEventTransportEvents[K]>
	): boolean;
}

/**
 * GitLabEventTransport - Handles GitLab webhook event delivery
 *
 * This class provides a typed EventEmitter-based transport
 * for handling GitLab webhooks.
 *
 * It registers a POST /gitlab-webhook endpoint with a Fastify server
 * and verifies incoming webhooks using either:
 * 1. "token" mode: Verifies X-Gitlab-Token header via timing-safe comparison
 * 2. "proxy" mode: Verifies Bearer token authentication (forwarded from CYHOST)
 *
 * Supported GitLab event types:
 * - Note Hook: Comments on issues/merge requests
 * - Issue Hook: Issue creation, updates, assignment changes
 * - Merge Request Hook: MR creation, updates, assignment changes
 */
export class GitLabEventTransport extends EventEmitter {
	private config: GitLabEventTransportConfig;
	private logger: ILogger;
	private messageTranslator: GitLabMessageTranslator;
	private translationContext: TranslationContext;

	constructor(
		config: GitLabEventTransportConfig,
		logger?: ILogger,
		translationContext?: TranslationContext,
	) {
		super();
		this.config = config;
		this.logger = logger ?? createLogger({ component: "GitLabEventTransport" });
		this.messageTranslator = new GitLabMessageTranslator(config.botUsername);
		this.translationContext = translationContext ?? {};
	}

	/**
	 * Set the translation context for message translation.
	 */
	setTranslationContext(context: TranslationContext): void {
		this.translationContext = { ...this.translationContext, ...context };
	}

	/**
	 * Resolve the effective verification mode and secret at request time.
	 * When started in proxy mode, checks if GITLAB_WEBHOOK_TOKEN and
	 * CYRUS_HOST_EXTERNAL have been added to the environment since startup,
	 * enabling a runtime switch to token verification.
	 */
	private resolveVerification(): {
		mode: GitLabVerificationMode;
		secret: string;
	} {
		// If already configured for token mode at startup, keep using it
		if (this.config.verificationMode === "token") {
			return { mode: "token", secret: this.config.secret };
		}

		// Check if token mode env vars have been added at runtime
		const isExternalHost =
			process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
		const gitlabToken = process.env.GITLAB_WEBHOOK_TOKEN;
		const hasGitlabToken = gitlabToken != null && gitlabToken !== "";

		if (isExternalHost && hasGitlabToken) {
			this.logger.info(
				"Runtime switch: GITLAB_WEBHOOK_TOKEN detected, using GitLab token verification",
			);
			return { mode: "token", secret: gitlabToken };
		}

		// Fall back to proxy mode with original config secret
		return { mode: "proxy", secret: this.config.secret };
	}

	/**
	 * Register the /gitlab-webhook endpoint with the Fastify server
	 */
	register(): void {
		this.config.fastifyServer.post(
			"/gitlab-webhook",
			{
				config: {
					rawBody: true,
				},
			},
			async (request: FastifyRequest, reply: FastifyReply) => {
				try {
					const { mode, secret } = this.resolveVerification();

					if (mode === "token") {
						await this.handleTokenWebhook(request, reply, secret);
					} else {
						await this.handleProxyWebhook(request, reply, secret);
					}
				} catch (error) {
					const err = new Error("Webhook error");
					if (error instanceof Error) {
						err.cause = error;
					}
					this.logger.error("Webhook error", err);
					this.emit("error", err);
					reply.code(500).send({ error: "Internal server error" });
				}
			},
		);

		this.logger.info(
			`Registered POST /gitlab-webhook endpoint (${this.config.verificationMode} mode)`,
		);
	}

	/**
	 * Handle webhook using GitLab's X-Gitlab-Token header verification
	 */
	private async handleTokenWebhook(
		request: FastifyRequest,
		reply: FastifyReply,
		secret: string,
	): Promise<void> {
		const token = request.headers["x-gitlab-token"] as string;
		if (!token) {
			reply.code(401).send({ error: "Missing X-Gitlab-Token header" });
			return;
		}

		try {
			const isValid = this.verifyToken(token, secret);

			if (!isValid) {
				reply.code(401).send({ error: "Invalid webhook token" });
				return;
			}

			this.processAndEmitEvent(request, reply);
		} catch (error) {
			const err = new Error("Token verification failed");
			if (error instanceof Error) {
				err.cause = error;
			}
			this.logger.error("Token verification failed", err);
			reply.code(401).send({ error: "Invalid webhook token" });
		}
	}

	/**
	 * Handle webhook using Bearer token authentication (forwarded from CYHOST)
	 */
	private async handleProxyWebhook(
		request: FastifyRequest,
		reply: FastifyReply,
		secret: string,
	): Promise<void> {
		const authHeader = request.headers.authorization;
		if (!authHeader) {
			reply.code(401).send({ error: "Missing Authorization header" });
			return;
		}

		const expectedAuth = `Bearer ${secret}`;
		if (authHeader !== expectedAuth) {
			reply.code(401).send({ error: "Invalid authorization token" });
			return;
		}

		try {
			this.processAndEmitEvent(request, reply);
		} catch (error) {
			const err = new Error("Proxy webhook processing failed");
			if (error instanceof Error) {
				err.cause = error;
			}
			this.logger.error("Proxy webhook processing failed", err);
			reply.code(500).send({ error: "Failed to process webhook" });
		}
	}

	/**
	 * Process the webhook request and emit the appropriate event
	 */
	private processAndEmitEvent(
		request: FastifyRequest,
		reply: FastifyReply,
	): void {
		const eventType = request.headers["x-gitlab-event"] as string;

		if (!eventType) {
			reply.code(400).send({ error: "Missing X-Gitlab-Event header" });
			return;
		}

		if (
			eventType !== "Note Hook" &&
			eventType !== "Issue Hook" &&
			eventType !== "Merge Request Hook"
		) {
			this.logger.debug(`Ignoring unsupported event type: ${eventType}`);
			reply.code(200).send({ success: true, ignored: true });
			return;
		}

		const payload = request.body as
			| GitLabNotePayload
			| GitLabIssuePayload
			| GitLabMergeRequestPayload;

		const webhookEvent: GitLabWebhookEvent = {
			eventType: eventType as GitLabEventType,
			payload,
		};

		this.logger.info(`Received ${eventType} webhook`);

		// Emit "event" for legacy compatibility
		this.emit("event", webhookEvent);

		// Emit "message" with translated internal message
		this.emitMessage(webhookEvent);

		reply.code(200).send({ success: true });
	}

	/**
	 * Translate and emit an internal message from a webhook event.
	 */
	private emitMessage(event: GitLabWebhookEvent): void {
		const result = this.messageTranslator.translate(
			event,
			this.translationContext,
		);

		if (result.success) {
			this.emit("message", result.message);
		} else {
			this.logger.debug(`Message translation skipped: ${result.reason}`);
		}
	}

	/**
	 * Verify GitLab webhook token using timing-safe comparison
	 */
	private verifyToken(receivedToken: string, expectedToken: string): boolean {
		if (receivedToken.length !== expectedToken.length) {
			return false;
		}

		return timingSafeEqual(
			Buffer.from(receivedToken),
			Buffer.from(expectedToken),
		);
	}
}
