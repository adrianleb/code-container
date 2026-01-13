import type { Agent } from "../agents/types.ts";

export interface EntrypointOptions {
  agents: Agent[];
}

export function generateEntrypoint(options: EntrypointOptions): string {
  const { agents } = options;

  const primaryAgent = agents[0];
  const versionCmd = primaryAgent?.versionCmd || "echo 'no agent'";

  return `#!/bin/bash
set -e

# Initialize firewall (unless DISABLE_FIREWALL=true for research mode)
if [ "$DISABLE_FIREWALL" = "true" ]; then
    echo "RESEARCH MODE: Firewall DISABLED - full web access enabled"
else
    echo "AUTONOMOUS MODE: Initializing firewall..."
    sudo /usr/local/bin/init-firewall.sh || echo "Warning: Firewall init failed"
fi

# Fix SSH key permissions if mounted
if [ -d "$HOME/.ssh" ] && [ "$(ls -A $HOME/.ssh 2>/dev/null)" ]; then
    chmod 700 "$HOME/.ssh" 2>/dev/null || true
    chmod 600 "$HOME/.ssh/"* 2>/dev/null || true
    chmod 644 "$HOME/.ssh/"*.pub 2>/dev/null || true
    chmod 644 "$HOME/.ssh/config" 2>/dev/null || true
fi

# Configure git if vars provided
[ -n "$GIT_USER_NAME" ] && git config --global user.name "$GIT_USER_NAME"
[ -n "$GIT_USER_EMAIL" ] && git config --global user.email "$GIT_USER_EMAIL"

# Git config for delta
git config --global core.pager "delta"
git config --global interactive.diffFilter "delta --color-only"
git config --global delta.navigate true
git config --global delta.side-by-side true
git config --global merge.conflictstyle diff3
git config --global diff.colorMoved default

echo "Container ready. Agent version: $(${versionCmd} 2>/dev/null || echo not found)"
exec "$@"
`;
}
