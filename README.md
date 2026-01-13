<p align="center">
  <h1 align="center">CCC</h1>
  <p align="center">
    <strong>Coding Container CLI</strong><br>
    Run AI coding agents in isolated Docker containers
  </p>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#contributing">Contributing</a>
</p>

---

CCC makes it easy to run AI coding agents (Claude, Codex, Gemini) in secure, isolated Docker containers. Run locally or on a remote server, and connect from your laptop, phone, or Telegram.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Laptop ──────┐                                                │
│   Phone ───────┼──► Tailscale ──► VPS ──► Docker ──► Agents    │
│   Telegram ────┘                           │                    │
│                                        Firewall                 │
│                                    (API access only)            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Features

- **Network Isolation** — Firewall blocks all traffic except agent APIs
- **Persistent Sessions** — Powered by [shpool](https://github.com/shell-pool/shpool), sessions survive disconnects
- **Multi-Agent** — Claude, Codex, Gemini, or bring your own
- **Remote Hosting** — Deploy to any VPS, manage multiple hosts
- **Mobile Access** — Connect via SSH + Tailscale using `ccc-server`
- **Telegram Bot** — Chat with agents via [takopi](https://github.com/AbanteAI/takopi)

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/adrianleb/ccc/main/install.sh | sh
```

<details>
<summary>Build from source</summary>

```bash
git clone https://github.com/adrianleb/ccc.git
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
# Initialize - select agents, generate config
ccc init

# Build the container
ccc build

# Start the container
ccc start

# Connect
ccc
```

## Usage

```bash
ccc                       # Connect to main session
ccc work                  # Connect to named session
ccc --no-firewall         # Disable network restrictions
ccc --yolo "fix bugs"     # Auto-approve agent actions
```

### Session Management

CCC uses [shpool](https://github.com/shell-pool/shpool) for persistent terminal sessions.

| Command | Description |
|---------|-------------|
| `ccc` | Attach to main session |
| `ccc <name>` | Attach to named session |
| `ccc ls` | List sessions |
| `ccc kill <name>` | Kill session |
| `Ctrl+Space Ctrl+Q` | Detach from session |

### Container Management

| Command | Description |
|---------|-------------|
| `ccc build` | Build/rebuild container |
| `ccc start` | Start container |
| `ccc restart` | Restart container |
| `ccc logs` | View logs |
| `ccc update` | Update agents |

## Agents

Select agents during `ccc init`:

```
[1] claude  - Claude Code by Anthropic
[2] codex   - Codex CLI by OpenAI
[3] gemini  - Gemini CLI by Google
[a] All
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
```

## Remote Servers

Run CCC on a VPS and connect from anywhere.

```bash
# Add remote
ccc remote add vps user@192.168.1.100

# Initialize on remote
ccc init @vps

# Connect
ccc @vps
```

| Command | Description |
|---------|-------------|
| `ccc remote add <name> <host>` | Add remote |
| `ccc remote ls` | List remotes |
| `ccc remote rm <name>` | Remove remote |
| `ccc remote default <name>` | Set default |

## Mobile Access

### ccc-server

When you run `ccc init` on a remote host, CCC installs `ccc-server` — a lightweight wrapper that handles session attachment and firewall control. This lets you connect from any SSH client without needing CCC installed.

```bash
# From any device with SSH
ssh user@vps "~/bin/ccc-server"

# With options
ssh user@vps "~/bin/ccc-server --no-firewall"
ssh user@vps "~/bin/ccc-server work"  # named session
```

### Tailscale Setup

Generate an SSH config for easy access:

```bash
ccc setup-tailscale --ip 100.x.x.x --user ubuntu --host myvps
```

Add to `~/.ssh/config` on any device:

```
Host myvps
    HostName 100.x.x.x
    User ubuntu
    RemoteCommand ~/bin/ccc-server
    RequestTTY yes
```

Then connect with: `ssh myvps`

Works with iOS/Android SSH apps (Blink, Termius, Prompt).

## Telegram Bot

Integrate with [takopi](https://github.com/banteg/takopi) to chat with agents via Telegram:

```bash
ccc setup-takopi --token BOT_TOKEN --chat-id CHAT_ID
```

## Configuration

```
~/.config/ccc/
├── config.toml        # Remotes, defaults
└── agents/            # Agent definitions
    ├── claude.toml
    ├── codex.toml
    └── gemini.toml

~/.ccc/
├── Dockerfile
├── docker-compose.yml
├── ssh-keys/          # Add public key to GitHub
└── projects/          # Mounted at /workspace
```

## Documentation

| Topic | Description |
|-------|-------------|
| [Installation](#installation) | Install CCC |
| [Quick Start](#quick-start) | Get running in 60 seconds |
| [Agents](#agents) | Configure coding agents |
| [Remote Servers](#remote-servers) | Deploy to VPS |
| [Mobile Access](#mobile-access) | Connect from phone |

## Contributing

```bash
git clone https://github.com/adrianleb/ccc.git
cd ccc
bun install
bun run build
./dist/ccc --help
```

### Project Structure

```
src/
├── cli.ts           # Commands
├── config.ts        # Config management
├── agents/          # Agent loader & templates
├── templates/       # Dockerfile, compose generators
├── deploy/          # Local & remote deployment
└── utils/           # Helpers
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT © 2026

---

<p align="center">
  <a href="https://github.com/adrianleb/ccc/issues">Issues</a> •
  <a href="https://github.com/adrianleb/ccc/discussions">Discussions</a>
</p>
