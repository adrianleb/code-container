import type { Agent } from "../agents/types.ts";
import type { Extension } from "../extensions/types.ts";

export interface EntrypointOptions {
  agents: Agent[];
  extensions?: Extension[];
}

export function generateEntrypoint(options: EntrypointOptions): string {
  const { agents, extensions = [] } = options;

  // Generate install checks for each agent
  const agentInstalls = agents
    .map((agent) => {
      // Escape single quotes in commands
      const versionCmd = agent.versionCmd.replace(/'/g, "'\\''");
      const installCmd = agent.installCmd.replace(/'/g, "'\\''");
      return `
# Install ${agent.name} if not present
if ! ${versionCmd} &>/dev/null; then
    echo "Installing ${agent.name}..."
    ${installCmd} || echo "Warning: Failed to install ${agent.name}"
fi`;
    })
    .join("\n");

  // Generate skill symlinks for each agent
  const skillsSetup = agents
    .filter((agent) => agent.skills)
    .map((agent) => {
      const skillsPath = agent.skills!.path;
      return `
# Setup skills symlink for ${agent.name}
SKILLS_PATH="$HOME/${skillsPath}"
if [ ! -L "$SKILLS_PATH" ]; then
    mkdir -p "$(dirname "$SKILLS_PATH")"
    mkdir -p "$HOME/.ccc/skills"
    ln -sf "$HOME/.ccc/skills" "$SKILLS_PATH" 2>/dev/null || true
fi`;
    })
    .join("\n");

  // Generate MCP config sync commands for each agent
  const mcpSetup = agents
    .filter((agent) => agent.mcp && agent.mcp.format !== "codex")
    .map((agent) => {
      const mcpConfigPath = agent.mcp!.configPath;
      const format = agent.mcp!.format;
      const mergeExpr =
        format === "opencode"
          ? ".[0] as $dest | .[1] as $src | $dest + {mcp: ($src.mcp // {})}"
          : ".[0] as $dest | .[1] as $src | $dest + {mcpServers: ($src.mcpServers // {})}";
      return `
# Setup MCP config for ${agent.name}
MCP_SOURCE="$HOME/.ccc/mcp-configs/${agent.name}.json"
MCP_DEST="$HOME/${mcpConfigPath}"
if [ -f "$MCP_SOURCE" ]; then
    mkdir -p "$(dirname "$MCP_DEST")"
    if [ -f "$MCP_DEST" ] && command -v jq &>/dev/null; then
        jq -s '${mergeExpr}' "$MCP_DEST" "$MCP_SOURCE" > "$MCP_DEST.tmp" && mv "$MCP_DEST.tmp" "$MCP_DEST"
    else
        cp "$MCP_SOURCE" "$MCP_DEST"
    fi
else
    rm -f "$MCP_DEST"
fi`;
    })
    .join("\n");

  // Generate host extension install and start commands
  const hostExtensions = extensions.filter((ext) => ext.type === "host");
  const hostExtensionSetup = hostExtensions
    .map((ext) => {
      const installCmd = ext.installCmd || "";
      const runCmd = ext.runCmd || "";
      const binaryName = runCmd.split(" ")[0]?.split("/").pop() || ext.name;

      if (!runCmd) return "";

      return `
# Setup ${ext.name} extension
if [ "$DISABLE_EXTENSIONS" != "true" ]; then
    ${installCmd ? `# Install ${ext.name} if not present\n    if ! command -v ${binaryName} &>/dev/null; then\n        echo "Installing ${ext.name}..."\n        ${installCmd} || echo "Warning: Failed to install ${ext.name}"\n    fi` : ""}
    # Start ${ext.name} if not running
    if ! pgrep -f "${binaryName}" >/dev/null 2>&1; then
        echo "Starting ${ext.name}..."
        nohup ${runCmd} >/dev/null 2>&1 &
    fi
fi`;
    })
    .filter(Boolean)
    .join("\n");

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

# Setup XDG_RUNTIME_DIR for shpool
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
sudo mkdir -p "$XDG_RUNTIME_DIR"
sudo chown $(id -u):$(id -g) "$XDG_RUNTIME_DIR"
sudo chmod 700 "$XDG_RUNTIME_DIR"

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

# Install agents on first run (into persistent volume)
${agentInstalls}

# Setup skills symlinks
${skillsSetup}

# Setup MCP configs (sync from host-managed configs)
${mcpSetup}

# Setup and start host extensions
${hostExtensionSetup}

echo "Container ready. Agent version: $(${versionCmd} 2>/dev/null || echo not found)"
exec "$@"
`;
}
