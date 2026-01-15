import { execSync, spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import type { Agent } from "../agents/types.ts";
import { loadAgents } from "../agents/loader.ts";
import { checkAgentInstalled } from "../agents/auth.ts";
import { generateDockerfile } from "../templates/dockerfile.ts";
import { generateCompose } from "../templates/compose.ts";
import { generateEntrypoint } from "../templates/entrypoint.ts";
import { generateFirewall } from "../templates/firewall.ts";
import { loadExtensions } from "../extensions/loader.ts";
import { getUserFirewallDomains } from "../firewall/config.ts";
import { detectRemotePlatform, ensureBinaryForPlatform } from "./binary.ts";
import * as ui from "../utils/ui.ts";

export const childProcess = { execSync, spawn, spawnSync };

const REMOTE_CCC_DIR = "~/.ccc";
const REMOTE_BIN_DIR = "~/bin";

export function testSSHConnection(host: string): boolean {
  try {
    childProcess.execSync(`ssh -o BatchMode=yes -o ConnectTimeout=5 ${host} "echo ok"`, {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function sshExec(
  host: string,
  command: string,
  options: { stdio?: "inherit" | "pipe"; ignoreError?: boolean } = {}
): string {
  const { stdio = "pipe", ignoreError = false } = options;

  try {
    const result = childProcess.execSync(`ssh ${host} "${command.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
      stdio: stdio === "inherit" ? "inherit" : "pipe",
    });
    return result?.trim() || "";
  } catch (error) {
    if (ignoreError) {
      return "";
    }
    throw error;
  }
}

export function scpFile(localPath: string, host: string, remotePath: string): void {
  childProcess.execSync(`scp -q "${localPath}" "${host}:${remotePath}"`, { stdio: "pipe" });
}

export function scpDir(localPath: string, host: string, remotePath: string): void {
  childProcess.execSync(`scp -q -r "${localPath}" "${host}:${remotePath}"`, { stdio: "pipe" });
}

export function checkRemoteDocker(host: string): boolean {
  try {
    sshExec(host, "docker --version");
    return true;
  } catch {
    return false;
  }
}

export async function initRemote(
  host: string,
  agents: Agent[],
  options: { build?: boolean; gitUserName?: string; gitUserEmail?: string } = {}
): Promise<void> {
  const { build = false, gitUserName = "", gitUserEmail = "" } = options;

  ui.header(ui.step(1, 5, "Testing SSH connection"));
  if (!testSSHConnection(host)) {
    ui.item(`Cannot connect to ${host}`, "fail");
    ui.error(`SSH connection failed to ${host}`);
    console.log(`\n  Make sure you can SSH to this host:`);
    ui.showCommand(`ssh ${host}`);
    throw new Error("SSH connection failed");
  }
  ui.item(`Connected to ${ui.style.highlight(host)}`, "ok");

  ui.header(ui.step(2, 5, "Checking remote Docker"));
  if (!checkRemoteDocker(host)) {
    ui.item("Docker not found on remote", "fail");
    ui.error("Docker is required on the remote host");
    console.log(`\n  Install Docker on ${host}:`);
    ui.showCommand("curl -fsSL https://get.docker.com | sh");
    throw new Error("Docker not found on remote");
  }
  ui.item("Docker is installed", "ok");

  try {
    sshExec(host, "docker compose version");
    ui.item("Docker Compose is installed", "ok");
  } catch {
    ui.item("Docker Compose not found", "fail");
    ui.error("Docker Compose is required");
    throw new Error("Docker Compose not found on remote");
  }

  ui.header(ui.step(3, 5, "Generating container files"));

  const tempDir = mkdtempSync(join(tmpdir(), "ccc-"));

  const extensions = Object.values(loadExtensions());
  const userFirewallDomains = getUserFirewallDomains();

  const dockerfile = generateDockerfile({ agents });
  writeFileSync(join(tempDir, "Dockerfile"), dockerfile);
  ui.item("Dockerfile", "ok");

  const compose = generateCompose({ agents, gitUserName, gitUserEmail });
  writeFileSync(join(tempDir, "docker-compose.yml"), compose);
  ui.item("docker-compose.yml", "ok");

  const entrypoint = generateEntrypoint({ agents, extensions });
  writeFileSync(join(tempDir, "entrypoint.sh"), entrypoint);
  ui.item("entrypoint.sh", "ok");

  const firewall = generateFirewall({ agents, extensions, userDomains: userFirewallDomains });
  writeFileSync(join(tempDir, "init-firewall.sh"), firewall);
  ui.item("init-firewall.sh", "ok");

  // Detect remote platform and get appropriate binary
  ui.item("Detecting remote platform...", "pending");
  const remotePlatform = detectRemotePlatform(host);
  if (!remotePlatform) {
    throw new Error("Could not detect remote platform");
  }
  ui.item(`Remote platform: ${remotePlatform.os}-${remotePlatform.arch}`, "ok");

  const binaryPath = await ensureBinaryForPlatform(remotePlatform);

  const sshKeysDir = join(tempDir, "ssh-keys");
  mkdirSync(sshKeysDir, { recursive: true });
  const keyPath = join(sshKeysDir, "id_ed25519");
  childProcess.execSync(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "ccc-container" -q`);
  ui.item("Container SSH key generated", "ok");

  try {
    childProcess.execSync(
      `ssh-keyscan github.com gitlab.com bitbucket.org > "${join(sshKeysDir, "known_hosts")}" 2>/dev/null`
    );
  } catch {}

  ui.header(ui.step(4, 5, "Copying files to remote"));

  sshExec(host, `mkdir -p ${REMOTE_CCC_DIR} ${REMOTE_BIN_DIR}`, { ignoreError: true });
  sshExec(host, `mkdir -p ${REMOTE_CCC_DIR}/ssh-keys ${REMOTE_CCC_DIR}/projects ${REMOTE_CCC_DIR}/skills ${REMOTE_CCC_DIR}/mcp-configs`);
  ui.item("Created remote directories", "ok");

  scpFile(join(tempDir, "Dockerfile"), host, `${REMOTE_CCC_DIR}/Dockerfile`);
  scpFile(join(tempDir, "docker-compose.yml"), host, `${REMOTE_CCC_DIR}/docker-compose.yml`);
  scpFile(join(tempDir, "entrypoint.sh"), host, `${REMOTE_CCC_DIR}/entrypoint.sh`);
  scpFile(join(tempDir, "init-firewall.sh"), host, `${REMOTE_CCC_DIR}/init-firewall.sh`);
  ui.item("Copied container files", "ok");

  scpDir(sshKeysDir, host, `${REMOTE_CCC_DIR}/`);
  ui.item("Copied SSH keys", "ok");

  const localSkillsDir = join(homedir(), ".ccc", "skills");
  if (existsSync(localSkillsDir) && readdirSync(localSkillsDir).length > 0) {
    childProcess.execSync(`scp -q -r "${localSkillsDir}/." "${host}:${REMOTE_CCC_DIR}/skills"`, { stdio: "pipe" });
    ui.item("Copied skills", "ok");
  }

  const localMcpDir = join(homedir(), ".ccc", "mcp-configs");
  if (existsSync(localMcpDir) && readdirSync(localMcpDir).length > 0) {
    childProcess.execSync(`scp -q -r "${localMcpDir}/." "${host}:${REMOTE_CCC_DIR}/mcp-configs"`, { stdio: "pipe" });
    ui.item("Copied MCP configs", "ok");
  }

  scpFile(binaryPath, host, `${REMOTE_BIN_DIR}/ccc`);
  sshExec(host, `chmod +x ${REMOTE_BIN_DIR}/ccc`);
  ui.item("Installed ccc binary", "ok");

  sshExec(host, `chmod +x ${REMOTE_CCC_DIR}/entrypoint.sh ${REMOTE_CCC_DIR}/init-firewall.sh`);

  const pubKey = readFileSync(join(sshKeysDir, "id_ed25519.pub"), "utf-8").trim();
  console.log(`\n  ${ui.symbols.key} ${ui.style.bold("Container SSH public key")} ${ui.style.dim("(add to GitHub):")}`);
  console.log(`  ${ui.style.dim("─".repeat(60))}`);
  console.log(`  ${ui.style.info(pubKey)}`);
  console.log(`  ${ui.style.dim("─".repeat(60))}`);

  ui.header(ui.step(5, 5, "Container setup"));

  if (build) {
    console.log(`\n  ${ui.symbols.package} Building container on remote... ${ui.style.dim("(this may take a few minutes)")}`);
    await buildRemote(host);
  } else {
    console.log(`\n  ${ui.style.dim("Files copied. To build the container on remote:")}`);
    ui.showCommand(`ssh ${host} "cd ~/.ccc && docker compose build"`);
    console.log(`\n  ${ui.style.dim("Or use:")}`);
    ui.showCommand(`ccc build @remote`);
  }

  ui.success("Remote container initialized!");

  console.log(`\n  ${ui.symbols.lightning} ${ui.style.bold("Next steps:")}`);
  console.log(`  ${ui.style.dim("1.")} Add the SSH key above to GitHub`);
  console.log(`  ${ui.style.dim("2.")} Build the container on remote`);
  console.log(`  ${ui.style.dim("3.")} Connect: ${ui.style.command(`ccc @remote`)}`);

  ui.hint(`You can also SSH directly: ${ui.style.command(`ssh ${host}`)}, then run ${ui.style.command("ccc")}`);
}

export async function buildRemote(host: string, options: { noCache?: boolean } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const buildCmd = options.noCache ? "docker compose build --no-cache" : "docker compose build";
    const result = childProcess.spawn("ssh", [host, `cd ${REMOTE_CCC_DIR} && ${buildCmd}`], {
      stdio: "inherit",
    });

    result.on("close", (code) => {
      if (code === 0) {
        ui.success("Remote container built successfully!");
        resolve();
      } else {
        ui.error(`Remote build failed with code ${code}`);
        reject(new Error(`Remote build failed with code ${code}`));
      }
    });

    result.on("error", (err) => {
      ui.error(`Failed to start remote build: ${err.message}`);
      reject(err);
    });
  });
}

export async function startRemote(host: string): Promise<void> {
  try {
    sshExec(host, `cd ${REMOTE_CCC_DIR} && docker compose up -d`, { stdio: "inherit" });
    ui.success("Remote container started!");
  } catch (error) {
    ui.error("Failed to start remote container");
    throw error;
  }
}

export function attachRemote(
  host: string,
  sessionName: string = "main",
  options: { noFirewall?: boolean; yolo?: boolean; prompt?: string; agent?: Agent } = {}
): void {
  const args = ["ssh", "-t", host];

  // Build the ccc command with appropriate flags
  const cccArgs = [sessionName];
  if (options.noFirewall) {
    cccArgs.push("--no-firewall");
  }
  if (options.yolo) {
    cccArgs.push("--yolo");
    if (options.prompt) {
      cccArgs.push(`"${options.prompt}"`);
    }
  }

  args.push(`${REMOTE_BIN_DIR}/ccc ${cccArgs.join(" ")}`);

  const result = childProcess.spawnSync(args[0]!, args.slice(1), {
    stdio: "inherit",
  });

  process.exit(result.status || 0);
}

export function listRemoteSessions(host: string): void {
  try {
    sshExec(host, `docker exec ccc shpool list 2>/dev/null || echo "(no sessions)"`, {
      stdio: "inherit",
    });
  } catch {
    console.log(`  ${ui.style.dim("Could not list remote sessions")}`);
  }
}

export function killRemoteSession(host: string, sessionName: string): void {
  sshExec(host, `docker exec ccc shpool kill ${sessionName}`, { stdio: "inherit" });
  ui.success(`Remote session '${sessionName}' killed`);
}

export function showRemoteLogs(host: string): void {
  childProcess.spawn("ssh", ["-t", host, "docker logs ccc --tail 100 -f"], {
    stdio: "inherit",
  });
}

export function restartRemote(host: string): void {
  sshExec(host, "docker restart ccc", { stdio: "inherit" });
  ui.success("Remote container restarted!");
}

export async function updateRemoteBinary(host: string): Promise<void> {
  ui.item("Detecting remote platform...", "pending");
  const remotePlatform = detectRemotePlatform(host);
  if (!remotePlatform) {
    throw new Error("Could not detect remote platform");
  }
  ui.item(`Remote platform: ${remotePlatform.os}-${remotePlatform.arch}`, "ok");

  // Force re-download by getting the binary (will use cache or download)
  const binaryPath = await ensureBinaryForPlatform(remotePlatform);

  // Copy to remote
  sshExec(host, `mkdir -p ${REMOTE_BIN_DIR}`, { ignoreError: true });
  scpFile(binaryPath, host, `${REMOTE_BIN_DIR}/ccc`);
  sshExec(host, `chmod +x ${REMOTE_BIN_DIR}/ccc`);
  ui.item("Updated ccc binary on remote", "ok");
}

export interface RemoteHostStatus {
  reachable: boolean;
  containerExists: boolean;
  containerRunning: boolean;
  takopi: boolean;
  sessions: string[];
  agents: string[];
}

export function getRemoteHostStatus(host: string): RemoteHostStatus {
  const status: RemoteHostStatus = {
    reachable: false,
    containerExists: false,
    containerRunning: false,
    takopi: false,
    sessions: [],
    agents: [],
  };

  // Test SSH connection
  if (!testSSHConnection(host)) {
    return status;
  }
  status.reachable = true;

  // Check container status
  try {
    const result = sshExec(host, "docker inspect -f '{{.State.Running}}' ccc 2>/dev/null");
    status.containerExists = true;
    status.containerRunning = result.trim() === "true";
  } catch {
    return status;
  }

  if (status.containerRunning) {
    // Check takopi
    try {
      sshExec(host, "docker exec ccc pgrep -f takopi >/dev/null 2>&1");
      status.takopi = true;
    } catch {
      status.takopi = false;
    }

    // Get sessions
    try {
      const sessionsOutput = sshExec(host, "docker exec ccc shpool list 2>/dev/null");
      const lines = sessionsOutput.trim().split("\n").filter(Boolean);
      // Parse shpool list output - skip header line
      status.sessions = lines.slice(1).map((line) => line.split(/\s+/)[0]).filter(Boolean) as string[];
    } catch {
      status.sessions = [];
    }

    // Check installed agents
    const enabledAgents = loadAgents();
    for (const [name, agent] of Object.entries(enabledAgents)) {
      const installStatus = checkAgentInstalled(agent, { host });
      if (installStatus.installed) {
        status.agents.push(name);
      }
    }
  }

  return status;
}
