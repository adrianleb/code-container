import { execSync, spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import type { Agent } from "../agents/types.ts";
import { generateContainerFiles } from "./files.ts";
import { RemoteExecutor } from "./executor.ts";
import { ContainerManager, type ContainerStatus } from "./container.ts";
import { loadExtensions } from "../extensions/loader.ts";
import { getUserFirewallDomains } from "../firewall/config.ts";
import { detectRemotePlatform, ensureBinaryForPlatform } from "./binary.ts";
import * as ui from "../utils/ui.ts";

const REMOTE_CCC_DIR = "~/.ccc";
const REMOTE_BIN_DIR = "~/bin";

// ============================================================================
// SSH Utilities
// ============================================================================

export function testSSHConnection(host: string): boolean {
  try {
    execSync(`ssh -o BatchMode=yes -o ConnectTimeout=5 ${host} "echo ok"`, { stdio: "pipe" });
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
    const result = execSync(`ssh ${host} "${command.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
      stdio: stdio === "inherit" ? "inherit" : "pipe",
    });
    return result?.trim() || "";
  } catch (error) {
    if (ignoreError) return "";
    throw error;
  }
}

export function scpFile(localPath: string, host: string, remotePath: string): void {
  execSync(`scp -q "${localPath}" "${host}:${remotePath}"`, { stdio: "pipe" });
}

export function scpDir(localPath: string, host: string, remotePath: string): void {
  execSync(`scp -q -r "${localPath}" "${host}:${remotePath}"`, { stdio: "pipe" });
}

function checkRemoteDocker(host: string): boolean {
  try {
    sshExec(host, "docker --version");
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Remote Container Manager Factory
// ============================================================================

function getRemoteManager(host: string): ContainerManager {
  const executor = new RemoteExecutor(host, REMOTE_CCC_DIR);
  return new ContainerManager(executor, "ccc");
}

// ============================================================================
// File Generation & Sync
// ============================================================================

interface GeneratedFilesResult {
  tempDir: string;
  sshKeysDir: string;
}

/**
 * Generate container files to a temp directory for remote deployment.
 */
function generateRemoteFiles(agents: Agent[], options: { gitUserName?: string; gitUserEmail?: string } = {}): GeneratedFilesResult {
  const tempDir = mkdtempSync(join(tmpdir(), "ccc-"));
  const extensions = Object.values(loadExtensions());
  const userFirewallDomains = getUserFirewallDomains();

  const files = generateContainerFiles({
    agents,
    extensions,
    userFirewallDomains,
    gitUserName: options.gitUserName,
    gitUserEmail: options.gitUserEmail,
  });

  writeFileSync(join(tempDir, "Dockerfile"), files.dockerfile);
  ui.item("Dockerfile", "ok");

  writeFileSync(join(tempDir, "docker-compose.yml"), files.compose);
  ui.item("docker-compose.yml", "ok");

  writeFileSync(join(tempDir, "entrypoint.sh"), files.entrypoint);
  ui.item("entrypoint.sh", "ok");

  writeFileSync(join(tempDir, "init-firewall.sh"), files.firewall);
  ui.item("init-firewall.sh", "ok");

  // Generate SSH keys
  const sshKeysDir = join(tempDir, "ssh-keys");
  mkdirSync(sshKeysDir, { recursive: true });
  const keyPath = join(sshKeysDir, "id_ed25519");
  execSync(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "ccc-container" -q`);
  ui.item("Container SSH key generated", "ok");

  try {
    execSync(`ssh-keyscan github.com gitlab.com bitbucket.org > "${join(sshKeysDir, "known_hosts")}" 2>/dev/null`);
  } catch {
    // Ignore ssh-keyscan errors
  }

  return { tempDir, sshKeysDir };
}

/**
 * Sync container files to remote (used when updating agents).
 */
export function syncRemoteFiles(host: string, agents: Agent[]): void {
  const tempDir = mkdtempSync(join(tmpdir(), "ccc-sync-"));
  const extensions = Object.values(loadExtensions());
  const userFirewallDomains = getUserFirewallDomains();

  const files = generateContainerFiles({
    agents,
    extensions,
    userFirewallDomains,
  });

  writeFileSync(join(tempDir, "Dockerfile"), files.dockerfile);
  writeFileSync(join(tempDir, "docker-compose.yml"), files.compose);
  writeFileSync(join(tempDir, "entrypoint.sh"), files.entrypoint);
  writeFileSync(join(tempDir, "init-firewall.sh"), files.firewall);

  scpFile(join(tempDir, "Dockerfile"), host, `${REMOTE_CCC_DIR}/Dockerfile`);
  scpFile(join(tempDir, "docker-compose.yml"), host, `${REMOTE_CCC_DIR}/docker-compose.yml`);
  scpFile(join(tempDir, "entrypoint.sh"), host, `${REMOTE_CCC_DIR}/entrypoint.sh`);
  scpFile(join(tempDir, "init-firewall.sh"), host, `${REMOTE_CCC_DIR}/init-firewall.sh`);

  sshExec(host, `chmod +x ${REMOTE_CCC_DIR}/entrypoint.sh ${REMOTE_CCC_DIR}/init-firewall.sh`);
}

// ============================================================================
// Remote Initialization
// ============================================================================

export async function initRemote(
  host: string,
  agents: Agent[],
  options: { build?: boolean; gitUserName?: string; gitUserEmail?: string } = {}
): Promise<void> {
  const { build = false, gitUserName = "", gitUserEmail = "" } = options;

  // Step 1: Test SSH connection
  ui.header(ui.step(1, 5, "Testing SSH connection"));
  if (!testSSHConnection(host)) {
    ui.item(`Cannot connect to ${host}`, "fail");
    ui.error(`SSH connection failed to ${host}`);
    console.log(`\n  Make sure you can SSH to this host:`);
    ui.showCommand(`ssh ${host}`);
    throw new Error("SSH connection failed");
  }
  ui.item(`Connected to ${ui.style.highlight(host)}`, "ok");

  // Step 2: Check Docker
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

  // Step 3: Generate files
  ui.header(ui.step(3, 5, "Generating container files"));
  const { tempDir, sshKeysDir } = generateRemoteFiles(agents, { gitUserName, gitUserEmail });

  // Detect remote platform and get binary
  ui.item("Detecting remote platform...", "pending");
  const remotePlatform = detectRemotePlatform(host);
  if (!remotePlatform) {
    throw new Error("Could not detect remote platform");
  }
  ui.item(`Remote platform: ${remotePlatform.os}-${remotePlatform.arch}`, "ok");
  const binaryPath = await ensureBinaryForPlatform(remotePlatform);

  // Step 4: Copy files to remote
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

  // Copy skills and mcp-configs if they exist
  const localSkillsDir = join(homedir(), ".ccc", "skills");
  if (existsSync(localSkillsDir) && readdirSync(localSkillsDir).length > 0) {
    execSync(`scp -q -r "${localSkillsDir}/." "${host}:${REMOTE_CCC_DIR}/skills"`, { stdio: "pipe" });
    ui.item("Copied skills", "ok");
  }

  const localMcpDir = join(homedir(), ".ccc", "mcp-configs");
  if (existsSync(localMcpDir) && readdirSync(localMcpDir).length > 0) {
    execSync(`scp -q -r "${localMcpDir}/." "${host}:${REMOTE_CCC_DIR}/mcp-configs"`, { stdio: "pipe" });
    ui.item("Copied MCP configs", "ok");
  }

  scpFile(binaryPath, host, `${REMOTE_BIN_DIR}/ccc`);
  sshExec(host, `chmod +x ${REMOTE_BIN_DIR}/ccc`);
  ui.item("Installed ccc binary", "ok");

  sshExec(host, `chmod +x ${REMOTE_CCC_DIR}/entrypoint.sh ${REMOTE_CCC_DIR}/init-firewall.sh`);

  // Print SSH key
  const pubKey = readFileSync(join(sshKeysDir, "id_ed25519.pub"), "utf-8").trim();
  console.log(`\n  ${ui.symbols.key} ${ui.style.bold("Container SSH public key")} ${ui.style.dim("(add to GitHub):")}`);
  console.log(`  ${ui.style.dim("─".repeat(60))}`);
  console.log(`  ${ui.style.info(pubKey)}`);
  console.log(`  ${ui.style.dim("─".repeat(60))}`);

  // Step 5: Build (optional)
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

// ============================================================================
// Container Operations (using ContainerManager)
// ============================================================================

export async function buildRemote(host: string, options: { noCache?: boolean } = {}): Promise<void> {
  return getRemoteManager(host).build(options);
}

export async function startRemote(host: string): Promise<void> {
  getRemoteManager(host).start();
}

export function restartRemote(host: string): void {
  getRemoteManager(host).restart();
}

export function listRemoteSessions(host: string): void {
  getRemoteManager(host).listSessions();
}

export function killRemoteSession(host: string, sessionName: string): void {
  getRemoteManager(host).killSession(sessionName);
}

export function showRemoteLogs(host: string): void {
  getRemoteManager(host).showLogs();
}

// ============================================================================
// Remote Status
// ============================================================================

export interface RemoteHostStatus extends ContainerStatus {
  reachable: boolean;
}

export function getRemoteHostStatus(host: string): RemoteHostStatus {
  const status: RemoteHostStatus = {
    reachable: false,
    exists: false,
    running: false,
    takopi: false,
    sessions: [],
    agents: [],
  };

  if (!testSSHConnection(host)) {
    return status;
  }
  status.reachable = true;

  const containerStatus = getRemoteManager(host).getStatus({ host });
  return { ...status, ...containerStatus };
}

// ============================================================================
// Remote Attach (SSH-specific, cannot use ContainerManager)
// ============================================================================

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

  const result = spawnSync(args[0]!, args.slice(1), { stdio: "inherit" });
  process.exit(result.status || 0);
}

// ============================================================================
// Binary Management
// ============================================================================

export async function updateRemoteBinary(host: string): Promise<void> {
  ui.item("Detecting remote platform...", "pending");
  const remotePlatform = detectRemotePlatform(host);
  if (!remotePlatform) {
    throw new Error("Could not detect remote platform");
  }
  ui.item(`Remote platform: ${remotePlatform.os}-${remotePlatform.arch}`, "ok");

  const binaryPath = await ensureBinaryForPlatform(remotePlatform);

  sshExec(host, `mkdir -p ${REMOTE_BIN_DIR}`, { ignoreError: true });
  scpFile(binaryPath, host, `${REMOTE_BIN_DIR}/ccc`);
  sshExec(host, `chmod +x ${REMOTE_BIN_DIR}/ccc`);
  ui.item("Updated ccc binary on remote", "ok");
}
