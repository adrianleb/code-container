export type McpFormat = "claude" | "opencode" | "codex" | "gemini";
export type SkillsFormat = "markdown" | "json";

export interface AgentMcpConfig {
  configPath: string; // e.g., ".claude.json" or ".opencode/config.json"
  format: McpFormat;
}

export interface AgentSkillsConfig {
  path: string; // e.g., ".claude/skills" - where to symlink
  format: SkillsFormat;
}

export interface Agent {
  name: string;
  installCmd: string;
  versionCmd: string;
  runCmd: string;
  authCmd?: string; // Separate auth command (e.g., "codex login --device-auth")
  firewallDomains: string[];
  skipPermissionsFlag?: string;
  configPath?: string;
  authCheckFiles?: string[];
  mcp?: AgentMcpConfig;
  skills?: AgentSkillsConfig;
  getAuthInstructions(): string;
  getDockerfileSnippet(): string;
}

export interface AuthStatus {
  authenticated: boolean;
  method: "oauth" | "api_key" | "none";
  details?: string;
}

export interface AgentStatus {
  name: string;
  enabled: boolean;
  installed: boolean;
  version?: string;
  auth: AuthStatus;
}

export interface AgentConfig {
  name: string;
  description?: string;
  install_cmd: string;
  run_cmd: string;
  version_cmd: string;
  skip_permissions_flag?: string;
  config_path?: string;

  firewall?: {
    domains: string[];
  };

  auth?: {
    method: "oauth" | "api_key" | "none";
    instructions?: string;
    auth_check_files?: string[];
    auth_cmd?: string; // Command to run for auth (defaults to run_cmd)
  };

  dockerfile?: {
    snippet?: string;
  };

  mcp?: {
    config_path: string; // Where agent stores MCP config
    format: McpFormat;
  };

  skills?: {
    path: string; // Where to symlink global skills
    format: SkillsFormat;
  };
}
