import { expect, test, beforeEach, afterAll, mock } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const calls = {
  attachSession: [] as Array<{ container: string; session: string; options: unknown }>,
  attachRemote: [] as Array<{ host: string; session: string; options: unknown }>,
  listSessions: [] as string[],
  listRemoteSessions: [] as string[],
  addRemote: [] as Array<[string, string, string[] | undefined]>,
  setDefault: [] as string[],
  setDefaultAgent: [] as string[],
  buildContainer: [] as string[],
  startContainer: [] as string[],
  execSync: [] as string[],
};

const agent = {
  name: "codex",
  installCmd: "install codex",
  versionCmd: "codex --version",
  runCmd: "codex",
  firewallDomains: [],
  skipPermissionsFlag: "--skip",
  getAuthInstructions: () => "auth",
  getDockerfileSnippet: () => "RUN install codex",
};

const remotes = new Map<string, { host: string; alias?: string[] }>();
const configState = {
  default: "local",
  default_agent: undefined as string | undefined,
};

mock.restore();
mock.module("../src/agents/loader.ts", () => ({
  loadAgents: () => ({ codex: agent }),
  listAvailableAgents: () => [],
  enableAgents: () => [],
  getAgentsDir: () => "/tmp/ccc/agents",
}));

mock.module("../src/utils/checks.ts", () => ({
  requireDocker: () => {},
  requireContainer: () => {},
  requireContainerRunning: () => {},
}));

mock.module("../src/config.ts", () => ({
  loadConfig: () => ({
    default: configState.default,
    default_agent: configState.default_agent,
    remotes: Object.fromEntries(remotes),
  }),
  addRemote: (name: string, host: string, aliases?: string[]) => {
    remotes.set(name, { host, alias: aliases });
    calls.addRemote.push([name, host, aliases]);
  },
  removeRemote: (name: string) => remotes.delete(name),
  setDefault: (target: string) => {
    configState.default = target;
    calls.setDefault.push(target);
  },
  listRemotes: () => Object.fromEntries(remotes),
  getDefault: () => configState.default,
  getDefaultAgent: () => configState.default_agent,
  setDefaultAgent: (agentName: string) => {
    configState.default_agent = agentName;
    calls.setDefaultAgent.push(agentName);
  },
  resolveTarget: (target?: string) => {
    if (!target || target === "local") return null;
    if (target === "@vps") return "user@host";
    if (target.startsWith("@")) return null;
    return target;
  },
}));

mock.module("../src/deploy/local.ts", () => ({
  generateFiles: () => {},
  generateContainerSSHKeys: async () => "",
  buildContainer: async (outputDir: string) => {
    calls.buildContainer.push(outputDir);
  },
  startContainer: async (outputDir: string) => {
    calls.startContainer.push(outputDir);
  },
  attachSession: (container: string, session: string, options: unknown) => {
    calls.attachSession.push({ container, session, options });
  },
  listSessions: (container: string) => {
    calls.listSessions.push(container);
  },
  killSession: () => {},
  showLogs: () => {},
  restartContainer: () => {},
}));

mock.module("../src/deploy/remote.ts", () => ({
  initRemote: async () => {},
  buildRemote: async () => {},
  startRemote: async () => {},
  attachRemote: (host: string, session: string, options: unknown) => {
    calls.attachRemote.push({ host, session, options });
  },
  listRemoteSessions: (host: string) => {
    calls.listRemoteSessions.push(host);
  },
  killRemoteSession: () => {},
  showRemoteLogs: () => {},
  restartRemote: () => {},
  sshExec: () => "",
}));

const childProcessMock = () => ({
  execSync: (cmd: string) => {
    calls.execSync.push(cmd);
  },
  spawn: () => ({
    on: () => {},
  }),
  spawnSync: () => ({ status: 0 }),
});

mock.module("child_process", childProcessMock);
mock.module("node:child_process", childProcessMock);

const { createCLI } = await import("../src/cli.ts");

beforeEach(() => {
  calls.attachSession.length = 0;
  calls.attachRemote.length = 0;
  calls.listSessions.length = 0;
  calls.listRemoteSessions.length = 0;
  calls.addRemote.length = 0;
  calls.setDefault.length = 0;
  calls.setDefaultAgent.length = 0;
  calls.buildContainer.length = 0;
  calls.startContainer.length = 0;
  calls.execSync.length = 0;
});

afterAll(() => {
  mock.restore();
});

test("default attach uses main session", async () => {
  const program = createCLI();
  await program.parseAsync(["node", "ccc"]);
  expect(calls.attachSession).toHaveLength(1);
  expect(calls.attachSession[0]!.session).toBe("main");
});

test("explicit session name attaches locally", async () => {
  const program = createCLI();
  await program.parseAsync(["node", "ccc", "work"]);
  expect(calls.attachSession).toHaveLength(1);
  expect(calls.attachSession[0]!.session).toBe("work");
});

test("yolo prompt is forwarded to attach", async () => {
  const program = createCLI();
  await program.parseAsync(["node", "ccc", "--yolo", "fix bugs"]);
  const call = calls.attachSession[0]!;
  expect(call.options).toEqual(
    expect.objectContaining({
      yolo: true,
      prompt: "fix bugs",
    })
  );
});

test("remote target uses attachRemote", async () => {
  const program = createCLI();
  await program.parseAsync(["node", "ccc", "@vps"]);
  expect(calls.attachRemote).toHaveLength(1);
  expect(calls.attachRemote[0]!.host).toBe("user@host");
});

test("ls routes to listSessions", async () => {
  const program = createCLI();
  await program.parseAsync(["node", "ccc", "ls"]);
  expect(calls.listSessions).toHaveLength(1);
  expect(calls.attachSession).toHaveLength(0);
});

test("ls on remote routes to listRemoteSessions", async () => {
  const program = createCLI();
  await program.parseAsync(["node", "ccc", "ls", "@vps"]);
  expect(calls.listRemoteSessions).toHaveLength(1);
  expect(calls.listRemoteSessions[0]).toBe("user@host");
});

test("remote add forwards arguments", async () => {
  const program = createCLI();
  await program.parseAsync([
    "node",
    "ccc",
    "remote",
    "add",
    "box",
    "user@box",
    "--alias",
    "alias1",
    "alias2",
  ]);
  expect(calls.addRemote).toHaveLength(1);
  expect(calls.addRemote[0]).toEqual(["box", "user@box", ["alias1", "alias2"]]);
});

test("build uses specified output directory", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ccc-build-"));
  writeFileSync(join(tempDir, "Dockerfile"), "FROM scratch\n");
  const program = createCLI();
  await program.parseAsync(["node", "ccc", "build", "--output", tempDir]);
  expect(calls.buildContainer).toEqual([tempDir]);
});

test("start uses specified output directory", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ccc-start-"));
  const program = createCLI();
  await program.parseAsync(["node", "ccc", "start", "--output", tempDir]);
  expect(calls.startContainer).toEqual([tempDir]);
});

test("update runs agent install command in container", async () => {
  const program = createCLI();
  await program.parseAsync(["node", "ccc", "update", "--agent", "codex"]);
  expect(calls.execSync).toHaveLength(1);
  expect(calls.execSync[0]).toContain('docker exec ccc sh -c "install codex"');
});
