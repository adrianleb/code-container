# CCC Project Guidelines

CCC (Coding Container CLI) is a TypeScript/Bun CLI for running AI coding agents in Docker containers with network isolation.

## Development

```bash
bun install        # Install dependencies
bun run dev        # Run in dev mode
bun run build      # Build binary to dist/ccc
```

## Architecture

- **Agents are TOML-based**: No hardcoded agents. All agents (including built-in ones) are defined as TOML configs.
- **Templates generate files**: Dockerfile, compose, entrypoint, firewall scripts are generated from TypeScript templates.
- **Config in ~/.config/ccc/**: Remotes, default agent, agent TOML files.
- **Container files in ~/.ccc/**: Generated Docker files, SSH keys, projects mount.

## Key Files

| File | Purpose |
|------|---------|
| `src/cli.ts` | All CLI commands (Commander.js) |
| `src/agents/loader.ts` | Loads agents from TOML files |
| `src/agents/templates.ts` | Built-in agent templates (embedded) |
| `src/templates/*.ts` | Docker file generators |
| `src/deploy/local.ts` | Local container operations |
| `src/deploy/remote.ts` | Remote SSH operations |

## Adding an Agent

1. Add to `src/agents/templates.ts` (for built-in)
2. Create matching `agents/*.toml` file for reference
3. Required fields: `name`, `install_cmd`, `run_cmd`, `version_cmd`
4. Optional: `config_path`, `skip_permissions_flag`, `[firewall].domains`

## Conventions

- Use Bun APIs (not Node.js equivalents)
- Container user is `ccc`, not root
- All paths use `/home/ccc/` inside container
- Network names: `ccc-net`
- Container name: `ccc`

## Testing

```bash
# Clean slate test
rm -rf ~/.config/ccc ~/.ccc
./dist/ccc init --no-build

# Check generated files
cat ~/.ccc/Dockerfile
cat ~/.ccc/docker-compose.yml
```
