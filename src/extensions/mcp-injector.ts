import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { Agent, McpFormat } from "../agents/types.ts";
import type { Extension, McpConfig } from "./types.ts";

// MCP configs are stored in this directory (mounted into container)
const MCP_CONFIGS_DIR = join(homedir(), ".ccc", "mcp-configs");

interface ClaudeMcpConfig {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

// OpenCode format: { mcp: { "name": { type, command: [], environment } } }
interface OpenCodeMcpConfig {
  mcp?: Record<string, {
    type: "local" | "remote";
    command?: string[];
    url?: string;
    enabled?: boolean;
    environment?: Record<string, string>;
  }>;
}

// Gemini format: same as Claude - { mcpServers: { ... } }
interface GeminiMcpConfig {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

type McpConfigDocument = ClaudeMcpConfig | GeminiMcpConfig | OpenCodeMcpConfig | Record<string, unknown>;

/**
 * Ensure MCP configs directory exists
 */
export function ensureMcpConfigsDir(): void {
  if (!existsSync(MCP_CONFIGS_DIR)) {
    mkdirSync(MCP_CONFIGS_DIR, { recursive: true });
  }
}

/**
 * Get the path where MCP config for an agent is stored
 * These are stored in ~/.ccc/mcp-configs/{agent-name}.json on host
 * and mounted into container at /home/ccc/.ccc/mcp-configs/
 */
function getMcpConfigPath(agent: Agent): string {
  return join(MCP_CONFIGS_DIR, `${agent.name}.json`);
}

/**
 * Inject MCP extension config into an agent's MCP configuration file
 */
export function injectMcpConfig(agent: Agent, extension: Extension): boolean {
  if (!agent.mcp || !extension.mcp) {
    return false;
  }

  ensureMcpConfigsDir();

  const configPath = getMcpConfigPath(agent);

  // Read existing config or create empty one
  let config: McpConfigDocument = {};
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      config = JSON.parse(content) as Record<string, unknown>;
    } catch {
      config = {};
    }
  }

  // Inject based on format
  switch (agent.mcp.format) {
    case "claude":
      config = injectClaudeFormat(config as ClaudeMcpConfig, extension.name, extension.mcp);
      break;
    case "gemini":
      config = injectGeminiFormat(config as GeminiMcpConfig, extension.name, extension.mcp);
      break;
    case "opencode":
      config = injectOpenCodeFormat(config as OpenCodeMcpConfig, extension.name, extension.mcp);
      break;
    case "codex":
      // Codex uses TOML format - not supported via JSON injection
      // User needs to manually configure via `codex mcp add`
      console.warn(`Codex MCP config requires TOML format. Use 'codex mcp add' to configure.`);
      return false;
    default:
      // Unknown format, skip
      return false;
  }

  // Write updated config to mcp-configs directory
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return true;
}

/**
 * Remove MCP extension config from an agent's MCP configuration file
 */
export function removeMcpConfig(agent: Agent, extensionName: string): boolean {
  if (!agent.mcp) {
    return false;
  }

  const configPath = getMcpConfigPath(agent);
  if (!existsSync(configPath)) {
    return false;
  }

  let config: McpConfigDocument = {};
  try {
    const content = readFileSync(configPath, "utf-8");
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return false;
  }

  // Remove based on format
  switch (agent.mcp.format) {
    case "claude":
      config = removeClaudeFormat(config as ClaudeMcpConfig, extensionName);
      break;
    case "gemini":
      config = removeGeminiFormat(config as GeminiMcpConfig, extensionName);
      break;
    case "opencode":
      config = removeOpenCodeFormat(config as OpenCodeMcpConfig, extensionName);
      break;
    case "codex":
      // Codex uses TOML format - not supported via JSON injection
      console.warn(`Codex MCP config requires TOML format. Use 'codex mcp remove' to configure.`);
      return false;
    default:
      return false;
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return true;
}

// Claude format: { mcpServers: { "name": { command, args, env } } }
function injectClaudeFormat(config: ClaudeMcpConfig, name: string, mcp: McpConfig): ClaudeMcpConfig {
  if (!config.mcpServers) {
    config.mcpServers = {};
  }
  config.mcpServers[name] = {
    command: mcp.command,
    args: mcp.args,
    env: mcp.env,
  };
  return config;
}

function removeClaudeFormat(config: ClaudeMcpConfig, name: string): ClaudeMcpConfig {
  if (config.mcpServers) {
    delete config.mcpServers[name];
  }
  return config;
}

// Gemini format: { mcpServers: { "name": { command, args, env } } }
// Same structure as Claude
function injectGeminiFormat(config: GeminiMcpConfig, name: string, mcp: McpConfig): GeminiMcpConfig {
  if (!config.mcpServers) {
    config.mcpServers = {};
  }
  config.mcpServers[name] = {
    command: mcp.command,
    args: mcp.args,
    env: mcp.env,
  };
  return config;
}

function removeGeminiFormat(config: GeminiMcpConfig, name: string): GeminiMcpConfig {
  if (config.mcpServers) {
    delete config.mcpServers[name];
  }
  return config;
}

// OpenCode format: { mcp: { "name": { type: "local", command: [...], environment } } }
function injectOpenCodeFormat(config: OpenCodeMcpConfig, name: string, mcp: McpConfig): OpenCodeMcpConfig {
  if (!config.mcp) {
    config.mcp = {};
  }
  // OpenCode expects command as array, and uses "environment" not "env"
  const command = [mcp.command, ...(mcp.args || [])];
  config.mcp[name] = {
    type: "local",
    command,
    enabled: true,
    environment: mcp.env,
  };
  return config;
}

function removeOpenCodeFormat(config: OpenCodeMcpConfig, name: string): OpenCodeMcpConfig {
  if (config.mcp) {
    delete config.mcp[name];
  }
  return config;
}

/**
 * Inject MCP config into all agents that support MCP
 */
export function injectMcpConfigToAllAgents(agents: Agent[], extension: Extension): string[] {
  const injected: string[] = [];
  for (const agent of agents) {
    if (agent.mcp && extension.mcp) {
      if (injectMcpConfig(agent, extension)) {
        injected.push(agent.name);
      }
    }
  }
  return injected;
}

/**
 * Remove MCP config from all agents
 */
export function removeMcpConfigFromAllAgents(agents: Agent[], extensionName: string): string[] {
  const removed: string[] = [];
  for (const agent of agents) {
    if (agent.mcp) {
      if (removeMcpConfig(agent, extensionName)) {
        removed.push(agent.name);
      }
    }
  }
  return removed;
}
