import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as TOML from "@iarna/toml";
import type { Agent, AgentConfig } from "./types.ts";
import { getTemplate, getAvailableTemplates, type AgentTemplate } from "./templates.ts";

const AGENTS_DIR = join(homedir(), ".config", "ccc", "agents");

function configToAgent(config: AgentConfig): Agent {
  return {
    name: config.name,
    installCmd: config.install_cmd,
    versionCmd: config.version_cmd,
    runCmd: config.run_cmd,
    firewallDomains: config.firewall?.domains || [],
    skipPermissionsFlag: config.skip_permissions_flag,
    configPath: config.config_path,

    getAuthInstructions(): string {
      return config.auth?.instructions || `Run '${config.run_cmd}' to authenticate.`;
    },

    getDockerfileSnippet(): string {
      if (config.dockerfile?.snippet) {
        return config.dockerfile.snippet.trim();
      }
      return `# Install ${config.name}\nRUN ${config.install_cmd}`;
    },
  };
}

export function loadAgents(): Record<string, Agent> {
  const agents: Record<string, Agent> = {};

  if (!existsSync(AGENTS_DIR)) {
    return agents;
  }

  try {
    const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".toml"));

    for (const file of files) {
      try {
        const filePath = join(AGENTS_DIR, file);
        const content = readFileSync(filePath, "utf-8");
        const config = TOML.parse(content) as unknown as AgentConfig;

        if (!config.name || !config.install_cmd || !config.run_cmd || !config.version_cmd) {
          console.warn(`Skipping ${file}: missing required fields (name, install_cmd, run_cmd, version_cmd)`);
          continue;
        }

        agents[config.name] = configToAgent(config);
      } catch (err) {
        console.warn(`Failed to load agent from ${file}:`, err);
      }
    }
  } catch {}

  return agents;
}

export function getAgentsDir(): string {
  return AGENTS_DIR;
}

export function listAvailableAgents(): AgentTemplate[] {
  return getAvailableTemplates();
}

export function enableAgents(names: string[]): string[] {
  if (!existsSync(AGENTS_DIR)) {
    mkdirSync(AGENTS_DIR, { recursive: true });
  }

  const enabled: string[] = [];

  for (const name of names) {
    const template = getTemplate(name);
    if (!template) {
      console.warn(`Unknown agent template: ${name}`);
      continue;
    }

    const filePath = join(AGENTS_DIR, `${name}.toml`);
    writeFileSync(filePath, template.content);
    enabled.push(name);
  }

  return enabled;
}
