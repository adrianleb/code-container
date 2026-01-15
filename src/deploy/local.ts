import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "fs";
import { join } from "path";
import { execSync, spawn } from "child_process";
import type { Agent } from "../agents/types.ts";
import type { Extension } from "../extensions/types.ts";
import { loadAgents } from "../agents/loader.ts";
import { checkAgentInstalled } from "../agents/auth.ts";
import { generateDockerfile } from "../templates/dockerfile.ts";
import { generateCompose } from "../templates/compose.ts";
import { generateEntrypoint } from "../templates/entrypoint.ts";
import { generateFirewall } from "../templates/firewall.ts";
import * as ui from "../utils/ui.ts";

export const childProcess = { execSync, spawn };

export interface InitOptions {
  agents: Agent[];
  outputDir: string;
  containerName?: string;
  timezone?: string;
  projectsDir?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  extensions?: Extension[];
  userFirewallDomains?: string[];
}

export function generateFiles(options: InitOptions): void {
  const {
    agents,
    outputDir,
    containerName = "ccc",
    timezone = "UTC",
    projectsDir = "./projects",
    gitUserName,
    gitUserEmail,
    extensions = [],
    userFirewallDomains = [],
  } = options;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const dockerfile = generateDockerfile({ agents, timezone });
  writeFileSync(join(outputDir, "Dockerfile"), dockerfile);
  ui.item("Dockerfile", "ok");

  const compose = generateCompose({ containerName, timezone, projectsDir, agents, gitUserName, gitUserEmail });
  writeFileSync(join(outputDir, "docker-compose.yml"), compose);
  ui.item("docker-compose.yml", "ok");

  const entrypoint = generateEntrypoint({ agents, extensions });
  const entrypointPath = join(outputDir, "entrypoint.sh");
  writeFileSync(entrypointPath, entrypoint);
  chmodSync(entrypointPath, 0o755);
  ui.item("entrypoint.sh", "ok");

  const firewall = generateFirewall({ agents, extensions, userDomains: userFirewallDomains });
  const firewallPath = join(outputDir, "init-firewall.sh");
  writeFileSync(firewallPath, firewall);
  chmodSync(firewallPath, 0o755);
  ui.item("init-firewall.sh", "ok");

  const projectsPath = join(outputDir, "projects");
  if (!existsSync(projectsPath)) {
    mkdirSync(projectsPath, { recursive: true });
  }
  ui.item("projects/", "ok");

  // Create skills directory for mounting into container
  const skillsPath = join(outputDir, "skills");
  if (!existsSync(skillsPath)) {
    mkdirSync(skillsPath, { recursive: true });
  }
  ui.item("skills/", "ok");

  // Create mcp-configs directory for mounting into container
  const mcpConfigsPath = join(outputDir, "mcp-configs");
  if (!existsSync(mcpConfigsPath)) {
    mkdirSync(mcpConfigsPath, { recursive: true });
  }
  ui.item("mcp-configs/", "ok");
}

export async function generateContainerSSHKeys(outputDir: string): Promise<string> {
  const sshDir = join(outputDir, "ssh-keys");

  if (!existsSync(sshDir)) {
    mkdirSync(sshDir, { recursive: true });
  }

  const keyPath = join(sshDir, "id_ed25519");

  if (!existsSync(keyPath)) {
    childProcess.execSync(
      `ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "ccc-container" -q`,
      { stdio: "pipe" }
    );
    ui.item("SSH key generated", "ok");

    const knownHostsPath = join(sshDir, "known_hosts");
    try {
      childProcess.execSync(
        `ssh-keyscan github.com gitlab.com bitbucket.org > "${knownHostsPath}" 2>/dev/null`
      );
      ui.item("known_hosts pre-populated (github, gitlab, bitbucket)", "ok");
    } catch {
      ui.item("Could not pre-populate known_hosts", "warn");
    }
  } else {
    ui.item("SSH key already exists", "ok");
  }

  const pubKeyPath = join(sshDir, "id_ed25519.pub");
  if (existsSync(pubKeyPath)) {
    return readFileSync(pubKeyPath, "utf-8").trim();
  }

  return "";
}

export function buildContainer(outputDir: string, options: { noCache?: boolean } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["compose", "build"];
    if (options.noCache) {
      args.push("--no-cache");
    }
    const result = childProcess.spawn("docker", args, {
      cwd: outputDir,
      stdio: "inherit",
    });

    result.on("close", (code) => {
      if (code === 0) {
        ui.success("Container built successfully!");
        ui.hint(`Start the container: ${ui.style.command("ccc start")} or ${ui.style.command("docker compose up -d")}`);
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

export async function startContainer(outputDir: string, forceRecreate = false): Promise<void> {
  try {
    const cmd = forceRecreate ? "docker compose up -d --force-recreate" : "docker compose up -d";
    childProcess.execSync(cmd, {
      cwd: outputDir,
      stdio: "inherit",
    });
  } catch (error) {
    ui.error("Failed to start container");
    throw error;
  }
}

export function attachSession(
  containerName: string,
  sessionName: string = "main",
  options: { noFirewall?: boolean; yolo?: boolean; prompt?: string; agent?: Agent } = {}
): void {
  const args = ["exec", "-it"];

  if (options.noFirewall) {
    try {
      childProcess.execSync(`docker exec ${containerName} sudo iptables -F OUTPUT 2>/dev/null || true`, {
        stdio: "ignore",
      });
    } catch {
    }
  }

  args.push(containerName);

  if (options.yolo && options.prompt && options.agent) {
    const agentArgs = [options.agent.runCmd];
    if (options.agent.skipPermissionsFlag) {
      agentArgs.push(options.agent.skipPermissionsFlag);
    }
    agentArgs.push("-p", options.prompt);

    args.push("shpool", "attach", "-f", sessionName, "--", ...agentArgs);
  } else {
    args.push("shpool", "attach", sessionName);
  }

  const result = childProcess.spawn("docker", args, {
    stdio: "inherit",
  });

  result.on("close", (code) => {
    process.exit(code || 0);
  });
}

export function listSessions(containerName: string): void {
  try {
    childProcess.execSync(`docker inspect ${containerName} >/dev/null 2>&1`);

    const result = childProcess.execSync(`docker exec ${containerName} shpool list 2>/dev/null`, {
      encoding: "utf-8",
    });

    if (result.trim()) {
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

export function killSession(containerName: string, sessionName: string): void {
  childProcess.execSync(`docker exec ${containerName} shpool kill ${sessionName}`, {
    stdio: "inherit",
  });
  console.log(`Killed session: ${sessionName}`);
}

export function showLogs(containerName: string): void {
  childProcess.spawn("docker", ["logs", containerName, "--tail", "100", "-f"], {
    stdio: "inherit",
  });
}

export function restartContainer(containerName: string): void {
  childProcess.execSync(`docker restart ${containerName}`, { stdio: "inherit" });
  console.log("Container restarted");
}

export interface ContainerStatus {
  exists: boolean;
  running: boolean;
  takopi: boolean;
  sessions: string[];
  agents: string[];
}

export function getContainerStatus(containerName: string): ContainerStatus {
  const status: ContainerStatus = {
    exists: false,
    running: false,
    takopi: false,
    sessions: [],
    agents: [],
  };

  try {
    const result = childProcess.execSync(
      `docker inspect -f '{{.State.Running}}' ${containerName} 2>/dev/null`,
      { encoding: "utf-8", stdio: "pipe" }
    );
    status.exists = true;
    status.running = result.trim() === "true";
  } catch {
    return status;
  }

  if (status.running) {
    // Check takopi
    try {
      childProcess.execSync(
        `docker exec ${containerName} pgrep -f takopi >/dev/null 2>&1`,
        { stdio: "pipe" }
      );
      status.takopi = true;
    } catch {
      status.takopi = false;
    }

    // Get sessions
    try {
      const sessionsOutput = childProcess.execSync(
        `docker exec ${containerName} shpool list 2>/dev/null`,
        { encoding: "utf-8", stdio: "pipe" }
      );
      const lines = sessionsOutput.trim().split("\n").filter(Boolean);
      // Parse shpool list output - skip header line
      status.sessions = lines.slice(1).map((line) => line.split(/\s+/)[0]).filter(Boolean) as string[];
    } catch {
      status.sessions = [];
    }

    // Check installed agents
    const enabledAgents = loadAgents();
    for (const [name, agent] of Object.entries(enabledAgents)) {
      const installStatus = checkAgentInstalled(agent, { containerName });
      if (installStatus.installed) {
        status.agents.push(name);
      }
    }
  }

  return status;
}
