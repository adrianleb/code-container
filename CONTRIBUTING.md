# Contributing to CCC

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/adrianleb/ccc.git
cd ccc
bun install
```

## Building

```bash
bun run build        # Build binary to dist/ccc
bun run dev          # Run in dev mode
```

## Testing Changes

```bash
# Clean test environment
rm -rf ~/.config/ccc ~/.ccc

# Test init flow
./dist/ccc init --no-build

# Verify generated files
cat ~/.ccc/Dockerfile
cat ~/.ccc/docker-compose.yml
```

## Project Structure

```
src/
├── cli.ts              # CLI commands (Commander.js)
├── config.ts           # Config file management
├── index.ts            # Entry point
├── agents/
│   ├── loader.ts       # Loads agents from TOML
│   ├── templates.ts    # Built-in agent templates
│   └── types.ts        # TypeScript interfaces
├── templates/
│   ├── dockerfile.ts   # Dockerfile generator
│   ├── compose.ts      # docker-compose.yml generator
│   ├── entrypoint.ts   # entrypoint.sh generator
│   ├── firewall.ts     # Firewall script generator
│   └── ccc-server.ts   # Remote access wrapper
├── deploy/
│   ├── local.ts        # Local Docker operations
│   └── remote.ts       # Remote SSH operations
└── utils/
    ├── ui.ts           # Terminal UI helpers
    └── checks.ts       # Requirement checks
```

## Adding a New Agent

1. Add the template to `src/agents/templates.ts`
2. Create a reference TOML file in `agents/`
3. Test with `ccc init` and verify installation

## Submitting Changes

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Ensure `bun run build` succeeds
5. Submit a pull request

## Code Style

- Use TypeScript
- Prefer Bun APIs over Node.js equivalents
- Keep functions focused and small
- Add comments for non-obvious logic

## Questions?

Open an issue or start a discussion on GitHub.
