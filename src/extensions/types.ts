export type ExtensionType = "host" | "mcp" | "skill";

export interface Extension {
  name: string;
  type: ExtensionType;
  description: string;
  firewallDomains: string[];
  // Host-specific
  installCmd?: string;
  runCmd?: string;
  // MCP-specific
  mcp?: McpConfig;
  // Skill-specific
  skill?: SkillConfig;
}

export interface McpConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SkillConfig {
  filename: string;
  content: string;
}

export interface ExtensionConfig {
  name: string;
  type?: ExtensionType; // defaults to "host" for backwards compat
  description?: string;
  install_cmd?: string;
  run_cmd?: string;

  firewall?: {
    domains: string[];
  };

  mcp?: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };

  skill?: {
    filename: string;
    content: string;
  };
}
