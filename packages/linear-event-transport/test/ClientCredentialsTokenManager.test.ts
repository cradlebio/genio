import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientCredentialsTokenManager } from "../src/ClientCredentialsTokenManager.js";

const MOCK_TOKEN_RESPONSE = {
	access_token: "lin_cc_test_token_123",
	token_type: "Bearer",
	expires_in: 2591999,
	scope: "read write",
};

function mockFetchSuccess(response = MOCK_TOKEN_RESPONSE) {
	return vi.fn().mockResolvedValue({
		ok: true,
		json: () => Promise.resolve(response),
	});
}

function mockFetchFailure(status = 401, body = "Unauthorized") {
	return vi.fn().mockResolvedValue({
		ok: false,
		status,
		text: () => Promise.resolve(body),
	});
}

const baseConfig = {
	clientId: "test-client-id",
	clientSecret: "test-client-secret",
};

describe("ClientCredentialsTokenManager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("initialize", () => {
		it("should acquire a token on initialization", async () => {
			vi.stubGlobal("fetch", mockFetchSuccess());
			const manager = new ClientCredentialsTokenManager(baseConfig);

			const token = await manager.initialize();

			expect(token).toBe("lin_cc_test_token_123");
			expect(manager.getToken()).toBe("lin_cc_test_token_123");
			expect(fetch).toHaveBeenCalledOnce();

			const [url, options] = vi.mocked(fetch).mock.calls[0];
			expect(url).toBe("https://api.linear.app/oauth/token");
			expect(options?.method).toBe("POST");
			const body = new URLSearchParams(options?.body as string);
			expect(body.get("grant_type")).toBe("client_credentials");
			expect(body.get("client_id")).toBe("test-client-id");
			expect(body.get("client_secret")).toBe("test-client-secret");
			expect(body.get("scope")).toBe("write,app:assignable,app:mentionable");

			manager.dispose();
		});

		it("should use custom scopes when provided", async () => {
			vi.stubGlobal("fetch", mockFetchSuccess());
			const manager = new ClientCredentialsTokenManager({
				...baseConfig,
				scopes: "read,write",
			});

			await manager.initialize();

			const body = new URLSearchParams(
				vi.mocked(fetch).mock.calls[0][1]?.body as string,
			);
			expect(body.get("scope")).toBe("read,write");

			manager.dispose();
		});

		it("should throw on failed token acquisition", async () => {
			vi.stubGlobal("fetch", mockFetchFailure(400, "Bad Request"));
			const manager = new ClientCredentialsTokenManager(baseConfig);

			await expect(manager.initialize()).rejects.toThrow(
				"Client credentials token acquisition failed (400): Bad Request",
			);
		});

		it("should throw when response has no access_token", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					json: () => Promise.resolve({ token_type: "Bearer" }),
				}),
			);
			const manager = new ClientCredentialsTokenManager(baseConfig);

			await expect(manager.initialize()).rejects.toThrow(
				"No access_token in client credentials response",
			);
		});

		it("should call onTokenRefresh callback after acquisition", async () => {
			vi.stubGlobal("fetch", mockFetchSuccess());
			const onTokenRefresh = vi.fn();
			const manager = new ClientCredentialsTokenManager({
				...baseConfig,
				onTokenRefresh,
			});

			await manager.initialize();

			expect(onTokenRefresh).toHaveBeenCalledWith("lin_cc_test_token_123");

			manager.dispose();
		});
	});

	describe("getToken", () => {
		it("should throw when called before initialize", () => {
			const manager = new ClientCredentialsTokenManager(baseConfig);

			expect(() => manager.getToken()).toThrow(
				"No client credentials token available. Call initialize() first.",
			);
		});
	});

	describe("proactive renewal", () => {
		it("should schedule renewal at 90% of expires_in", async () => {
			const initFetch = mockFetchSuccess({
				...MOCK_TOKEN_RESPONSE,
				expires_in: 100, // 100 seconds for easy math
			});
			vi.stubGlobal("fetch", initFetch);
			const manager = new ClientCredentialsTokenManager(baseConfig);

			await manager.initialize();
			expect(initFetch).toHaveBeenCalledOnce();

			// Replace fetch for renewal (no default fallback to avoid cascading timers)
			const renewFetch = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						...MOCK_TOKEN_RESPONSE,
						expires_in: 999999, // long expiry to prevent further renewals
					}),
			});
			vi.stubGlobal("fetch", renewFetch);

			// Advance to 90% of 100s = 90s = 90000ms
			await vi.advanceTimersByTimeAsync(90_000);

			expect(renewFetch).toHaveBeenCalledOnce();

			manager.dispose();
		});

		it("should retry with exponential backoff on renewal failure", async () => {
			// Use short expiry so we can trigger renewal quickly
			vi.stubGlobal(
				"fetch",
				mockFetchSuccess({ ...MOCK_TOKEN_RESPONSE, expires_in: 100 }),
			);
			const manager = new ClientCredentialsTokenManager(baseConfig);

			await manager.initialize();

			// Replace fetch with fail-fail-succeed sequence (no default fallback)
			const renewFetchMock = vi
				.fn()
				.mockResolvedValueOnce({
					ok: false,
					status: 500,
					text: () => Promise.resolve("Server Error"),
				})
				.mockResolvedValueOnce({
					ok: false,
					status: 500,
					text: () => Promise.resolve("Server Error"),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							...MOCK_TOKEN_RESPONSE,
							access_token: "lin_cc_renewed",
							expires_in: 999999,
						}),
				});
			vi.stubGlobal("fetch", renewFetchMock);

			// Trigger renewal (90% of 100s = 90s)
			await vi.advanceTimersByTimeAsync(90_000);
			// First retry fails, wait for backoff (5s)
			await vi.advanceTimersByTimeAsync(5_000);
			// Second retry fails, wait for backoff (10s)
			await vi.advanceTimersByTimeAsync(10_000);

			expect(renewFetchMock).toHaveBeenCalledTimes(3);
			expect(manager.getToken()).toBe("lin_cc_renewed");

			manager.dispose();
		});
	});

	describe("refreshToken (401 fallback)", () => {
		it("should re-acquire token", async () => {
			const fetchMock = mockFetchSuccess();
			vi.stubGlobal("fetch", fetchMock);
			const manager = new ClientCredentialsTokenManager(baseConfig);

			await manager.initialize();

			fetchMock.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						...MOCK_TOKEN_RESPONSE,
						access_token: "lin_cc_refreshed",
					}),
			});

			const token = await manager.refreshToken();

			expect(token).toBe("lin_cc_refreshed");
			expect(manager.getToken()).toBe("lin_cc_refreshed");

			manager.dispose();
		});

		it("should coalesce concurrent refresh calls", async () => {
			const fetchMock = mockFetchSuccess();
			vi.stubGlobal("fetch", fetchMock);
			const manager = new ClientCredentialsTokenManager(baseConfig);

			await manager.initialize();

			// Set up a slow response for the refresh
			let resolveRefresh: (value: any) => void;
			fetchMock.mockReturnValueOnce(
				new Promise((resolve) => {
					resolveRefresh = resolve;
				}),
			);

			// Fire two concurrent refreshes
			const p1 = manager.refreshToken();
			const p2 = manager.refreshToken();

			// Resolve the single fetch call
			resolveRefresh!({
				ok: true,
				json: () =>
					Promise.resolve({
						...MOCK_TOKEN_RESPONSE,
						access_token: "lin_cc_coalesced",
					}),
			});

			const [t1, t2] = await Promise.all([p1, p2]);
			expect(t1).toBe("lin_cc_coalesced");
			expect(t2).toBe("lin_cc_coalesced");
			// 1 initialize + 1 coalesced refresh = 2 fetch calls
			expect(fetchMock).toHaveBeenCalledTimes(2);

			manager.dispose();
		});

		it("should enforce cooldown after failed refresh", async () => {
			vi.stubGlobal("fetch", mockFetchSuccess());
			const manager = new ClientCredentialsTokenManager(baseConfig);

			await manager.initialize();

			// Make the next fetch fail
			vi.stubGlobal("fetch", mockFetchFailure(500, "Server Error"));

			// First refresh fails — sets cooldown
			await expect(manager.refreshToken()).rejects.toThrow(
				"Client credentials token acquisition failed",
			);

			// Immediately try again — should hit cooldown (not a new fetch)
			await expect(manager.refreshToken()).rejects.toThrow(
				"Client credentials refresh in cooldown",
			);

			// Advance past cooldown (60s)
			vi.advanceTimersByTime(60_001);

			// Should attempt a new fetch (still fails, but NOT a cooldown error)
			await expect(manager.refreshToken()).rejects.toThrow(
				"Client credentials token acquisition failed",
			);

			manager.dispose();
		});
	});

	describe("dispose", () => {
		it("should clear the renewal timer", async () => {
			const fetchMock = mockFetchSuccess({
				...MOCK_TOKEN_RESPONSE,
				expires_in: 100,
			});
			vi.stubGlobal("fetch", fetchMock);
			const manager = new ClientCredentialsTokenManager(baseConfig);

			await manager.initialize();
			expect(fetchMock).toHaveBeenCalledOnce();

			manager.dispose();

			// Advance past renewal time — should NOT trigger another fetch
			await vi.advanceTimersByTimeAsync(100_000);
			expect(fetchMock).toHaveBeenCalledOnce();
		});
	});
});
