# CCC — Code Container CLI

Run AI coding agents locally or remotely in Docker containers with persistent sessions and network isolation.

---

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│  LOCAL:   Laptop ─────────────────────────┐                            │
│           Telegram ───────────────────────┼──► Docker ──► Agents       │
│           Phone ──► Tailscale ────────────┘       │                    │
│                                               Firewall                 │
│                                           (API access only)            │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  REMOTE:  Laptop ───────┐                                              │
│           Phone ────────┼──► Tailscale ──► VPS ──► Docker ──► Agents   │
│           Telegram ─────┘                             │                │
│                                                   Firewall             │
│                                               (API access only)        │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Features

- **Network Isolation** — Firewall blocks all traffic except agent APIs
- **Persistent Sessions** — Powered by [shpool](https://github.com/shell-pool/shpool), sessions survive disconnects
- **Multi-Agent** — Claude, Codex, Gemini, OpenCode, or bring your own
- **Remote Hosting** — Deploy to any VPS, manage multiple hosts with `@host` prefix
- **Extensions** — MCP servers, agent skills, and host services (Telegram bot)
- **Mobile Access** — Connect via SSH + Tailscale from any device

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/adrianleb/code-container/master/install.sh | sh
```

<details>
<summary>Build from source</summary>

```bash
git clone https://github.com/adrianleb/code-container.git
cd ccc
bun install
bun run build
cp dist/ccc ~/.local/bin/
```

Requires [Bun](https://bun.sh) v1.0+

</details>

### Requirements

- macOS or Linux
- [Docker](https://docs.docker.com/get-docker/)

## Quick Start

```bash
# Initialize - select agents, configure git
ccc init

# Connect to container
ccc
```

## Usage

### Sessions

```bash
ccc                       # Attach to main session
ccc work                  # Attach to named session
ccc --no-firewall         # Disable network restrictions
ccc --yolo "fix bugs"     # Auto-approve agent actions
```

| Command | Description |
|---------|-------------|
| `ccc` | Attach to main session |
| `ccc <name>` | Attach to named session |
| `ccc ls` | List all hosts and sessions |
| `ccc kill <name>` | Kill session |
| `Ctrl+Space Ctrl+Q` | Detach from session |

### Container

| Command | Description |
|---------|-------------|
| `ccc status` | Overview of all hosts, agents, sessions |
| `ccc build` | Build/rebuild container |
| `ccc start` | Start container |
| `ccc restart` | Restart container |
| `ccc logs` | View container logs |

---

## Remote Servers

Run CCC on a VPS and connect from anywhere. All commands support the `@host` prefix.

```bash
# Add a remote host
ccc remote add vps user@192.168.1.100

# Initialize container on remote
ccc @vps init

# Run any command on remote
ccc @vps build
ccc @vps agent ls
ccc @vps firewall ls

# Connect to remote session
ccc @vps
```

### Remote Commands

The `@host` prefix works with any command:

```bash
ccc @myserver status          # Check remote status
ccc @myserver build           # Build on remote
ccc @myserver start           # Start remote container
ccc @myserver ls              # List remote sessions
ccc @myserver kill main       # Kill remote session
ccc @myserver agent ls        # List agents on remote
ccc @myserver firewall ls     # List firewall rules on remote
ccc @myserver extension ls    # List extensions on remote
```

### Managing Remotes

| Command | Description |
|---------|-------------|
| `ccc remote add <name> <user@host>` | Add remote |
| `ccc remote ls` | List remotes |
| `ccc remote rm <name>` | Remove remote |
| `ccc remote default @name` | Set default target |

---

## Agents

### Built-in Agents

| Agent | Description |
|-------|-------------|
| `claude` | Claude Code by Anthropic |
| `codex` | Codex CLI by OpenAI |
| `gemini` | Gemini CLI by Google |
| `opencode` | OpenCode (multi-provider) |

### Agent Management

```bash
ccc agent ls                  # List agents with status
ccc agent add claude          # Add and configure agent
ccc agent add codex --no-build  # Add without rebuilding
ccc agent auth claude         # Run auth flow
ccc agent default claude      # Set default agent
ccc agent rm codex            # Remove agent
```

### Custom Agents

Create a TOML file in `~/.config/ccc/agents/`:

```toml
name = "myagent"
install_cmd = "npm install -g myagent"
run_cmd = "myagent"
version_cmd = "myagent --version"
config_path = "/home/ccc/.myagent"

[firewall]
domains = ["api.myagent.com"]

[auth]
check_cmd = "test -f /home/ccc/.myagent/config"
instructions = "Run 'myagent login' to authenticate"
```

---

## Extensions

CCC supports three types of extensions:

| Type | Description | Example |
|------|-------------|---------|
| **Host** | Services running on the host machine | takopi (Telegram bot) |
| **MCP** | Model Context Protocol servers | context7 (documentation) |
| **Skill** | Agent skill definitions | code-review |

### Extension Commands

```bash
ccc extension ls              # List all extensions
ccc extension add context7    # Enable extension
ccc extension rm context7     # Disable extension
ccc extension start takopi    # Start host extension
ccc extension stop takopi     # Stop host extension
```

### Telegram Bot (takopi)

Chat with your agents via Telegram using [takopi](https://github.com/banteg/takopi):

```bash
# Enable the extension
ccc extension add takopi

# Configure with your bot credentials
ccc setup-takopi --token BOT_TOKEN --chat-id CHAT_ID
```

---

## Firewall

The container firewall only allows traffic to configured domains.

```bash
ccc firewall ls               # List all allowed domains
ccc firewall add example.com  # Add custom domain
ccc firewall rm example.com   # Remove custom domain
```

Domains are grouped by source:
- **Agents** — API endpoints for each agent
- **Extensions** — Domains required by extensions
- **User** — Custom domains you've added

After modifying firewall rules, rebuild the container:
```bash
ccc build
```

---

## Mobile Access

Connect to your coding agents from any device with SSH.

### SSH Config

Add to `~/.ssh/config` for one-command access:

```ssh-config
Host ccc
    HostName your-vps-ip
    User ubuntu
    RemoteCommand ~/bin/ccc
    RequestTTY yes

Host ccc-work
    HostName your-vps-ip
    User ubuntu
    RemoteCommand ~/bin/ccc work
    RequestTTY yes
```

Then: `ssh ccc`

### Mobile Apps

Any SSH app works. Set remote command to `~/bin/ccc`.

| App | Platform | Notes |
|-----|----------|-------|
| [Blink](https://blink.sh) | iOS | Best iOS terminal |
| [Termius](https://termius.com) | iOS/Android | Cross-platform |
| [Prompt](https://panic.com/prompt/) | iOS | Clean UI |

### Tailscale (Recommended)

[Tailscale](https://tailscale.com) provides a stable IP accessible from anywhere:

```bash
# On VPS
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
```

---

## Configuration

```
~/.config/ccc/
├── config.toml           # Remotes, defaults
├── agents/               # Agent definitions (TOML)
├── extensions/           # Extension definitions (TOML)
└── firewall.toml         # Custom firewall domains

~/.ccc/
├── Dockerfile            # Generated
├── docker-compose.yml    # Generated
├── ssh-keys/             # Container SSH key (add to GitHub)
├── projects/             # Mounted at /workspace in container
├── skills/               # Agent skill files
└── mcp-configs/          # MCP server configurations
```

---

## Command Reference

### Core Commands

| Command | Description |
|---------|-------------|
| `ccc` | Attach to main session |
| `ccc <session>` | Attach to named session |
| `ccc init` | Initialize container |
| `ccc build` | Build container |
| `ccc start` | Start container |
| `ccc restart` | Restart container |
| `ccc status` | Show all hosts status |
| `ccc ls` | List sessions |
| `ccc logs` | Show container logs |
| `ccc kill <session>` | Kill session |
| `ccc update` | Update agent binaries |

### Agent Commands

| Command | Description |
|---------|-------------|
| `ccc agent ls` | List agents |
| `ccc agent add <name>` | Add agent |
| `ccc agent rm <name>` | Remove agent |
| `ccc agent auth <name>` | Authenticate agent |
| `ccc agent default [name]` | Get/set default |

### Extension Commands

| Command | Description |
|---------|-------------|
| `ccc extension ls` | List extensions |
| `ccc extension add <name>` | Enable extension |
| `ccc extension rm <name>` | Disable extension |
| `ccc extension start <name>` | Start host extension |
| `ccc extension stop <name>` | Stop host extension |

### Firewall Commands

| Command | Description |
|---------|-------------|
| `ccc firewall ls` | List domains |
| `ccc firewall add <domain>` | Add domain |
| `ccc firewall rm <domain>` | Remove domain |

### Remote Commands

| Command | Description |
|---------|-------------|
| `ccc remote add <name> <host>` | Add remote |
| `ccc remote ls` | List remotes |
| `ccc remote rm <name>` | Remove remote |
| `ccc remote default <target>` | Set default |

### Setup Commands

| Command | Description |
|---------|-------------|
| `ccc setup-ssh` | Generate SSH key |
| `ccc setup-takopi` | Configure Telegram bot |

---

## Contributing

```bash
git clone https://github.com/adrianleb/code-container.git
cd ccc
bun install
bun run build
./dist/ccc --help
```

## License

MIT
