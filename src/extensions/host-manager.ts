import { execSync, spawn } from "child_process";
import type { Extension } from "./types.ts";

const CONTAINER_NAME = "ccc";

/**
 * Install a host extension inside the container
 */
export function installHostExtension(extension: Extension, options: { host?: string } = {}): boolean {
  if (extension.type !== "host" || !extension.installCmd) {
    return false;
  }

  const cmd = `docker exec ${CONTAINER_NAME} bash -c "${extension.installCmd}"`;
  try {
    if (options.host) {
      execSync(`ssh ${options.host} '${cmd}'`, { stdio: "inherit" });
    } else {
      execSync(cmd, { stdio: "inherit" });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a host extension daemon inside the container
 */
export function startHostExtension(extension: Extension, options: { host?: string } = {}): boolean {
  if (extension.type !== "host" || !extension.runCmd) {
    return false;
  }

  // First kill any existing process
  stopHostExtension(extension, options);

  const cmd = `docker exec -d ${CONTAINER_NAME} ${extension.runCmd}`;
  try {
    if (options.host) {
      execSync(`ssh ${options.host} '${cmd}'`, { stdio: "pipe" });
    } else {
      execSync(cmd, { stdio: "pipe" });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop a host extension daemon inside the container
 */
export function stopHostExtension(extension: Extension, options: { host?: string } = {}): boolean {
  if (extension.type !== "host" || !extension.runCmd) {
    return false;
  }

  // Extract the binary name from runCmd
  const binaryName = extension.runCmd.split(" ")[0]?.split("/").pop() || extension.name;
  const cmd = `docker exec ${CONTAINER_NAME} pkill -f "${binaryName}" 2>/dev/null || true`;

  try {
    if (options.host) {
      execSync(`ssh ${options.host} '${cmd}'`, { stdio: "pipe" });
    } else {
      execSync(cmd, { stdio: "pipe" });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a host extension is running
 */
export function isHostExtensionRunning(extension: Extension, options: { host?: string } = {}): boolean {
  if (extension.type !== "host" || !extension.runCmd) {
    return false;
  }

  const binaryName = extension.runCmd.split(" ")[0]?.split("/").pop() || extension.name;
  const cmd = `docker exec ${CONTAINER_NAME} pgrep -f "${binaryName}" >/dev/null 2>&1`;

  try {
    if (options.host) {
      execSync(`ssh ${options.host} '${cmd}'`, { stdio: "pipe" });
    } else {
      execSync(cmd, { stdio: "pipe" });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get status of all host extensions
 */
export function getHostExtensionsStatus(extensions: Extension[], options: { host?: string } = {}): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  for (const ext of extensions) {
    if (ext.type === "host") {
      status[ext.name] = isHostExtensionRunning(ext, options);
    }
  }
  return status;
}
