import { createLogger, type ILogger } from "cyrus-core";

const LINEAR_TOKEN_ENDPOINT = "https://api.linear.app/oauth/token";
const DEFAULT_SCOPES = "write,app:assignable,app:mentionable";
const RENEWAL_FACTOR = 0.9;
const COOLDOWN_MS = 60_000;
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 5_000;

export interface ClientCredentialsConfig {
	clientId: string;
	clientSecret: string;
	scopes?: string;
	onTokenRefresh?: (accessToken: string) => void | Promise<void>;
}

/**
 * Manages Linear OAuth client credentials tokens for M2M (machine-to-machine) auth.
 *
 * Handles:
 * - Initial token acquisition
 * - Proactive renewal at 90% of expires_in
 * - Reactive re-acquisition on 401 (with cooldown + coalescing)
 * - Exponential backoff on renewal failure
 */
export class ClientCredentialsTokenManager {
	private readonly config: ClientCredentialsConfig;
	private readonly logger: ILogger;

	private currentToken: string | null = null;
	private renewalTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingRefresh: Promise<string> | null = null;
	private lastFailureTimestamp = 0;

	constructor(config: ClientCredentialsConfig, logger?: ILogger) {
		this.config = config;
		this.logger =
			logger ?? createLogger({ component: "ClientCredentialsTokenManager" });
	}

	/**
	 * Acquires a token and starts the proactive renewal timer.
	 * Call once at startup.
	 */
	async initialize(): Promise<string> {
		const token = await this.acquireToken();
		return token;
	}

	/**
	 * Returns the current valid token.
	 * @throws if no token has been acquired yet
	 */
	getToken(): string {
		if (!this.currentToken) {
			throw new Error(
				"No client credentials token available. Call initialize() first.",
			);
		}
		return this.currentToken;
	}

	/**
	 * Re-acquires a token. Used as 401 fallback.
	 * Coalesces concurrent calls and respects cooldown period.
	 */
	async refreshToken(): Promise<string> {
		// Cooldown: skip if we recently failed
		const now = Date.now();
		if (
			this.lastFailureTimestamp > 0 &&
			now - this.lastFailureTimestamp < COOLDOWN_MS
		) {
			throw new Error(
				"Client credentials refresh in cooldown after recent failure",
			);
		}

		// Coalesce concurrent refresh calls
		if (this.pendingRefresh) {
			return this.pendingRefresh;
		}

		this.pendingRefresh = this.acquireToken().finally(() => {
			this.pendingRefresh = null;
		});

		return this.pendingRefresh;
	}

	/**
	 * Clears the renewal timer and pending state.
	 */
	dispose(): void {
		if (this.renewalTimer) {
			clearTimeout(this.renewalTimer);
			this.renewalTimer = null;
		}
		this.pendingRefresh = null;
	}

	private async acquireToken(): Promise<string> {
		const { clientId, clientSecret, scopes, onTokenRefresh } = this.config;

		this.logger.info("Acquiring client credentials token...");

		const params = new URLSearchParams({
			grant_type: "client_credentials",
			client_id: clientId,
			client_secret: clientSecret,
			scope: scopes ?? DEFAULT_SCOPES,
		});

		const response = await fetch(LINEAR_TOKEN_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: params.toString(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			this.lastFailureTimestamp = Date.now();
			throw new Error(
				`Client credentials token acquisition failed (${response.status}): ${errorText}`,
			);
		}

		const data = (await response.json()) as {
			access_token: string;
			token_type: string;
			expires_in: number;
			scope: string;
		};

		if (!data.access_token) {
			this.lastFailureTimestamp = Date.now();
			throw new Error("No access_token in client credentials response");
		}

		this.currentToken = data.access_token;
		this.lastFailureTimestamp = 0;

		this.logger.info(
			`Client credentials token acquired (expires in ${Math.round(data.expires_in / 86400)} days)`,
		);

		// Schedule proactive renewal
		this.scheduleRenewal(data.expires_in);

		// Notify listener
		if (onTokenRefresh) {
			try {
				await onTokenRefresh(data.access_token);
			} catch (err) {
				this.logger.error("onTokenRefresh callback failed:", err);
			}
		}

		return data.access_token;
	}

	private scheduleRenewal(expiresInSeconds: number): void {
		if (this.renewalTimer) {
			clearTimeout(this.renewalTimer);
		}

		const MAX_TIMEOUT_MS = 2_147_483_647; // 2^31 - 1, setTimeout max
		const renewalMs = Math.min(
			expiresInSeconds * RENEWAL_FACTOR * 1000,
			MAX_TIMEOUT_MS,
		);
		this.logger.info(
			`Scheduling token renewal in ${Math.round(renewalMs / 86400000)} days`,
		);

		this.renewalTimer = setTimeout(() => {
			this.renewWithRetry().catch((err) => {
				this.logger.error("Proactive token renewal failed after retries:", err);
			});
		}, renewalMs);
	}

	private async renewWithRetry(): Promise<void> {
		for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
			try {
				await this.acquireToken();
				return;
			} catch (err) {
				this.logger.error(
					`Renewal attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed:`,
					err,
				);
				if (attempt < MAX_RETRY_ATTEMPTS) {
					const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}
		}
	}
}
