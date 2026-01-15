import type { Agent } from "../agents/types.ts";
import type { Extension } from "../extensions/types.ts";
import { generateDockerfile } from "../templates/dockerfile.ts";
import { generateCompose } from "../templates/compose.ts";
import { generateEntrypoint } from "../templates/entrypoint.ts";
import { generateFirewall } from "../templates/firewall.ts";

export interface GenerateFilesOptions {
  agents: Agent[];
  containerName?: string;
  timezone?: string;
  projectsDir?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  extensions?: Extension[];
  userFirewallDomains?: string[];
}

export interface GeneratedFiles {
  dockerfile: string;
  compose: string;
  entrypoint: string;
  firewall: string;
}

/**
 * Generate all container configuration files as strings.
 * This is the shared logic used by both local and remote deployments.
 */
export function generateContainerFiles(options: GenerateFilesOptions): GeneratedFiles {
  const {
    agents,
    containerName = "ccc",
    timezone = "UTC",
    projectsDir = "./projects",
    gitUserName,
    gitUserEmail,
    extensions = [],
    userFirewallDomains = [],
  } = options;

  return {
    dockerfile: generateDockerfile({ agents, timezone }),
    compose: generateCompose({ containerName, timezone, projectsDir, agents, gitUserName, gitUserEmail }),
    entrypoint: generateEntrypoint({ agents, extensions }),
    firewall: generateFirewall({ agents, extensions, userDomains: userFirewallDomains }),
  };
}
