import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline";
import { LinearClient } from "@linear/sdk";
import {
	DEFAULT_BASE_BRANCH,
	DEFAULT_CONFIG_FILENAME,
	DEFAULT_WORKTREES_DIR,
	type EdgeConfig,
} from "cyrus-core";
import { BaseCommand } from "./ICommand.js";

/**
 * Workspace credentials extracted from existing repository configurations
 */
interface WorkspaceCredentials {
	id: string;
	name: string;
	token: string;
	refreshToken?: string;
}

/**
 * Self-add-repo command - clones a repo and adds it to config.json
 *
 * Usage:
 *   cyrus self-add-repo                      # prompts for everything
 *   cyrus self-add-repo <url>                # prompts for workspace if multiple
 *   cyrus self-add-repo <url> <workspace>    # no prompts
 */
export class SelfAddRepoCommand extends BaseCommand {
	private rl: readline.Interface | null = null;

	private getReadline(): readline.Interface {
		if (!this.rl) {
			this.rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
		}
		return this.rl;
	}

	private prompt(question: string): Promise<string> {
		return new Promise((resolve) => {
			this.getReadline().question(question, (answer) => resolve(answer.trim()));
		});
	}

	private async acquireM2MToken(
		clientId: string,
		clientSecret: string,
	): Promise<string> {
		const response = await fetch("https://api.linear.app/oauth/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				grant_type: "client_credentials",
				scope: "read,write,app:assignable,app:mentionable",
			}).toString(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`M2M token acquisition failed: ${errorText}`);
		}

		const data = (await response.json()) as {
			access_token: string;
			token_type: string;
			expires_in: number;
			scope: string;
		};

		if (!data.access_token) {
			throw new Error("No access_token in client credentials response");
		}

		return data.access_token;
	}

	private async fetchWorkspaceInfo(
		accessToken: string,
	): Promise<{ id: string; name: string }> {
		const linearClient = new LinearClient({ accessToken });
		const viewer = await linearClient.viewer;
		const organization = await viewer.organization;

		if (!organization?.id) {
			throw new Error("Failed to get workspace info from Linear");
		}

		return { id: organization.id, name: organization.name || organization.id };
	}

	private async resolveM2MWorkspace(
		config: EdgeConfig,
		workspaceName?: string,
	): Promise<WorkspaceCredentials> {
		// In M2M mode, scan existing repos for workspace info with tokens
		const workspaces = new Map<string, WorkspaceCredentials>();
		for (const repo of config.repositories) {
			if (
				repo.linearWorkspaceId &&
				repo.linearToken &&
				!workspaces.has(repo.linearWorkspaceId)
			) {
				workspaces.set(repo.linearWorkspaceId, {
					id: repo.linearWorkspaceId,
					name: repo.linearWorkspaceName || repo.linearWorkspaceId,
					token: repo.linearToken,
				});
			}
		}

		// If no existing credentials, acquire an M2M token (same as self-auth --m2m)
		if (workspaces.size === 0) {
			const clientId = process.env.LINEAR_CLIENT_ID;
			const clientSecret = process.env.LINEAR_CLIENT_SECRET;

			if (!clientId || !clientSecret) {
				this.logError(
					"No Linear credentials found and cannot acquire M2M token.",
				);
				console.log("Either:");
				console.log("  1. Run 'cyrus self-auth' first, or");
				console.log(
					"  2. Set LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET environment variables",
				);
				process.exit(1);
			}

			console.log("No existing credentials found. Acquiring M2M token...");
			const accessToken = await this.acquireM2MToken(clientId, clientSecret);
			const workspace = await this.fetchWorkspaceInfo(accessToken);
			console.log(`  Workspace: ${workspace.name} (${workspace.id})`);

			return {
				id: workspace.id,
				name: workspace.name,
				token: accessToken,
			};
		}

		const workspaceList = Array.from(workspaces.values());

		if (workspaceList.length === 1) {
			return workspaceList[0]!;
		}

		if (workspaceName) {
			const found = workspaceList.find((w) => w.name === workspaceName);
			if (!found) {
				this.logError(`Workspace '${workspaceName}' not found`);
				process.exit(1);
			}
			return found;
		}

		console.log("\nAvailable workspaces:");
		workspaceList.forEach((w, i) => {
			console.log(`  ${i + 1}. ${w.name}`);
		});
		const choice = await this.prompt(
			`Select workspace [1-${workspaceList.length}]: `,
		);
		const idx = parseInt(choice, 10) - 1;
		if (idx < 0 || idx >= workspaceList.length) {
			this.logError("Invalid selection");
			process.exit(1);
		}
		return workspaceList[idx]!;
	}

	private async resolveOAuthWorkspace(
		config: EdgeConfig,
		workspaceName?: string,
	): Promise<WorkspaceCredentials> {
		// Find workspaces with Linear credentials
		const workspaces = new Map<string, WorkspaceCredentials>();
		for (const repo of config.repositories) {
			if (
				repo.linearWorkspaceId &&
				repo.linearToken &&
				!workspaces.has(repo.linearWorkspaceId)
			) {
				workspaces.set(repo.linearWorkspaceId, {
					id: repo.linearWorkspaceId,
					name: repo.linearWorkspaceName || repo.linearWorkspaceId,
					token: repo.linearToken,
					refreshToken: repo.linearRefreshToken,
				});
			}
		}

		if (workspaces.size === 0) {
			this.logError(
				"No Linear credentials found. Run 'cyrus self-auth' first.",
			);
			process.exit(1);
		}

		const workspaceList = Array.from(workspaces.values());

		if (workspaceList.length === 1) {
			return workspaceList[0]!;
		}

		if (workspaceName) {
			const foundWorkspace = workspaceList.find(
				(w) => w.name === workspaceName,
			);
			if (!foundWorkspace) {
				this.logError(`Workspace '${workspaceName}' not found`);
				process.exit(1);
			}
			return foundWorkspace;
		}

		console.log("\nAvailable workspaces:");
		workspaceList.forEach((w, i) => {
			console.log(`  ${i + 1}. ${w.name}`);
		});
		const choice = await this.prompt(
			`Select workspace [1-${workspaceList.length}]: `,
		);
		const idx = parseInt(choice, 10) - 1;
		if (idx < 0 || idx >= workspaceList.length) {
			this.logError("Invalid selection");
			process.exit(1);
		}
		return workspaceList[idx]!;
	}

	private detectVcsUrl(url: string): {
		githubUrl?: string;
		gitlabUrl?: string;
	} {
		const normalized = url.replace(/\.git$/, "");
		if (normalized.includes("github.com")) {
			return { githubUrl: normalized };
		}
		if (normalized.includes("gitlab.com") || normalized.includes("gitlab")) {
			return { gitlabUrl: normalized };
		}
		return {};
	}

	private cleanup(): void {
		if (this.rl) {
			this.rl.close();
			this.rl = null;
		}
	}

	async execute(args: string[]): Promise<void> {
		let url = args[0];
		const workspaceName = args[1];

		try {
			// Load config
			const configPath = resolve(this.app.cyrusHome, DEFAULT_CONFIG_FILENAME);
			let config: EdgeConfig;
			try {
				config = JSON.parse(readFileSync(configPath, "utf-8")) as EdgeConfig;
			} catch {
				this.logError(`Config file not found: ${configPath}`);
				process.exit(1);
			}

			if (!config.repositories) {
				config.repositories = [];
			}

			// Get URL if not provided
			if (!url) {
				url = await this.prompt("Repository URL: ");
				if (!url) {
					this.logError("URL is required");
					process.exit(1);
				}
			}

			// Extract repo name from URL
			const repoName = url
				.split("/")
				.pop()
				?.replace(/\.git$/, "");
			if (!repoName) {
				this.logError("Could not extract repo name from URL");
				process.exit(1);
			}

			// Check for duplicate
			if (
				config.repositories.some(
					(r: EdgeConfig["repositories"][number]) => r.name === repoName,
				)
			) {
				this.logError(`Repository '${repoName}' already exists in config`);
				process.exit(1);
			}

			const isM2M =
				process.env.CYRUS_USE_LINEAR_M2M_TOKEN?.toLowerCase() === "true";

			let selectedWorkspace: WorkspaceCredentials;

			if (isM2M) {
				selectedWorkspace = await this.resolveM2MWorkspace(
					config,
					workspaceName,
				);
			} else {
				selectedWorkspace = await this.resolveOAuthWorkspace(
					config,
					workspaceName,
				);
			}

			// Clone the repo
			const repositoryPath = resolve(this.app.cyrusHome, "repos", repoName);

			if (existsSync(repositoryPath)) {
				console.log(`Repository already exists at ${repositoryPath}`);
			} else {
				console.log(`Cloning ${url}...`);
				try {
					execSync(`git clone ${url} ${repositoryPath}`, { stdio: "inherit" });
				} catch {
					this.logError("Failed to clone repository");
					process.exit(1);
				}
			}

			// Generate UUID and add to config
			const id = randomUUID();

			config.repositories.push({
				id,
				name: repoName,
				repositoryPath,
				baseBranch: DEFAULT_BASE_BRANCH,
				workspaceBaseDir: resolve(this.app.cyrusHome, DEFAULT_WORKTREES_DIR),
				linearWorkspaceId: selectedWorkspace.id,
				linearWorkspaceName: selectedWorkspace.name,
				linearToken: selectedWorkspace.token,
				linearRefreshToken: selectedWorkspace.refreshToken,
				isActive: true,
				...this.detectVcsUrl(url),
			});

			writeFileSync(configPath, JSON.stringify(config, null, "\t"), "utf-8");

			console.log(`\nAdded: ${repoName}`);
			console.log(`  ID: ${id}`);
			console.log(`  Workspace: ${selectedWorkspace.name}`);
			process.exit(0);
		} finally {
			this.cleanup();
		}
	}
}
