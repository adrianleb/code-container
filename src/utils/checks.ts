import { execSync } from "child_process";
import * as ui from "./ui.ts";

export function checkDockerRunning(): boolean {
  try {
    execSync("docker info >/dev/null 2>&1", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function checkDockerInstalled(): boolean {
  try {
    execSync("docker --version >/dev/null 2>&1", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function checkContainerExists(name: string): boolean {
  try {
    execSync(`docker inspect ${name} >/dev/null 2>&1`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function checkContainerRunning(name: string): boolean {
  try {
    const result = execSync(`docker inspect -f '{{.State.Running}}' ${name} 2>/dev/null`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    return result.trim() === "true";
  } catch {
    return false;
  }
}

export function requireDocker(): void {
  if (!checkDockerInstalled()) {
    ui.error("Docker is not installed");
    console.log(`\n  Install Docker from: ${ui.style.info("https://docs.docker.com/get-docker/")}`);
    process.exit(1);
  }

  if (!checkDockerRunning()) {
    ui.error("Docker daemon is not running");
    console.log(`\n  ${ui.style.dim("Start Docker and try again.")}`);
    process.exit(1);
  }
}

export function requireContainer(name: string): void {
  requireDocker();

  if (!checkContainerExists(name)) {
    ui.error(`Container '${name}' not found`);
    console.log(`\n  ${ui.style.dim("Initialize the container first:")}`);
    ui.showCommand("ccc init");
    process.exit(1);
  }
}

export function requireContainerRunning(name: string): void {
  requireContainer(name);

  if (!checkContainerRunning(name)) {
    ui.error(`Container '${name}' is not running`);
    console.log(`\n  ${ui.style.dim("Start the container first:")}`);
    ui.showCommand("ccc start");
    process.exit(1);
  }
}

export function checkSSHConnection(host: string): boolean {
  try {
    execSync(`ssh -o BatchMode=yes -o ConnectTimeout=5 ${host} "echo ok" >/dev/null 2>&1`, {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function requireSSHConnection(host: string): void {
  if (!checkSSHConnection(host)) {
    ui.error(`Cannot connect to ${host}`);
    console.log(`\n  ${ui.style.dim("Make sure you can SSH to this host:")}`);
    ui.showCommand(`ssh ${host}`);
    console.log(`\n  ${ui.style.dim("If you need to set up SSH keys:")}`);
    ui.showCommand("ccc setup-ssh");
    process.exit(1);
  }
}
