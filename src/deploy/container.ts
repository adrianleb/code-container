import type { Executor } from "./executor.ts";
import type { Agent } from "../agents/types.ts";
import { loadAgents } from "../agents/loader.ts";
import { checkAgentInstalled } from "../agents/auth.ts";
import * as ui from "../utils/ui.ts";

export interface ContainerStatus {
  exists: boolean;
  running: boolean;
  takopi: boolean;
  sessions: string[];
  agents: string[];
}

export interface BuildOptions {
  noCache?: boolean;
}

const CONTAINER_NAME = "ccc";

/**
 * Unified container operations that work with any executor (local or remote).
 */
export class ContainerManager {
  constructor(
    private executor: Executor,
    private containerName: string = CONTAINER_NAME
  ) {}

  /**
   * Build the container image.
   */
  async build(options: BuildOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ["compose", "build"];
      if (options.noCache) {
        args.push("--no-cache");
      }

      const result = this.executor.spawn("docker", args, { stdio: "inherit" });

      result.on("close", (code) => {
        if (code === 0) {
          const location = this.executor.isRemote ? "Remote container" : "Container";
          ui.success(`${location} built successfully!`);
          resolve();
        } else {
          ui.error(`Build failed with code ${code}`);
          reject(new Error(`Build failed with code ${code}`));
        }
      });

      result.on("error", (err) => {
        ui.error(`Failed to start build: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Start the container.
   */
  start(forceRecreate = false): void {
    const cmd = forceRecreate
      ? "docker compose up -d --force-recreate"
      : "docker compose up -d";
    try {
      this.executor.exec(cmd, { stdio: "inherit" });
      if (this.executor.isRemote) {
        ui.success("Remote container started!");
      }
    } catch (error) {
      ui.error("Failed to start container");
      throw error;
    }
  }

  /**
   * Restart the container.
   */
  restart(): void {
    this.executor.exec(`docker restart ${this.containerName}`, { stdio: "inherit" });
    const msg = this.executor.isRemote ? "Remote container restarted!" : "Container restarted";
    ui.success(msg);
  }

  /**
   * Get container status information.
   */
  getStatus(checkContext?: { containerName?: string; host?: string }): ContainerStatus {
    const status: ContainerStatus = {
      exists: false,
      running: false,
      takopi: false,
      sessions: [],
      agents: [],
    };

    // Check container state
    try {
      const result = this.executor.exec(
        `docker inspect -f '{{.State.Running}}' ${this.containerName} 2>/dev/null`,
        { ignoreError: true }
      );
      if (result) {
        status.exists = true;
        status.running = result.trim() === "true";
      }
    } catch {
      return status;
    }

    if (!status.running) return status;

    // Check takopi process
    try {
      this.executor.exec(`docker exec ${this.containerName} pgrep -f takopi >/dev/null 2>&1`);
      status.takopi = true;
    } catch {
      status.takopi = false;
    }

    // Get sessions
    try {
      const sessionsOutput = this.executor.exec(
        `docker exec ${this.containerName} shpool list 2>/dev/null`,
        { ignoreError: true }
      );
      if (sessionsOutput) {
        const lines = sessionsOutput.trim().split("\n").filter(Boolean);
        // Parse shpool list output - skip header line
        status.sessions = lines.slice(1).map((line) => line.split(/\s+/)[0]).filter(Boolean) as string[];
      }
    } catch {
      status.sessions = [];
    }

    // Check installed agents
    const enabledAgents = loadAgents();
    for (const [name, agent] of Object.entries(enabledAgents)) {
      const installStatus = checkAgentInstalled(agent, checkContext || {});
      if (installStatus.installed) {
        status.agents.push(name);
      }
    }

    return status;
  }

  /**
   * List active sessions.
   */
  listSessions(): void {
    try {
      const result = this.executor.exec(
        `docker exec ${this.containerName} shpool list 2>/dev/null`,
        { ignoreError: true }
      );

      if (result?.trim()) {
        console.log(result);
      } else {
        console.log(`  ${ui.style.dim("No active sessions")}`);
        ui.hint(`Start a session: ${ui.style.command("ccc")}`);
      }
    } catch {
      console.log(`  ${ui.style.dim("Container not running or no sessions")}`);
      ui.hint(`Start the container: ${ui.style.command("ccc start")}`);
    }
  }

  /**
   * Kill a specific session.
   */
  killSession(sessionName: string): void {
    this.executor.exec(`docker exec ${this.containerName} shpool kill ${sessionName}`, {
      stdio: "inherit",
    });
    const prefix = this.executor.isRemote ? "Remote session" : "Session";
    ui.success(`${prefix} '${sessionName}' killed`);
  }

  /**
   * Show container logs.
   */
  showLogs(): void {
    this.executor.spawn("docker", ["logs", this.containerName, "--tail", "100", "-f"], {
      stdio: "inherit",
    });
  }
}
