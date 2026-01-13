import { beforeEach, afterEach, expect, test } from "bun:test";
import type { Agent } from "../src/agents/types.ts";

const calls = {
  execSync: [] as Array<{ cmd: string; opts: unknown }>,
  spawn: [] as Array<{ cmd: string; args: string[] }>,
};

const { attachSession, childProcess } = await import(`../src/deploy/local.ts?${Date.now()}`);
const originalExecSync = childProcess.execSync;
const originalSpawn = childProcess.spawn;

const agent: Agent = {
  name: "codex",
  installCmd: "install",
  versionCmd: "codex --version",
  runCmd: "codex",
  firewallDomains: [],
  skipPermissionsFlag: "--skip",
  getAuthInstructions: () => "auth",
  getDockerfileSnippet: () => "RUN install codex",
};

beforeEach(() => {
  calls.execSync.length = 0;
  calls.spawn.length = 0;
  childProcess.execSync = (cmd: string, opts: unknown) => {
    calls.execSync.push({ cmd, opts });
    return "";
  };
  childProcess.spawn = (cmd: string, args: string[]) => {
    calls.spawn.push({ cmd, args });
    return {
      on: () => {},
    };
  };
});

afterEach(() => {
  childProcess.execSync = originalExecSync;
  childProcess.spawn = originalSpawn;
});

test("attachSession flushes firewall when noFirewall is set", () => {
  attachSession("ccc", "main", { noFirewall: true });
  expect(calls.execSync).toHaveLength(1);
  expect(calls.execSync[0]!.cmd).toContain("iptables -F OUTPUT");
});

test("attachSession builds yolo command with prompt", () => {
  attachSession("ccc", "main", { yolo: true, prompt: "fix", agent });
  expect(calls.spawn).toHaveLength(1);
  expect(calls.spawn[0]).toEqual(
    expect.objectContaining({
      cmd: "docker",
      args: expect.arrayContaining([
        "exec",
        "-it",
        "ccc",
        "shpool",
        "attach",
        "-f",
        "main",
        "--",
        "codex",
        "--skip",
        "-p",
        "fix",
      ]),
    })
  );
});
