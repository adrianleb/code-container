# Code Container CLI

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
[1] claude    - Claude Code by Anthropic
[2] codex     - Codex CLI by OpenAI
[3] gemini    - Gemini CLI by Google
[4] opencode  - OpenCode (open source, multi-provider)
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

Connect to your coding agents from any device with SSH — phone, tablet, or laptop.

### ccc-server

When you run `ccc init` on a remote host, CCC installs `ccc-server` — a lightweight wrapper that handles session attachment and firewall control. Connect from any SSH client without needing CCC installed.

```bash
# On your VPS (via SSH)
ccc-server              # Attach to main session
ccc-server work         # Attach to named session
ccc-server --no-firewall        # Disable firewall
ccc-server --yolo "fix bugs"    # Auto-approve mode
```

**Detach:** `Ctrl+Space` then `Ctrl+Q`

### SSH Config

Add to `~/.ssh/config` for one-command access:

```ssh-config
Host ccc
    HostName your-vps-ip
    User ubuntu
    RemoteCommand ~/bin/ccc-server
    RequestTTY yes
```

Then just: `ssh ccc`

<details>
<summary><strong>Multiple sessions</strong></summary>

```ssh-config
Host ccc
    HostName your-vps-ip
    User ubuntu
    RemoteCommand ~/bin/ccc-server
    RequestTTY yes

Host ccc-work
    HostName your-vps-ip
    User ubuntu
    RemoteCommand ~/bin/ccc-server work
    RequestTTY yes

Host ccc-yolo
    HostName your-vps-ip
    User ubuntu
    RemoteCommand ~/bin/ccc-server --yolo
    RequestTTY yes
```

</details>

### Mobile Apps

Any SSH app works. Set the "startup command" or "remote command" to `~/bin/ccc-server`.

| App | Platform | Notes |
|-----|----------|-------|
| [Blink](https://blink.sh) | iOS | Best iOS terminal, Mosh support |
| [Termius](https://termius.com) | iOS/Android | Cross-platform, free tier |
| [Prompt](https://panic.com/prompt/) | iOS | Clean UI |

### Optional: Tailscale

[Tailscale](https://tailscale.com) gives your VPS a stable IP accessible from anywhere without port forwarding.

<details>
<summary><strong>Setup</strong></summary>

```bash
# On VPS
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
tailscale ip -4  # Get your 100.x.x.x IP
```

Install Tailscale on your devices and sign in with the same account.

</details>

### Optional: Mosh

[Mosh](https://mosh.org) handles spotty WiFi/cellular better than SSH.

<details>
<summary><strong>Setup</strong></summary>

```bash
# On VPS
sudo apt install mosh
sudo ufw allow 60000:61000/udp

# Connect
mosh user@your-vps -- ~/bin/ccc-server
```

</details>

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
    ├── gemini.toml
    └── opencode.toml

~/.ccc/
├── Dockerfile
├── docker-compose.yml
├── ssh-keys/          # Add public key to GitHub
└── projects/          # Mounted at /workspace
```

## Contributing

```bash
git clone https://github.com/adrianleb/ccc.git
cd ccc
bun install
bun run build
./dist/ccc --help
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT © 2026
