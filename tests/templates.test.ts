import { expect, test } from "bun:test";
import type { Agent } from "../src/agents/types.ts";
import { generateCompose } from "../src/templates/compose.ts";
import { generateDockerfile } from "../src/templates/dockerfile.ts";
import { generateEntrypoint } from "../src/templates/entrypoint.ts";
import { generateFirewall } from "../src/templates/firewall.ts";

const agentA: Agent = {
  name: "alpha",
  installCmd: "install alpha",
  versionCmd: "alpha --version",
  runCmd: "alpha",
  firewallDomains: ["api.example.com", "registry.example.com"],
  skipPermissionsFlag: "--skip",
  configPath: "/home/ccc/.alpha",
  getAuthInstructions: () => "auth",
  getDockerfileSnippet: () => "RUN install alpha",
};

const agentB: Agent = {
  name: "beta",
  installCmd: "install beta",
  versionCmd: "beta --version",
  runCmd: "beta",
  firewallDomains: ["api.example.com", "other.example.com"],
  getAuthInstructions: () => "auth",
  getDockerfileSnippet: () => "RUN install beta",
};

test("generateCompose includes agent config volume", () => {
  const compose = generateCompose({ agents: [agentA] });
  expect(compose).toContain("- alpha-config:/home/ccc/.alpha");
  expect(compose).toContain("name: ccc-alpha");
});

test("generateFirewall de-duplicates domains", () => {
  const firewall = generateFirewall({ agents: [agentA, agentB] });
  const count = (firewall.match(/api\.example\.com/g) || []).length;
  expect(count).toBe(1);
});

test("generateEntrypoint embeds version command", () => {
  const entrypoint = generateEntrypoint({ agents: [agentA] });
  expect(entrypoint).toContain(agentA.versionCmd);
});

test("generateDockerfile includes agent snippet", () => {
  const dockerfile = generateDockerfile({ agents: [agentA] });
  expect(dockerfile).toContain("RUN install alpha");
});
