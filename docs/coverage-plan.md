# Test and Coverage Plan

## Goals
- Catch regressions in config resolution, template generation, and agent wiring.
- Validate CLI command routing without invoking Docker or SSH.
- Build confidence in local/remote deploy workflows via targeted integration tests.

## Current Coverage
- Unit tests for `src/config.ts`, `src/templates/*.ts`, `src/agents/*`, and CLI routing.
- Deploy helper command composition tests for local and remote paths.

## Plan
1. CLI parsing and routing
   - Exercise `createCLI()` with mocked deploy functions.
   - Cover default attach, `build`, `start`, `update`, and remote target parsing.
2. Deploy helpers
   - Local: mock `spawn`/`execSync` to validate commands and error paths.
   - Remote: mock `sshExec`/`scp*` to verify command composition and quoting.
3. Templates
   - Assert output for each agent template and config path handling.
   - Validate firewall allowlist output for overlapping domains.
4. Config edge cases
   - Aliases with and without `@`.
   - Invalid host values should exit early.
   - Default target resolution when config is missing or malformed.
5. Integration (optional, remaining)
   - Run `ccc init` in a temp dir, build and start a container, then list sessions.
   - Gate behind an environment flag so CI stays fast and Docker-free by default.

## Coverage Targets
- `src/config.ts`: 85%+ statement coverage.
- `src/templates/*.ts`: 85%+ statement coverage.
- `src/agents/*.ts`: 70%+ statement coverage.
- Overall: 70%+ statement, 60%+ branch coverage.

## Commands
- `bun test`
- `bun test --coverage`
