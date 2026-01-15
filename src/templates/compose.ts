import type { Agent } from "../agents/types.ts";

export interface ComposeOptions {
  containerName?: string;
  timezone?: string;
  projectsDir?: string;
  agents?: Agent[];
  gitUserName?: string;
  gitUserEmail?: string;
}

export function generateCompose(options: ComposeOptions = {}): string {
  const {
    containerName = "ccc",
    timezone = "UTC",
    projectsDir = "./projects",
    gitUserName = "",
    gitUserEmail = "",
  } = options;

  return `services:
  ${containerName}:
    build:
      context: .
      args:
        TZ: ${timezone}
    container_name: ${containerName}
    hostname: ${containerName}
    restart: unless-stopped

    # Required for firewall
    cap_add:
      - NET_ADMIN

    environment:
      - GIT_USER_NAME=${gitUserName}
      - GIT_USER_EMAIL=${gitUserEmail}
      - NODE_OPTIONS=--max-old-space-size=4096

    volumes:
      # Projects directory - clone repos here
      - ${projectsDir}:/workspace:rw

      # Home directory persistence (all user data, configs, auth)
      - ccc-home:/home/ccc

      # SSH keys for GitHub (overrides home volume for .ssh)
      - ./ssh-keys:/home/ccc/.ssh:ro

      # Skills directory (shared across agents)
      - ./skills:/home/ccc/.ccc/skills:ro

      # MCP configs (per-agent configs injected by ccc)
      - ./mcp-configs:/home/ccc/.ccc/mcp-configs:ro

    # Keep container running
    tty: true
    stdin_open: true

    networks:
      - ccc-net

volumes:
  ccc-home:
    name: ${containerName}-home

networks:
  ccc-net:
    driver: bridge
`;
}
