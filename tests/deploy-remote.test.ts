import { beforeEach, afterEach, expect, test } from "bun:test";

const calls = {
  execSync: [] as Array<{ cmd: string; opts: unknown }>,
  spawn: [] as Array<{ cmd: string; args: string[] }>,
  spawnSync: [] as Array<{ cmd: string; args: string[] }>,
};

const {
  sshExec,
  scpFile,
  scpDir,
  attachRemote,
  listRemoteSessions,
  childProcess,
} = await import(`../src/deploy/remote.ts?${Date.now()}`);
const originalExecSync = childProcess.execSync;
const originalSpawn = childProcess.spawn;
const originalSpawnSync = childProcess.spawnSync;

beforeEach(() => {
  calls.execSync.length = 0;
  calls.spawn.length = 0;
  calls.spawnSync.length = 0;
  childProcess.execSync = (cmd: string, opts: unknown) => {
    calls.execSync.push({ cmd, opts });
    return "ok";
  };
  childProcess.spawn = (cmd: string, args: string[]) => {
    calls.spawn.push({ cmd, args });
    return {
      on: () => {},
    };
  };
  childProcess.spawnSync = (cmd: string, args: string[]) => {
    calls.spawnSync.push({ cmd, args });
    return { status: 0 };
  };
});

afterEach(() => {
  childProcess.execSync = originalExecSync;
  childProcess.spawn = originalSpawn;
  childProcess.spawnSync = originalSpawnSync;
});

test("sshExec escapes quotes", () => {
  sshExec("user@host", 'echo "hi"');
  expect(calls.execSync).toHaveLength(1);
  expect(calls.execSync[0]!.cmd).toBe('ssh user@host "echo \\"hi\\""');
});

test("scpFile and scpDir compose scp commands", () => {
  scpFile("/tmp/file", "user@host", "~/.ccc/file");
  scpDir("/tmp/dir", "user@host", "~/.ccc/dir");
  expect(calls.execSync[0]!.cmd).toBe('scp -q "/tmp/file" "user@host:~/.ccc/file"');
  expect(calls.execSync[1]!.cmd).toBe('scp -q -r "/tmp/dir" "user@host:~/.ccc/dir"');
});

test("attachRemote spawns ssh command", () => {
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as typeof process.exit;

  try {
    attachRemote("user@host", "main", { yolo: true, prompt: "fix" });
  } catch (error) {
    expect((error as Error).message).toBe("exit:0");
  } finally {
    process.exit = originalExit;
  }

  expect(calls.spawnSync).toHaveLength(1);
  expect(calls.spawnSync[0]).toEqual(
    expect.objectContaining({
      cmd: "ssh",
      args: expect.arrayContaining(["-t", "user@host"]),
    })
  );
});

test("listRemoteSessions uses docker exec shpool list", () => {
  listRemoteSessions("user@host");
  expect(calls.execSync[0]!.cmd).toContain("docker exec ccc shpool list");
});
