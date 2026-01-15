import { execSync, spawn, type SpawnOptions, type ChildProcess } from "child_process";

export interface ExecOptions {
  stdio?: "pipe" | "inherit";
  ignoreError?: boolean;
}

export interface Executor {
  exec(cmd: string, opts?: ExecOptions): string;
  spawn(cmd: string, args: string[], opts?: SpawnOptions): ChildProcess;
  readonly isRemote: boolean;
  readonly workDir: string;
}

export class LocalExecutor implements Executor {
  readonly isRemote = false;

  constructor(public readonly workDir: string) {}

  exec(cmd: string, opts: ExecOptions = {}): string {
    const { stdio = "pipe", ignoreError = false } = opts;
    try {
      const result = execSync(cmd, {
        cwd: this.workDir,
        encoding: "utf-8",
        stdio: stdio === "inherit" ? "inherit" : "pipe",
      });
      return result?.trim() || "";
    } catch (error) {
      if (ignoreError) return "";
      throw error;
    }
  }

  spawn(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
    return spawn(cmd, args, { cwd: this.workDir, ...opts });
  }
}

export class RemoteExecutor implements Executor {
  readonly isRemote = true;
  readonly workDir: string;

  constructor(public readonly host: string, remoteDir: string = "~/.ccc") {
    this.workDir = remoteDir;
  }

  exec(cmd: string, opts: ExecOptions = {}): string {
    const { stdio = "pipe", ignoreError = false } = opts;
    const remoteCmd = `cd ${this.workDir} && ${cmd}`;
    const sshCmd = `ssh ${this.host} "${remoteCmd.replace(/"/g, '\\"')}"`;

    try {
      const result = execSync(sshCmd, {
        encoding: "utf-8",
        stdio: stdio === "inherit" ? "inherit" : "pipe",
      });
      return result?.trim() || "";
    } catch (error) {
      if (ignoreError) return "";
      throw error;
    }
  }

  spawn(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
    const remoteCmd = `cd ${this.workDir} && ${cmd} ${args.join(" ")}`;
    return spawn("ssh", [this.host, remoteCmd], opts);
  }

  // SSH-specific helper for commands that don't need workDir
  execRaw(cmd: string, opts: ExecOptions = {}): string {
    const { stdio = "pipe", ignoreError = false } = opts;
    const sshCmd = `ssh ${this.host} "${cmd.replace(/"/g, '\\"')}"`;

    try {
      const result = execSync(sshCmd, {
        encoding: "utf-8",
        stdio: stdio === "inherit" ? "inherit" : "pipe",
      });
      return result?.trim() || "";
    } catch (error) {
      if (ignoreError) return "";
      throw error;
    }
  }
}
