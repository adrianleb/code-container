import type { Agent } from "../agents/types.ts";

export interface ComposeOptions {
  containerName?: string;
  timezone?: string;
  projectsDir?: string;
  agents?: Agent[];
}

export function generateCompose(options: ComposeOptions = {}): string {
  const {
    containerName = "ccc",
    timezone = "UTC",
    projectsDir = "./projects",
    agents = [],
  } = options;

  const agentVolumeMounts: string[] = [];
  const agentVolumeDefinitions: string[] = [];

  for (const agent of agents) {
    if (agent.configPath) {
      const volumeName = `${agent.name}-config`;
      agentVolumeMounts.push(`      # ${agent.name} auth/config persistence`);
      agentVolumeMounts.push(`      - ${volumeName}:${agent.configPath}`);
      agentVolumeDefinitions.push(`  ${volumeName}:`);
      agentVolumeDefinitions.push(`    name: ${containerName}-${agent.name}`);
    }
  }

  const agentVolumeMountsStr = agentVolumeMounts.length > 0
    ? "\n" + agentVolumeMounts.join("\n")
    : "";

  const agentVolumeDefsStr = agentVolumeDefinitions.length > 0
    ? "\n" + agentVolumeDefinitions.join("\n")
    : "";

  return `services:
  ${containerName}:
    build:
      context: .
      args:
        TZ: \${TZ:-${timezone}}
    container_name: ${containerName}
    hostname: ${containerName}
    restart: unless-stopped

    # Required for firewall
    cap_add:
      - NET_ADMIN

    environment:
      - GIT_USER_NAME=\${GIT_USER_NAME}
      - GIT_USER_EMAIL=\${GIT_USER_EMAIL}
      - TELEGRAM_BOT_TOKEN=\${TELEGRAM_BOT_TOKEN:-}
      - NODE_OPTIONS=--max-old-space-size=4096

    volumes:
      # Projects directory - clone repos here
      - ${projectsDir}:/workspace:rw

      # Command history persistence
      - command-history:/commandhistory

      # SSH keys for GitHub (generate dedicated key)
      - ./ssh-keys:/home/ccc/.ssh:ro

      # Takopi config persistence
      - takopi-config:/home/ccc/.takopi
${agentVolumeMountsStr}

    # Keep container running
    tty: true
    stdin_open: true

    networks:
      - ccc-net

volumes:
  command-history:
    name: ${containerName}-history
  takopi-config:
    name: ${containerName}-takopi
${agentVolumeDefsStr}

networks:
  ccc-net:
    driver: bridge
`;
}
