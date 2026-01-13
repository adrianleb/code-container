import type { Agent } from "../agents/types.ts";

export interface CccServerOptions {
  agent: Agent;
}

export function generateCccServer(options: CccServerOptions): string {
  const { agent } = options;
  const skipFlag = agent.skipPermissionsFlag || "";
  const runCmd = agent.runCmd;

  return `#!/bin/bash
# ccc-server - lightweight wrapper for shpool + firewall
# Allows connecting from any SSH client (phone, laptop, etc.)
# Install to ~/bin/ccc-server on the VPS

case "\${1:-}" in
  --no-firewall)
    sudo iptables -F OUTPUT
    shift
    shpool attach -f "\${1:-main}"
    ;;
  --yolo)
    shift
    shpool attach -f yolo -- ${runCmd} ${skipFlag} "$@"
    ;;
  --help|-h)
    cat << 'EOF'
ccc-server - Server-side wrapper for coding container

Usage:
  ccc-server              Attach to main session
  ccc-server <session>    Attach to named session
  ccc-server --no-firewall [session]  Disable firewall for session
  ccc-server --yolo [prompt]          Run with auto-permissions

Detach: Ctrl+Space Ctrl+Q
EOF
    ;;
  *)
    shpool attach -f "\${1:-main}"
    ;;
esac
`;
}
