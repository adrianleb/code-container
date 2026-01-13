import { expect, test, mock } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

mock.restore();

let currentHome = "";
mock.module("os", () => ({
  homedir: () => currentHome,
}));

test("getAvailableTemplates includes core agents", async () => {
  const templates = await import("../src/agents/templates.ts");
  const names = templates.getAvailableTemplates().map((t) => t.name).sort();
  expect(names).toEqual(["claude", "codex", "gemini", "opencode"]);
});

test("loadAgents reads TOML config", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "ccc-agents-"));
  currentHome = tempHome;

  const agentsDir = join(tempHome, ".config", "ccc", "agents");
  mkdirSync(agentsDir, { recursive: true });

  writeFileSync(
    join(agentsDir, "alpha.toml"),
    `name = "alpha"
install_cmd = "install alpha"
run_cmd = "alpha"
version_cmd = "alpha --version"

[firewall]
domains = ["api.alpha.test"]
`
  );

  const loader = await import(`../src/agents/loader.ts?${Date.now()}`);
  const agents = loader.loadAgents();
  expect(agents.alpha).toBeTruthy();
  expect(agents.alpha.firewallDomains).toEqual(["api.alpha.test"]);
});
