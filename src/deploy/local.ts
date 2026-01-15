import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "fs";
import { join } from "path";
import { execSync, spawn } from "child_process";
import type { Agent } from "../agents/types.ts";
import type { Extension } from "../extensions/types.ts";
import { generateContainerFiles, type GenerateFilesOptions } from "./files.ts";
import { LocalExecutor } from "./executor.ts";
import { ContainerManager, type ContainerStatus, type BuildOptions } from "./container.ts";
import * as ui from "../utils/ui.ts";

export { type ContainerStatus };

// Re-export InitOptions for backwards compatibility
export type InitOptions = GenerateFilesOptions & { outputDir: string };

const DEFAULT_CONTAINER_NAME = "ccc";

// Singleton managers for the default output directory
let _localExecutor: LocalExecutor | null = null;
let _containerManager: ContainerManager | null = null;

function getManager(outputDir: string): ContainerManager {
  if (!_containerManager || _localExecutor?.workDir !== outputDir) {
    _localExecutor = new LocalExecutor(outputDir);
    _containerManager = new ContainerManager(_localExecutor, DEFAULT_CONTAINER_NAME);
  }
  return _containerManager;
}

/**
 * Generate all container configuration files and write them to disk.
 */
export function generateFiles(options: InitOptions): void {
  const { outputDir, ...fileOptions } = options;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const files = generateContainerFiles(fileOptions);

  writeFileSync(join(outputDir, "Dockerfile"), files.dockerfile);
  ui.item("Dockerfile", "ok");

  writeFileSync(join(outputDir, "docker-compose.yml"), files.compose);
  ui.item("docker-compose.yml", "ok");

  const entrypointPath = join(outputDir, "entrypoint.sh");
  writeFileSync(entrypointPath, files.entrypoint);
  chmodSync(entrypointPath, 0o755);
  ui.item("entrypoint.sh", "ok");

  const firewallPath = join(outputDir, "init-firewall.sh");
  writeFileSync(firewallPath, files.firewall);
  chmodSync(firewallPath, 0o755);
  ui.item("init-firewall.sh", "ok");

  // Create directories
  for (const dir of ["projects", "skills", "mcp-configs"]) {
    const dirPath = join(outputDir, dir);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
    ui.item(`${dir}/`, "ok");
  }
}

/**
 * Generate SSH keys for the container.
 */
export async function generateContainerSSHKeys(outputDir: string): Promise<string> {
  const sshDir = join(outputDir, "ssh-keys");

  if (!existsSync(sshDir)) {
    mkdirSync(sshDir, { recursive: true });
  }

  const keyPath = join(sshDir, "id_ed25519");

  if (!existsSync(keyPath)) {
    execSync(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "ccc-container" -q`, { stdio: "pipe" });
    ui.item("SSH key generated", "ok");

    const knownHostsPath = join(sshDir, "known_hosts");
    try {
      execSync(`ssh-keyscan github.com gitlab.com bitbucket.org > "${knownHostsPath}" 2>/dev/null`);
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

/**
 * Build the container image.
 */
export function buildContainer(outputDir: string, options: BuildOptions = {}): Promise<void> {
  return getManager(outputDir).build(options);
}

/**
 * Start the container.
 */
export async function startContainer(outputDir: string, forceRecreate = false): Promise<void> {
  getManager(outputDir).start(forceRecreate);
}

// Helper to get a manager for container-name based operations
function getManagerByName(containerName: string): ContainerManager {
  const executor = new LocalExecutor(".");
  return new ContainerManager(executor, containerName);
}

/**
 * Restart the container.
 */
export function restartContainer(containerName: string): void {
  execSync(`docker restart ${containerName}`, { stdio: "inherit" });
  console.log("Container restarted");
}

/**
 * Get container status.
 */
export function getContainerStatus(containerName: string): ContainerStatus {
  return getManagerByName(containerName).getStatus({ containerName });
}

/**
 * List active sessions.
 */
export function listSessions(containerName: string): void {
  getManagerByName(containerName).listSessions();
}

/**
 * Kill a specific session.
 */
export function killSession(containerName: string, sessionName: string): void {
  getManagerByName(containerName).killSession(sessionName);
}

/**
 * Show container logs.
 */
export function showLogs(containerName: string): void {
  getManagerByName(containerName).showLogs();
}

/**
 * Attach to a session in the container.
 * This is local-specific due to direct docker exec with TTY.
 */
export function attachSession(
  containerName: string,
  sessionName: string = "main",
  options: { noFirewall?: boolean; yolo?: boolean; prompt?: string; agent?: Agent } = {}
): void {
  const args = ["exec", "-it"];

  if (options.noFirewall) {
    try {
      execSync(`docker exec ${containerName} sudo iptables -F OUTPUT 2>/dev/null || true`, {
        stdio: "ignore",
      });
    } catch {
      // Ignore firewall flush errors
    }
  }

  args.push(containerName);

  // Setup XDG_RUNTIME_DIR for shpool (docker exec bypasses entrypoint)
  const xdgSetup = 'sudo mkdir -p /run/user/$(id -u) && sudo chown $(id -u):$(id -g) /run/user/$(id -u)';

  if (options.yolo && options.prompt && options.agent) {
    const agentArgs = [options.agent.runCmd];
    if (options.agent.skipPermissionsFlag) {
      agentArgs.push(options.agent.skipPermissionsFlag);
    }
    agentArgs.push("-p", options.prompt);
    args.push("bash", "-c", `${xdgSetup} && shpool attach -f ${sessionName} -c '${agentArgs.join(" ")}'`);
  } else {
    args.push("bash", "-c", `${xdgSetup} && shpool attach ${sessionName}`);
  }

  const result = spawn("docker", args, { stdio: "inherit" });

  result.on("close", (code) => {
    process.exit(code || 0);
  });
}
