# API Notes

## Agent interface
Defined in `src/agents/types.ts`.
- `name`: agent identifier used in config and templates.
- `installCmd`: shell command used to install the agent in the container.
- `versionCmd`: shell command used to read the agent version.
- `runCmd`: shell command used to start the agent.
- `firewallDomains`: allowed outbound domains for firewall allowlisting.
- `skipPermissionsFlag`: optional flag for auto-approving permissions.
- `configPath`: optional path to persist agent auth/config data.
- `getAuthInstructions()`: returns user-facing auth guidance.
- `getDockerfileSnippet()`: returns Dockerfile snippet to install the agent.

## AgentConfig (TOML)
Defined in `src/agents/types.ts` and loaded from TOML files.
- `name`: agent identifier.
- `description`: optional human-readable description.
- `install_cmd`: install command.
- `run_cmd`: run command.
- `version_cmd`: version command.
- `skip_permissions_flag`: optional auto-approval flag.
- `config_path`: optional config/auth path to persist.
- `firewall.domains`: list of allowed domains.
- `auth.method`: `"oauth" | "api_key" | "none"`.
- `auth.instructions`: optional auth guidance.
- `dockerfile.snippet`: optional Dockerfile snippet override.

## Config
Defined in `src/config.ts`.
- `default`: `"local"` or `"@alias"`.
- `default_agent`: optional agent name.
- `remotes`: map of remote name to `{ host, alias? }`.

## resolveTarget(target?)
Defined in `src/config.ts`.
- If `target` is omitted, uses `config.default`.
- `"local"` returns `null`.
- `user@host` returns the host after validation.
- `@alias` resolves via `remotes` and `alias` entries.
- Unknown targets exit with an error message.
