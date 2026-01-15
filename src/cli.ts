import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// @ts-ignore - Bun supports this import syntax
import pkg from "../package.json" with { type: "json" };
import {
  loadAgents,
  listAvailableAgents,
  enableAgents,
  getAgentsDir,
  disableAgent,
  isAgentEnabled,
  getAgentConfig,
} from "./agents/loader.ts";
import type { Agent } from "./agents/types.ts";
import {
  loadExtensions,
  listAvailableExtensions,
  enableExtensions,
  disableExtension,
  isExtensionEnabled,
  getExtensionsDir,
  getExtensionConfig,
} from "./extensions/loader.ts";
import { injectMcpConfigToAllAgents, removeMcpConfigFromAllAgents } from "./extensions/mcp-injector.ts";
import { installSkill, removeSkill } from "./extensions/skills-manager.ts";
import { startHostExtension, stopHostExtension, isHostExtensionRunning, installHostExtension } from "./extensions/host-manager.ts";
import {
  getUserFirewallDomains,
  addUserFirewallDomain,
  removeUserFirewallDomain,
  getFirewallConfigPath,
} from "./firewall/config.ts";
import {
  checkAuthStatus,
  checkAgentInstalled,
  installAgentInContainer,
  runAgentAuth,
  checkRemoteContainerRunning,
} from "./agents/auth.ts";
import {
  loadConfig,
  addRemote,
  removeRemote,
  setDefault,
  listRemotes,
  getDefault,
  getDefaultAgent,
  setDefaultAgent,
  resolveTarget,
} from "./config.ts";
import {
  generateFiles,
  generateContainerSSHKeys,
  buildContainer,
  startContainer,
  attachSession,
  listSessions,
  killSession,
  showLogs,
  restartContainer,
  getContainerStatus,
  type InitOptions,
} from "./deploy/local.ts";
import {
  initRemote,
  buildRemote,
  startRemote,
  attachRemote,
  listRemoteSessions,
  killRemoteSession,
  showRemoteLogs,
  restartRemote,
  sshExec,
  getRemoteHostStatus,
  updateRemoteBinary,
  syncRemoteFiles,
} from "./deploy/remote.ts";
import * as ui from "./utils/ui.ts";
import {
  requireDocker,
  requireContainer,
  requireContainerRunning,
} from "./utils/checks.ts";

function getAgents(): Record<string, Agent> {
  return loadAgents();
}

const DEFAULT_CONTAINER_NAME = "ccc";
const DEFAULT_OUTPUT_DIR = join(homedir(), ".ccc");
const CLI_VERSION = (pkg as { version?: string }).version ?? "0.0.0";

export function createCLI(): Command {
  const program = new Command();

  program
    .name("ccc")
    .description("Coding Container CLI - Setup coding agents in Docker with firewall support")
    .version(CLI_VERSION)
    .configureOutput({
      writeOut: (str) => process.stdout.write(str),
      writeErr: (str) => process.stderr.write(str),
    });

  program
    .argument("[target]", "Remote target (@alias) or session name")
    .argument("[session]", "Session name (default: main)")
    .option("-a, --agent <name>", "Agent to use (default: from config or first available)")
    .option("-w, --workspace <dir>", "Project directory to mount")
    .option("--no-firewall", "Disable firewall for this session")
    .option("--yolo [prompt]", "Enable auto-permissions mode (optional prompt)")
    .option("-s, --session <name>", "Shpool session name", "main")
    .action(async (target, session, options) => {
      const agents = getAgents();
      let agentName = options.agent || getDefaultAgent();
      if (!agentName && Object.keys(agents).length > 0) {
        agentName = Object.keys(agents)[0];
      }

      const agent = agentName ? agents[agentName] : undefined;
      const yoloPrompt = typeof options.yolo === "string" ? options.yolo : undefined;
      const yoloEnabled = Boolean(options.yolo);

      if (target?.startsWith("@")) {
        const host = resolveTarget(target);
        if (host) {
          const sessionName = session || options.session || "main";
          attachRemote(host, sessionName, {
            noFirewall: !options.firewall,
            yolo: yoloEnabled,
            prompt: yoloPrompt,
            agent,
          });
          return;
        }
      }

      const sessionName = session || target || options.session || "main";

      if (["ls", "logs", "kill", "restart", "build", "update", "start"].includes(sessionName)) {
        return;
      }

      requireContainerRunning(DEFAULT_CONTAINER_NAME);

      attachSession(DEFAULT_CONTAINER_NAME, sessionName, {
        noFirewall: !options.firewall,
        yolo: yoloEnabled,
        prompt: yoloPrompt,
        agent,
      });
    });

  program
    .command("init [target]")
    .description("Initialize a new coding container")
    .option("--agents <names>", "Agent(s) to use (comma-separated, e.g., claude,codex)")
    .option("--no-build", "Skip building the container")
    .option("--no-cache", "Build without Docker cache")
    .action(async (target, options) => {
      const host = resolveTarget(target);

      let agents = getAgents();

      if (Object.keys(agents).length === 0) {
        const availableTemplates = listAvailableAgents();

        if (availableTemplates.length === 0) {
          ui.error("No agent templates available");
          process.exit(1);
        }

        console.log(`\n${ui.symbols.sparkles} ${ui.style.bold("No agents configured. Select agents to enable:")}\n`);

        for (let i = 0; i < availableTemplates.length; i++) {
          const t = availableTemplates[i]!;
          console.log(`  ${ui.style.highlight(`[${i + 1}]`)} ${ui.style.bold(t.name)} ${ui.style.dim(`- ${t.description}`)}`);
        }
        console.log(`  ${ui.style.highlight("[a]")} ${ui.style.bold("All agents")}`);
        console.log();

        const readline = await import("readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`  ${ui.style.dim("Enter selection (e.g., 1,2 or a):")} `, resolve);
        });
        rl.close();

        let selectedNames: string[] = [];

        if (answer.toLowerCase() === "a") {
          selectedNames = availableTemplates.map((t) => t.name);
        } else {
          const indices = answer.split(",").map((s) => parseInt(s.trim(), 10) - 1);
          for (const idx of indices) {
            const template = availableTemplates[idx];
            if (idx >= 0 && idx < availableTemplates.length && template) {
              selectedNames.push(template.name);
            }
          }
        }

        if (selectedNames.length === 0) {
          ui.error("No agents selected");
          process.exit(1);
        }

        console.log();
        const enabled = enableAgents(selectedNames);
        for (const name of enabled) {
          ui.item(`Enabled ${name}`, "ok");
        }

        const firstEnabled = enabled[0];
        if (firstEnabled && !getDefaultAgent()) {
          setDefaultAgent(firstEnabled);
          ui.item(`Set ${firstEnabled} as default agent`, "ok");
        }

        console.log(`  ${ui.style.dim(`Configs saved to ${getAgentsDir()}`)}\n`);

        agents = getAgents();
      }

      let selectedAgents: Agent[] = [];

      if (options.agents) {
        const agentNames = options.agents.split(",").map((s: string) => s.trim());
        for (const name of agentNames) {
          const agent = agents[name];
          if (!agent) {
            ui.error(`Unknown agent: ${name}`);
            console.log(`  Available agents: ${Object.keys(agents).join(", ")}`);
            process.exit(1);
          }
          selectedAgents.push(agent);
        }
      } else {
        selectedAgents = Object.values(agents);
      }

      if (selectedAgents.length === 0) {
        ui.error("No agents available");
        process.exit(1);
      }

      if (host) {
        ui.welcome();
        console.log(`${ui.symbols.rocket} ${ui.style.bold("Initializing remote container on")} ${ui.style.highlight(host)}\n`);
        console.log(`  ${ui.style.dim("Agents:")} ${selectedAgents.map((a) => a.name).join(", ")}\n`);

        // Prompt for Git config
        const readline = await import("readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const gitUserName = await new Promise<string>((resolve) => {
          rl.question(`  ${ui.style.dim("Git user name:")} `, (answer) => {
            resolve(answer.trim() || "Developer");
          });
        });

        const gitUserEmail = await new Promise<string>((resolve) => {
          rl.question(`  ${ui.style.dim("Git email:")} `, (answer) => {
            resolve(answer.trim() || "dev@example.com");
          });
        });
        rl.close();

        console.log();

        try {
          await initRemote(host, selectedAgents, { build: options.build, gitUserName, gitUserEmail });
        } catch (error) {
          process.exit(1);
        }
        return;
      }

      const outputDir = DEFAULT_OUTPUT_DIR;
      ui.welcome();
      console.log(`${ui.symbols.rocket} ${ui.style.bold("Initializing local coding container...")}\n`);
      console.log(`  ${ui.style.dim("Agents:")} ${selectedAgents.map((a) => a.name).join(", ")}\n`);

      ui.header(ui.step(1, 5, "Checking SSH keys"));
      const localSshKey = join(homedir(), ".ssh", "id_ed25519");
      if (existsSync(localSshKey)) {
        ui.item(`Local SSH key found: ${ui.style.path(localSshKey)}`, "ok");
      } else {
        ui.item("No local SSH key found", "warn");
        ui.hint(`Run ${ui.style.command("ccc setup-ssh")} to generate one`);
      }

      ui.header(ui.step(2, 5, "Git configuration"));
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const gitUserName = await new Promise<string>((resolve) => {
        rl.question(`  ${ui.style.dim("Git user name:")} `, (answer) => {
          resolve(answer.trim() || "Developer");
        });
      });

      const gitUserEmail = await new Promise<string>((resolve) => {
        rl.question(`  ${ui.style.dim("Git email:")} `, (answer) => {
          resolve(answer.trim() || "dev@example.com");
        });
      });
      rl.close();

      ui.item(`Git config: ${gitUserName} <${gitUserEmail}>`, "ok");

      ui.header(ui.step(3, 5, "Generating container files"));
      const extensions = Object.values(loadExtensions());
      const userFirewallDomains = getUserFirewallDomains();
      generateFiles({
        agents: selectedAgents,
        outputDir,
        gitUserName,
        gitUserEmail,
        extensions,
        userFirewallDomains,
      });

      ui.header(ui.step(4, 5, "Setting up container SSH key"));
      const sshDir = join(outputDir, "ssh-keys");
      await generateContainerSSHKeys(outputDir);

      // Store SSH key to print at the end
      const pubKeyPath = join(sshDir, "id_ed25519.pub");
      const pubKey = existsSync(pubKeyPath) ? readFileSync(pubKeyPath, "utf-8").trim() : null;
      if (pubKey) {
        ui.item("Container SSH key generated", "ok");
      }

      ui.header(ui.step(5, 5, "Container setup"));

      console.log(`\n  ${ui.symbols.folder} Output directory: ${ui.style.path(outputDir)}`);

      if (options.build) {
        console.log(`\n  ${ui.symbols.package} Building container... ${ui.style.dim("(this may take a few minutes)")}`);
        await buildContainer(outputDir, { noCache: !options.cache });

        console.log(`\n  ${ui.symbols.rocket} Starting container...`);
        await startContainer(outputDir);
        ui.item("Container started", "ok");
      } else {
        console.log(`\n  ${ui.style.dim("Files created. To build and start the container:")}`);
        ui.showCommand("ccc build && ccc start");
      }

      ui.success("Container initialized!");

      // Print SSH key at the very end so it's easy to find
      if (pubKey) {
        console.log(`\n  ${ui.symbols.key} ${ui.style.bold("Container SSH public key")} ${ui.style.dim("(add to GitHub):")}`);
        console.log(`  ${ui.style.dim("─".repeat(60))}`);
        console.log(`  ${ui.style.info(pubKey)}`);
        console.log(`  ${ui.style.dim("─".repeat(60))}`);
      }

      console.log(`\n  ${ui.symbols.lightning} ${ui.style.bold("Next steps:")}`);
      console.log(`  ${ui.style.dim("1.")} Add the SSH key above to GitHub`);
      console.log(`  ${ui.style.dim("2.")} Start coding: ${ui.style.command("ccc")}`);

      ui.hint(`Detach from session: ${ui.style.command("Ctrl+Space Ctrl+Q")}`);
    });

  program
    .command("build [target]")
    .description("Build/rebuild the container")
    .option("--no-cache", "Build without Docker cache")
    .action(async (target, options) => {
      const host = resolveTarget(target);

      if (!host) {
        requireDocker();
      }

      if (host) {
        console.log(`\n${ui.symbols.package} ${ui.style.bold("Building container on")} ${ui.style.highlight(host)}...\n`);
        try {
          // Sync updated files to remote before building
          const allAgents = Object.values(getAgents());
          if (allAgents.length > 0) {
            console.log(`  ${ui.style.dim("Syncing container files...")}`);
            syncRemoteFiles(host, allAgents);
            ui.item("Files synced", "ok");
            console.log();
          }
          await buildRemote(host, { noCache: !options.cache });
        } catch {
          process.exit(1);
        }
        return;
      }

      console.log(`\n${ui.symbols.package} ${ui.style.bold("Building container...")}\n`);

      if (!existsSync(join(DEFAULT_OUTPUT_DIR, "Dockerfile"))) {
        ui.error("No Dockerfile found.");
        console.log(`\n  Run ${ui.style.command("ccc init")} first to generate the container files.`);
        process.exit(1);
      }

      await buildContainer(DEFAULT_OUTPUT_DIR, { noCache: !options.cache });
    });

  program
    .command("start [target]")
    .description("Start the container")
    .action(async (target, options) => {
      const host = resolveTarget(target);

      if (host) {
        console.log(`\n${ui.symbols.rocket} ${ui.style.bold("Starting container on")} ${ui.style.highlight(host)}...\n`);
        try {
          await startRemote(host);
          ui.hint(`Connect with: ${ui.style.command(`ccc ${target}`)}`);
        } catch {
          process.exit(1);
        }
        return;
      }

      console.log(`\n${ui.symbols.rocket} ${ui.style.bold("Starting container...")}\n`);
      await startContainer(DEFAULT_OUTPUT_DIR);
      ui.success("Container started!");
      ui.hint(`Connect with: ${ui.style.command("ccc")}`);
    });

  program
    .command("ls [target]")
    .description("List all hosts and sessions (or sessions for a specific target)")
    .action((target) => {
      // If specific target provided, just show that one
      if (target) {
        const host = resolveTarget(target);
        if (host) {
          console.log(`\n${ui.symbols.terminal} ${ui.style.bold("Active sessions on")} ${ui.style.highlight(host)}:\n`);
          listRemoteSessions(host);
          return;
        }
        console.log(`\n${ui.symbols.terminal} ${ui.style.bold("Active sessions (local):")}\n`);
        listSessions(DEFAULT_CONTAINER_NAME);
        return;
      }

      // Show all hosts and their sessions
      const remotes = listRemotes();
      const defaultTarget = getDefault();

      console.log(`\n${ui.symbols.terminal} ${ui.style.bold("Hosts & Sessions")}\n`);

      // Local host
      const isLocalDefault = defaultTarget === "local";
      const localMarker = isLocalDefault ? ` ${ui.style.success("(default)")}` : "";
      console.log(`  ${ui.symbols.server} ${ui.style.bold("local")}${localMarker}`);

      const localStatus = getContainerStatus(DEFAULT_CONTAINER_NAME);
      if (!localStatus.exists) {
        console.log(`    ${ui.style.dim("Container not initialized")}`);
      } else if (!localStatus.running) {
        console.log(`    ${ui.style.dim("Container stopped")}`);
      } else {
        if (localStatus.sessions.length === 0) {
          console.log(`    ${ui.style.dim("No active sessions")}`);
        } else {
          for (const session of localStatus.sessions) {
            console.log(`    ${ui.style.dim("•")} ${session}`);
          }
        }
      }
      console.log();

      // Remote hosts
      for (const [name, config] of Object.entries(remotes)) {
        const isDefault = defaultTarget === `@${name}`;
        const marker = isDefault ? ` ${ui.style.success("(default)")}` : "";
        console.log(`  ${ui.symbols.cloud} ${ui.style.bold(`@${name}`)}${marker} ${ui.style.dim(`(${config.host})`)}`);

        const remoteStatus = getRemoteHostStatus(config.host);
        if (!remoteStatus.reachable) {
          console.log(`    ${ui.style.warning("unreachable")}`);
        } else if (!remoteStatus.exists) {
          console.log(`    ${ui.style.dim("Container not initialized")}`);
        } else if (!remoteStatus.running) {
          console.log(`    ${ui.style.dim("Container stopped")}`);
        } else {
          if (remoteStatus.sessions.length === 0) {
            console.log(`    ${ui.style.dim("No active sessions")}`);
          } else {
            for (const session of remoteStatus.sessions) {
              console.log(`    ${ui.style.dim("•")} ${session}`);
            }
          }
        }
        console.log();
      }

      if (Object.keys(remotes).length === 0) {
        console.log(`  ${ui.style.dim("No remotes configured")}`);
        ui.hint(`Add a remote: ${ui.style.command("ccc remote add <name> <user@host>")}`);
      }
    });

  program
    .command("status")
    .description("Show status of all hosts (containers, takopi, sessions, agents)")
    .action(() => {
      const remotes = listRemotes();
      const defaultTarget = getDefault();

      console.log(`\n${ui.symbols.gear} ${ui.style.bold("Host Status")}\n`);

      // Table header
      const hostWidth = 16;
      const statusWidth = 12;
      const takopiWidth = 10;
      const sessionsWidth = 6;

      console.log(
        `  ${ui.style.dim("HOST".padEnd(hostWidth))}` +
          `${ui.style.dim("STATUS".padEnd(statusWidth))}` +
          `${ui.style.dim("TAKOPI".padEnd(takopiWidth))}` +
          `${ui.style.dim("SESS".padEnd(sessionsWidth))}` +
          `${ui.style.dim("AGENTS")}`
      );
      console.log(`  ${ui.style.dim("─".repeat(hostWidth + statusWidth + takopiWidth + sessionsWidth + 20))}`);

      // Helper to format a row with proper padding
      const formatRow = (
        host: string,
        statusIcon: string,
        statusRaw: string,
        statusStyled: string,
        takopiIcon: string,
        takopiRaw: string,
        takopiStyled: string,
        sessions: number,
        agents: string[]
      ) => {
        const statusPad = " ".repeat(Math.max(0, statusWidth - statusRaw.length - 2));
        const takopiPad = " ".repeat(Math.max(0, takopiWidth - takopiRaw.length - 2));
        const sessionsStr = String(sessions);
        const sessionsPad = " ".repeat(Math.max(0, sessionsWidth - sessionsStr.length));
        const agentsStr = agents.length > 0 ? agents.join(", ") : ui.style.dim("-");
        console.log(
          `  ${host.padEnd(hostWidth)}` +
            `${statusIcon} ${statusStyled}${statusPad}` +
            `${takopiIcon} ${takopiStyled}${takopiPad}` +
            `${sessionsStr}${sessionsPad}` +
            `${agentsStr}`
        );
      };

      // Local host
      const localLabel = defaultTarget === "local" ? "local *" : "local";
      const localStatus = getContainerStatus(DEFAULT_CONTAINER_NAME);

      if (!localStatus.exists) {
        formatRow(
          localLabel,
          ui.style.dim("○"), "not init", ui.style.dim("not init"),
          ui.style.dim("-"), "-", ui.style.dim("-"),
          0, []
        );
      } else if (!localStatus.running) {
        formatRow(
          localLabel,
          ui.style.warn(), "stopped", ui.style.warning("stopped"),
          ui.style.dim("-"), "-", ui.style.dim("-"),
          0, []
        );
      } else {
        if (localStatus.takopi) {
          formatRow(
            localLabel,
            ui.style.ok(), "running", ui.style.success("running"),
            ui.style.ok(), "running", ui.style.success("running"),
            localStatus.sessions.length, localStatus.agents
          );
        } else {
          formatRow(
            localLabel,
            ui.style.ok(), "running", ui.style.success("running"),
            ui.style.dim("○"), "off", ui.style.dim("off"),
            localStatus.sessions.length, localStatus.agents
          );
        }
      }

      // Remote hosts
      for (const [name, config] of Object.entries(remotes)) {
        const isDefault = defaultTarget === `@${name}`;
        const label = isDefault ? `@${name} *` : `@${name}`;
        const remoteStatus = getRemoteHostStatus(config.host);

        if (!remoteStatus.reachable) {
          formatRow(
            label,
            ui.style.fail(), "unreachable", ui.style.error("unreachable"),
            ui.style.dim("-"), "-", ui.style.dim("-"),
            0, []
          );
        } else if (!remoteStatus.exists) {
          formatRow(
            label,
            ui.style.dim("○"), "not init", ui.style.dim("not init"),
            ui.style.dim("-"), "-", ui.style.dim("-"),
            0, []
          );
        } else if (!remoteStatus.running) {
          formatRow(
            label,
            ui.style.warn(), "stopped", ui.style.warning("stopped"),
            ui.style.dim("-"), "-", ui.style.dim("-"),
            0, []
          );
        } else {
          if (remoteStatus.takopi) {
            formatRow(
              label,
              ui.style.ok(), "running", ui.style.success("running"),
              ui.style.ok(), "running", ui.style.success("running"),
              remoteStatus.sessions.length, remoteStatus.agents
            );
          } else {
            formatRow(
              label,
              ui.style.ok(), "running", ui.style.success("running"),
              ui.style.dim("○"), "off", ui.style.dim("off"),
              remoteStatus.sessions.length, remoteStatus.agents
            );
          }
        }
      }

      console.log();
      console.log(`  ${ui.style.dim("* = default target")}`);

      ui.hint(`Use ${ui.style.command("ccc ls")} to see session details`);
    });

  program
    .command("kill <session> [target]")
    .description("Kill a session")
    .action((session, target) => {
      const host = resolveTarget(target);

      if (host) {
        killRemoteSession(host, session);
        return;
      }

      killSession(DEFAULT_CONTAINER_NAME, session);
      ui.success(`Session '${session}' killed`);
    });

  program
    .command("logs [target]")
    .description("Show container logs")
    .action((target) => {
      const host = resolveTarget(target);

      if (host) {
        console.log(`\n${ui.symbols.file} ${ui.style.bold("Container logs from")} ${ui.style.highlight(host)}:\n`);
        showRemoteLogs(host);
        return;
      }

      console.log(`\n${ui.symbols.file} ${ui.style.bold("Container logs:")}\n`);
      showLogs(DEFAULT_CONTAINER_NAME);
    });

  program
    .command("restart [target]")
    .description("Restart the container")
    .action((target) => {
      const host = resolveTarget(target);

      if (host) {
        console.log(`\n${ui.symbols.gear} ${ui.style.bold("Restarting container on")} ${ui.style.highlight(host)}...`);
        restartRemote(host);
        return;
      }

      console.log(`\n${ui.symbols.gear} ${ui.style.bold("Restarting container...")}`);
      restartContainer(DEFAULT_CONTAINER_NAME);
      ui.success("Container restarted!");
    });

  program
    .command("update [target]")
    .description("Update agents in the container to latest versions")
    .option("-a, --agent <name>", "Specific agent to update (default: all)")
    .option("--binary", "Update the ccc binary on remote host")
    .action(async (target, options) => {
      const host = resolveTarget(target);
      const containerName = DEFAULT_CONTAINER_NAME;
      const { execSync } = await import("child_process");
      const agents = getAgents();

      // Update binary on remote if requested
      if (options.binary) {
        if (!host) {
          ui.error("--binary flag is only for remote targets");
          console.log(`\n  Usage: ${ui.style.command("ccc update @remote --binary")}`);
          process.exit(1);
        }
        console.log(`\n${ui.symbols.package} ${ui.style.bold("Updating ccc binary on")} ${ui.style.highlight(host)}...\n`);
        try {
          await updateRemoteBinary(host);
          ui.success("Binary updated!");
        } catch (error) {
          ui.error(`Failed to update binary: ${error}`);
          process.exit(1);
        }
        return;
      }

      console.log(`\n${ui.symbols.package} ${ui.style.bold("Updating agents...")}\n`);

      const agentsToUpdate = options.agent
        ? { [options.agent]: agents[options.agent] }
        : agents;

      if (options.agent && !agents[options.agent]) {
        ui.error(`Unknown agent: ${options.agent}`);
        console.log(`  Available agents: ${Object.keys(agents).join(", ")}`);
        process.exit(1);
      }

      for (const [name, agent] of Object.entries(agentsToUpdate)) {
        if (!agent) continue;

        ui.item(`Updating ${name}...`, "pending");

        try {
          const updateCmd = `docker exec ${containerName} bash -c "${agent.installCmd}"`;
          if (host) {
            execSync(`ssh ${host} "${updateCmd}"`, { stdio: "inherit" });
          } else {
            execSync(updateCmd, { stdio: "inherit" });
          }
          ui.item(`${name} updated`, "ok");
        } catch (err) {
          ui.item(`Failed to update ${name}`, "fail");
        }
      }

      ui.success("Update complete!");
    });

  const remoteCmd = program
    .command("remote")
    .description("Manage remote hosts");

  remoteCmd
    .command("add <name> <host>")
    .description("Add a remote host (e.g., ccc remote add myserver user@192.168.1.100)")
    .option("--alias <aliases...>", "Additional aliases for this remote")
    .action((name, host, options) => {
      addRemote(name, host, options.alias);

      console.log(`\n${ui.symbols.check} ${ui.style.success("Remote added!")}\n`);
      ui.keyValue("Name", `@${name}`);
      ui.keyValue("Host", host);
      if (options.alias) {
        ui.keyValue("Aliases", options.alias.join(", "));
      }

      ui.hint(`Initialize container on remote: ${ui.style.command(`ccc init @${name}`)}`);
    });

  remoteCmd
    .command("rm <name>")
    .description("Remove a remote host")
    .action((name) => {
      if (removeRemote(name)) {
        ui.success(`Remote '${name}' removed`);
      } else {
        ui.error(`Remote '${name}' not found`);
        process.exit(1);
      }
    });

  remoteCmd
    .command("ls")
    .description("List configured remotes")
    .action(() => {
      const remotes = listRemotes();
      const defaultTarget = getDefault();

      console.log(`\n${ui.symbols.cloud} ${ui.style.bold("Configured remotes:")}\n`);
      console.log(`  ${ui.style.dim("Default:")} ${ui.style.highlight(defaultTarget)}\n`);

      if (Object.keys(remotes).length === 0) {
        console.log(`  ${ui.style.dim("(no remotes configured)")}\n`);
        ui.hint(`Add a remote: ${ui.style.command("ccc remote add <name> <user@host>")}`);
        return;
      }

      for (const [name, config] of Object.entries(remotes)) {
        const isDefault = defaultTarget === `@${name}`;
        const marker = isDefault ? ` ${ui.style.success("(default)")}` : "";
        console.log(`  ${ui.symbols.server} ${ui.style.bold(`@${name}`)}${marker}`);
        console.log(`    ${ui.style.dim("Host:")} ${config.host}`);
        if (config.alias && config.alias.length > 0) {
          console.log(`    ${ui.style.dim("Aliases:")} ${config.alias.join(", ")}`);
        }
        console.log();
      }
    });

  remoteCmd
    .command("default <target>")
    .description("Set default target (local or @alias)")
    .action((target) => {
      setDefault(target);
      ui.success(`Default target set to: ${ui.style.highlight(target)}`);
    });

  // Agent management commands
  const agentCmd = program.command("agent").description("Manage coding agents");

  agentCmd
    .command("list")
    .alias("ls")
    .description("List available and installed agents with auth status")
    .argument("[target]", "Remote target (@alias) or local")
    .action(async (target) => {
      const host = resolveTarget(target);
      const templates = listAvailableAgents();
      const enabledAgents = getAgents();

      console.log(`\n${ui.symbols.gear} ${ui.style.bold("Agent Status")}`);
      if (host) {
        console.log(`  ${ui.style.dim("Target:")} ${ui.style.highlight(host)}`);
      }
      console.log();

      // Table header
      const nameWidth = 12;
      const statusWidth = 12;
      const authWidth = 22;

      console.log(
        `  ${ui.style.dim("NAME".padEnd(nameWidth))}` +
          `${ui.style.dim("STATUS".padEnd(statusWidth))}` +
          `${ui.style.dim("AUTH".padEnd(authWidth))}` +
          `${ui.style.dim("VERSION")}`
      );
      console.log(`  ${ui.style.dim("─".repeat(60))}`);

      // Check if container is running for installed/auth checks
      let containerRunning = false;
      try {
        if (host) {
          containerRunning = checkRemoteContainerRunning(host);
        } else {
          const { execSync } = await import("child_process");
          const result = execSync(
            `docker inspect -f '{{.State.Running}}' ${DEFAULT_CONTAINER_NAME} 2>/dev/null`,
            { encoding: "utf-8", stdio: "pipe" }
          );
          containerRunning = result.trim() === "true";
        }
      } catch {
        containerRunning = false;
      }

      for (const template of templates) {
        const agent = enabledAgents[template.name];
        const config = getAgentConfig(template.name);
        const isEnabled = isAgentEnabled(template.name);

        let statusIcon: string;
        let statusText: string;
        let authIcon: string;
        let authText: string;
        let version = "-";

        if (!isEnabled) {
          statusIcon = ui.style.dim("○");
          statusText = ui.style.dim("available");
          authIcon = ui.style.dim("-");
          authText = ui.style.dim("-");
        } else if (!agent) {
          statusIcon = ui.style.warn();
          statusText = ui.style.warning("error");
          authIcon = ui.style.dim("-");
          authText = ui.style.dim("-");
        } else if (!containerRunning) {
          statusIcon = ui.style.ok();
          statusText = ui.style.success("enabled");
          authIcon = ui.style.dim("?");
          authText = ui.style.dim("container stopped");
        } else {
          // Check if installed in container
          const installStatus = checkAgentInstalled(agent, { host });

          if (!installStatus.installed) {
            statusIcon = ui.style.ok();
            statusText = ui.style.success("enabled");
            authIcon = ui.style.dim("-");
            authText = ui.style.dim("not installed");
          } else {
            statusIcon = ui.style.ok();
            statusText = ui.style.success("enabled");
            version = installStatus.version || "-";

            // Check auth status
            if (config) {
              const authStatus = checkAuthStatus(agent, config, { host });
              if (authStatus.authenticated) {
                authIcon = ui.style.ok();
                authText = ui.style.success(authStatus.details || "authenticated");
              } else {
                authIcon = ui.style.dim("○");
                authText = ui.style.dim(authStatus.details || "not authenticated");
              }
            } else {
              authIcon = ui.style.dim("-");
              authText = ui.style.dim("unknown");
            }
          }
        }

        // Truncate version if too long
        if (version.length > 20) {
          version = version.substring(0, 17) + "...";
        }

        console.log(
          `  ${template.name.padEnd(nameWidth)}` +
            `${statusIcon} ${statusText.padEnd(statusWidth - 2)}` +
            `${authIcon} ${authText.padEnd(authWidth - 2)}` +
            `${ui.style.dim(version)}`
        );
      }

      // Show default agent
      const defaultAgent = getDefaultAgent();
      if (defaultAgent) {
        console.log(`\n  ${ui.style.dim("Default:")} ${ui.style.highlight(defaultAgent)}`);
      }

      ui.hint(`Add agent: ${ui.style.command("ccc agent add <name>")}`);
    });

  agentCmd
    .command("add <name>")
    .description("Add an agent (enables config, rebuilds container, runs auth)")
    .argument("[target]", "Remote target (@alias) or local")
    .option("--no-build", "Only enable config, skip rebuild (for adding multiple agents)")
    .option("--no-cache", "Build without Docker cache")
    .action(async (name, target, options) => {
      const host = resolveTarget(target);
      const templates = listAvailableAgents();
      const template = templates.find((t) => t.name === name);

      if (!template) {
        ui.error(`Unknown agent: ${name}`);
        console.log(`\n  Available agents: ${templates.map((t) => t.name).join(", ")}`);
        process.exit(1);
      }

      console.log(`\n${ui.symbols.sparkles} ${ui.style.bold("Adding agent:")} ${ui.style.highlight(name)}\n`);

      // Step 1: Enable the agent config
      ui.header("Step 1: Enable agent config");
      if (isAgentEnabled(name)) {
        ui.item(`${name} already enabled`, "ok");
      } else {
        const enabled = enableAgents([name]);
        if (enabled.length > 0) {
          ui.item(`Enabled ${name}`, "ok");
        }
      }

      // Set as default if first agent
      if (!getDefaultAgent()) {
        setDefaultAgent(name);
        ui.item(`Set ${name} as default agent`, "ok");
      }

      // Step 2: Regenerate files and rebuild container
      if (options.build) {
        ui.header("Step 2: Regenerate and rebuild container");

        // Regenerate Docker files with all enabled agents
        const allAgents = Object.values(getAgents());
        if (allAgents.length === 0) {
          ui.error("No agents enabled");
          process.exit(1);
        }

        try {
          if (host) {
            // Regenerate and sync files to remote, then rebuild
            console.log(`  ${ui.style.dim("Syncing container files to remote...")}`);
            syncRemoteFiles(host, allAgents);
            ui.item("Files synced to remote", "ok");

            console.log(`\n  ${ui.style.dim("Building container...")}\n`);
            await buildRemote(host, { noCache: !options.cache });
          } else {
            if (!existsSync(join(DEFAULT_OUTPUT_DIR, "Dockerfile"))) {
              ui.error("No Dockerfile found. Run 'ccc init' first.");
              process.exit(1);
            }

            // Regenerate files with all agents
            console.log(`  ${ui.style.dim("Regenerating Docker files with all agents...")}`);
            const allExtensions = Object.values(loadExtensions());
            const allUserDomains = getUserFirewallDomains();
            generateFiles({
              agents: allAgents,
              outputDir: DEFAULT_OUTPUT_DIR,
              extensions: allExtensions,
              userFirewallDomains: allUserDomains,
            });

            // Build container
            console.log(`\n  ${ui.style.dim("Building container...")}\n`);
            await buildContainer(DEFAULT_OUTPUT_DIR, { noCache: !options.cache });
          }
          ui.item("Container rebuilt", "ok");

          // Restart container after rebuild (force recreate to use new image)
          console.log(`\n  ${ui.style.dim("Restarting container...")}`);
          if (host) {
            await startRemote(host);
          } else {
            await startContainer(DEFAULT_OUTPUT_DIR, true); // force recreate
          }
          ui.item("Container started", "ok");
        } catch (err) {
          ui.error("Build failed");
          process.exit(1);
        }

        // Step 3: Run auth
        ui.header("Step 3: Authenticate");
        const agents = getAgents();
        const agent = agents[name];
        const config = getAgentConfig(name);

        if (agent && config) {
          console.log(`  ${ui.style.dim(config.auth?.instructions || agent.getAuthInstructions())}\n`);
          runAgentAuth(agent, config, { host });

          // Verify
          const authStatus = checkAuthStatus(agent, config, { host });
          if (authStatus.authenticated) {
            ui.success(`${name} is ready!`);
          } else {
            ui.hint("If auth didn't complete, run: " + ui.style.command(`ccc agent auth ${name}`));
          }
        }
      } else {
        ui.success(`Agent '${name}' config enabled!`);
        ui.hint(`Run ${ui.style.command("ccc agent add <more-agents> --no-build")} to add more`);
        ui.hint(`Then ${ui.style.command("ccc build && ccc agent auth " + name)} to install and authenticate`);
      }
    });

  agentCmd
    .command("rm <name>")
    .alias("remove")
    .description("Remove an agent")
    .argument("[target]", "Remote target (@alias) or local")
    .action(async (name, target) => {
      const host = resolveTarget(target);

      if (!isAgentEnabled(name)) {
        ui.error(`Agent '${name}' is not enabled`);
        process.exit(1);
      }

      // Disable (remove TOML)
      if (disableAgent(name)) {
        ui.item(`Disabled ${name} config`, "ok");
      }

      // Update default if removed
      if (getDefaultAgent() === name) {
        const remaining = Object.keys(getAgents());
        if (remaining.length > 0 && remaining[0]) {
          setDefaultAgent(remaining[0]);
          ui.item(`Default agent changed to ${remaining[0]}`, "ok");
        }
      }

      ui.success(`Agent '${name}' removed!`);
      ui.hint("Note: Agent binary remains in container. Rebuild to fully remove.");
    });

  agentCmd
    .command("auth <name>")
    .description("Authenticate an agent")
    .argument("[target]", "Remote target (@alias) or local")
    .action(async (name, target) => {
      const host = resolveTarget(target);
      const agents = getAgents();
      const agent = agents[name];

      if (!agent) {
        ui.error(`Agent '${name}' not found or not enabled`);
        const templates = listAvailableAgents();
        if (templates.find((t) => t.name === name)) {
          ui.hint(`Enable it first: ${ui.style.command(`ccc agent add ${name}`)}`);
        }
        process.exit(1);
      }

      const config = getAgentConfig(name);
      if (!config) {
        ui.error("Could not load agent config");
        process.exit(1);
      }

      // Check if container is running
      let containerRunning = false;
      try {
        if (host) {
          containerRunning = checkRemoteContainerRunning(host);
        } else {
          const { execSync } = await import("child_process");
          const result = execSync(
            `docker inspect -f '{{.State.Running}}' ${DEFAULT_CONTAINER_NAME} 2>/dev/null`,
            { encoding: "utf-8", stdio: "pipe" }
          );
          containerRunning = result.trim() === "true";
        }
      } catch {
        containerRunning = false;
      }

      if (!containerRunning) {
        ui.error("Container is not running");
        ui.hint(`Start it first: ${ui.style.command("ccc start")}`);
        process.exit(1);
      }

      console.log(
        `\n${ui.symbols.key} ${ui.style.bold("Authenticating")} ${ui.style.highlight(name)}`
      );
      console.log(`\n  ${ui.style.dim(config.auth?.instructions || agent.getAuthInstructions())}`);
      console.log();

      // Run interactive auth
      const success = runAgentAuth(agent, config, { host });

      if (success) {
        // Verify auth status
        const authStatus = checkAuthStatus(agent, config, { host });
        if (authStatus.authenticated) {
          ui.success(`${name} authenticated!`);
        } else {
          ui.warning("Auth flow completed but verification failed");
          ui.hint("This is normal for some agents. Try running the agent to verify.");
        }
      } else {
        ui.error("Authentication failed");
      }
    });

  agentCmd
    .command("default [name]")
    .description("Get or set the default agent")
    .action((name) => {
      if (!name) {
        const current = getDefaultAgent();
        if (current) {
          console.log(
            `\n${ui.symbols.star} ${ui.style.bold("Default agent:")} ${ui.style.highlight(current)}`
          );
        } else {
          console.log(`\n${ui.style.dim("No default agent set")}`);
          ui.hint(`Set one: ${ui.style.command("ccc agent default <name>")}`);
        }
        return;
      }

      const agents = getAgents();
      if (!agents[name]) {
        ui.error(`Agent '${name}' not found or not enabled`);
        console.log(`\n  Enabled agents: ${Object.keys(agents).join(", ") || "(none)"}`);
        process.exit(1);
      }

      setDefaultAgent(name);
      ui.success(`Default agent set to: ${ui.style.highlight(name)}`);
    });

  // Firewall management commands
  const firewallCmd = program.command("firewall").description("Manage firewall domains");

  firewallCmd
    .command("list")
    .alias("ls")
    .description("List all firewall domains by source")
    .action(() => {
      const agents = getAgents();
      const extensions = loadExtensions();
      const userDomains = getUserFirewallDomains();

      console.log(`\n${ui.symbols.shield} ${ui.style.bold("Firewall Domains")}\n`);

      // Agent domains
      console.log(`  ${ui.style.bold("Agents:")}`);
      if (Object.keys(agents).length === 0) {
        console.log(`    ${ui.style.dim("(no agents enabled)")}`);
      } else {
        for (const [name, agent] of Object.entries(agents)) {
          if (agent.firewallDomains.length > 0) {
            console.log(`    ${ui.style.highlight(name)} ${ui.style.dim(`(${agent.firewallDomains.length} domains)`)}`);
            for (const domain of agent.firewallDomains) {
              console.log(`      ${ui.style.dim("•")} ${domain}`);
            }
          }
        }
      }
      console.log();

      // Extension domains
      console.log(`  ${ui.style.bold("Extensions:")}`);
      if (Object.keys(extensions).length === 0) {
        console.log(`    ${ui.style.dim("(no extensions enabled)")}`);
        ui.hint(`Enable extensions: ${ui.style.command("ccc extension add takopi")}`);
      } else {
        for (const [name, ext] of Object.entries(extensions)) {
          if (ext.firewallDomains.length > 0) {
            console.log(`    ${ui.style.highlight(name)} ${ui.style.dim(`(${ext.firewallDomains.length} domains)`)}`);
            for (const domain of ext.firewallDomains) {
              console.log(`      ${ui.style.dim("•")} ${domain}`);
            }
          }
        }
      }
      console.log();

      // User domains
      console.log(`  ${ui.style.bold("User:")}`);
      if (userDomains.length === 0) {
        console.log(`    ${ui.style.dim("(no custom domains)")}`);
        ui.hint(`Add custom domain: ${ui.style.command("ccc firewall add example.com")}`);
      } else {
        for (const domain of userDomains) {
          console.log(`    ${ui.style.dim("•")} ${domain}`);
        }
      }
      console.log();

      // Total count
      const allDomains = new Set<string>();
      for (const agent of Object.values(agents)) {
        for (const d of agent.firewallDomains) allDomains.add(d);
      }
      for (const ext of Object.values(extensions)) {
        for (const d of ext.firewallDomains) allDomains.add(d);
      }
      for (const d of userDomains) allDomains.add(d);

      console.log(`  ${ui.style.dim("Total unique domains:")} ${ui.style.highlight(String(allDomains.size))}`);
      ui.hint(`Config file: ${ui.style.path(getFirewallConfigPath())}`);
    });

  firewallCmd
    .command("add <domain>")
    .description("Add a custom firewall domain")
    .action((domain) => {
      if (addUserFirewallDomain(domain)) {
        ui.success(`Added domain: ${ui.style.highlight(domain)}`);
        ui.hint("Rebuild container to apply: " + ui.style.command("ccc build"));
      } else {
        ui.warning(`Domain already exists: ${domain}`);
      }
    });

  firewallCmd
    .command("rm <domain>")
    .alias("remove")
    .description("Remove a custom firewall domain")
    .action((domain) => {
      if (removeUserFirewallDomain(domain)) {
        ui.success(`Removed domain: ${domain}`);
        ui.hint("Rebuild container to apply: " + ui.style.command("ccc build"));
      } else {
        ui.error(`Domain not found: ${domain}`);
        ui.hint("Note: Only user-added domains can be removed. Agent and extension domains are managed via their configs.");
      }
    });

  // Extension management commands
  const extensionCmd = program.command("extension").description("Manage extensions (takopi, context7, etc.)");

  extensionCmd
    .command("list")
    .alias("ls")
    .description("List available and enabled extensions")
    .action(() => {
      const templates = listAvailableExtensions();
      const enabled = loadExtensions();

      console.log(`\n${ui.symbols.gear} ${ui.style.bold("Extensions")}\n`);

      // Group by type
      const byType: Record<string, typeof templates> = { host: [], mcp: [], skill: [] };
      for (const t of templates) {
        const type = t.type || "host";
        if (!byType[type]) byType[type] = [];
        byType[type]!.push(t);
      }

      const typeLabels: Record<string, string> = {
        host: "Host Services",
        mcp: "MCP Servers",
        skill: "Agent Skills",
      };

      for (const [type, list] of Object.entries(byType)) {
        if (list.length === 0) continue;

        console.log(`  ${ui.style.bold(typeLabels[type] || type)}`);

        for (const template of list) {
          const isEnabled = isExtensionEnabled(template.name);
          const ext = enabled[template.name];
          const statusIcon = isEnabled ? ui.style.ok() : ui.style.dim("○");
          const statusText = isEnabled ? ui.style.success("enabled") : ui.style.dim("available");

          // For host extensions, show running status
          let runningStatus = "";
          if (type === "host" && isEnabled && ext?.runCmd) {
            const running = isHostExtensionRunning(ext);
            runningStatus = running ? ` ${ui.style.success("(running)")}` : ` ${ui.style.dim("(stopped)")}`;
          }

          console.log(`    ${statusIcon} ${ui.style.bold(template.name)} ${statusText}${runningStatus}`);
          console.log(`      ${ui.style.dim(template.description)}`);
        }
        console.log();
      }

      ui.hint(`Enable: ${ui.style.command("ccc extension add <name>")}`);
    });

  extensionCmd
    .command("add <name>")
    .description("Enable an extension")
    .action((name) => {
      const templates = listAvailableExtensions();
      const template = templates.find((t) => t.name === name);

      if (!template) {
        ui.error(`Unknown extension: ${name}`);
        console.log(`\n  Available: ${templates.map((t) => t.name).join(", ")}`);
        process.exit(1);
      }

      if (isExtensionEnabled(name)) {
        ui.warning(`Extension '${name}' is already enabled`);
        return;
      }

      const enabled = enableExtensions([name]);
      if (enabled.length > 0) {
        ui.success(`Enabled extension: ${ui.style.highlight(name)}`);

        // Get the full extension config
        const ext = loadExtensions()[name];
        if (!ext) return;

        // Handle type-specific setup
        switch (ext.type) {
          case "mcp":
            // Inject MCP config into all agents
            const agents = Object.values(getAgents());
            const injected = injectMcpConfigToAllAgents(agents, ext);
            if (injected.length > 0) {
              ui.item(`MCP config injected for: ${injected.join(", ")}`, "ok");
            }
            break;

          case "skill":
            // Install skill file to ~/.ccc/skills/ (mounted into container)
            if (installSkill(ext)) {
              ui.item("Skill file installed", "ok");
            }
            // Note: Symlinks to agent skill paths are created by entrypoint inside container
            break;

          case "host":
            ui.hint("Start with: " + ui.style.command(`ccc extension start ${name}`));
            break;
        }

        ui.hint("Rebuild container to apply firewall changes: " + ui.style.command("ccc build"));
      }
    });

  extensionCmd
    .command("rm <name>")
    .alias("remove")
    .description("Disable an extension")
    .action((name) => {
      if (!isExtensionEnabled(name)) {
        ui.error(`Extension '${name}' is not enabled`);
        process.exit(1);
      }

      // Get extension before disabling
      const ext = loadExtensions()[name];

      // Handle type-specific cleanup
      if (ext) {
        switch (ext.type) {
          case "mcp":
            // Remove MCP config from all agents
            const agents = Object.values(getAgents());
            removeMcpConfigFromAllAgents(agents, name);
            break;

          case "skill":
            // Remove skill file
            removeSkill(ext);
            break;

          case "host":
            // Stop if running
            if (ext.runCmd) {
              stopHostExtension(ext);
            }
            break;
        }
      }

      if (disableExtension(name)) {
        ui.success(`Disabled extension: ${name}`);
        ui.hint("Rebuild container to apply firewall changes: " + ui.style.command("ccc build"));
      }
    });

  extensionCmd
    .command("start <name>")
    .description("Start a host extension")
    .action((name) => {
      const ext = loadExtensions()[name];
      if (!ext) {
        ui.error(`Extension '${name}' not found or not enabled`);
        process.exit(1);
      }

      if (ext.type !== "host") {
        ui.error(`Extension '${name}' is not a host extension (type: ${ext.type})`);
        process.exit(1);
      }

      if (!ext.runCmd) {
        ui.error(`Extension '${name}' has no run command`);
        process.exit(1);
      }

      console.log(`\n${ui.symbols.rocket} ${ui.style.bold("Starting")} ${ui.style.highlight(name)}...\n`);

      // Install if needed
      if (ext.installCmd) {
        ui.item("Checking installation...", "pending");
        installHostExtension(ext);
      }

      // Start
      if (startHostExtension(ext)) {
        ui.success(`${name} started!`);
      } else {
        ui.error(`Failed to start ${name}`);
      }
    });

  extensionCmd
    .command("stop <name>")
    .description("Stop a host extension")
    .action((name) => {
      const ext = loadExtensions()[name];
      if (!ext) {
        ui.error(`Extension '${name}' not found or not enabled`);
        process.exit(1);
      }

      if (ext.type !== "host") {
        ui.error(`Extension '${name}' is not a host extension (type: ${ext.type})`);
        process.exit(1);
      }

      console.log(`\n${ui.symbols.gear} ${ui.style.bold("Stopping")} ${ui.style.highlight(name)}...\n`);

      if (stopHostExtension(ext)) {
        ui.success(`${name} stopped`);
      } else {
        ui.warning(`${name} was not running or stop failed`);
      }
    });

  program
    .command("setup-ssh")
    .description("Generate SSH key for local machine")
    .action(async () => {
      const sshDir = join(homedir(), ".ssh");
      const keyPath = join(sshDir, "id_ed25519");

      console.log(`\n${ui.symbols.key} ${ui.style.bold("SSH Key Setup")}\n`);

      if (existsSync(keyPath)) {
        ui.item("SSH key already exists", "ok");
        const pubKey = readFileSync(`${keyPath}.pub`, "utf-8").trim();
        console.log(`\n  ${ui.style.dim("Public key:")}`);
        console.log(`  ${ui.style.info(pubKey)}`);
        return;
      }

      console.log(`  ${ui.style.dim("Generating new ed25519 key...")}\n`);
      const { execSync } = await import("child_process");
      execSync(`ssh-keygen -t ed25519 -f "${keyPath}" -N ""`, {
        stdio: "inherit",
      });

      ui.success("SSH key generated!");
      const pubKey = readFileSync(`${keyPath}.pub`, "utf-8").trim();
      console.log(`\n  ${ui.style.dim("Public key (add to GitHub/remote hosts):")}`);
      console.log(`  ${ui.style.info(pubKey)}`);
    });

  program
    .command("setup-takopi")
    .description("Install and configure Telegram bot for takopi notifications")
    .argument("[target]", "Remote target (@alias) or local")
    .option("--token <token>", "Telegram bot token")
    .option("--chat-id <id>", "Telegram chat ID")
    .action(async (target, options) => {
      console.log(`\n${ui.symbols.sparkles} ${ui.style.bold("Takopi Setup")}\n`);

      const isRemote = target?.startsWith("@");
      const host = isRemote ? resolveTarget(target) : null;
      const containerName = DEFAULT_CONTAINER_NAME;

      const { execSync } = await import("child_process");
      try {
        if (isRemote && host) {
          execSync(`ssh ${host} "docker inspect ${containerName}" >/dev/null 2>&1`);
        } else {
          execSync(`docker inspect ${containerName} >/dev/null 2>&1`);
        }
      } catch {
        ui.error("Container not running. Start it first with: ccc start");
        process.exit(1);
      }

      ui.header(ui.step(1, 4, "Installing takopi"));
      try {
        const installCmd = `docker exec ${containerName} uv tool install takopi`;
        if (isRemote && host) {
          execSync(`ssh ${host} "${installCmd}"`, { stdio: "inherit" });
        } else {
          execSync(installCmd, { stdio: "inherit" });
        }
        ui.item("takopi installed", "ok");
      } catch {
        ui.item("takopi already installed or install failed", "warn");
      }

      ui.header(ui.step(2, 4, "Configuration"));

      if (!options.token || !options.chatId) {
        console.log(`\n  ${ui.style.dim("To get your credentials:")}`);
        console.log(`  ${ui.style.dim("1.")} Create a bot with ${ui.style.command("@BotFather")} on Telegram`);
        console.log(`  ${ui.style.dim("2.")} Get your chat ID from ${ui.style.command("@userinfobot")}\n`);

        if (!options.token) {
          console.log(`  ${ui.style.dim("Then run:")}`);
          ui.showCommand(`ccc setup-takopi${target ? " " + target : ""} --token YOUR_TOKEN --chat-id YOUR_CHAT_ID`);
          return;
        }
      }

      ui.header(ui.step(3, 4, "Creating config"));

      const config = `bot_token = "${options.token}"
chat_id = ${options.chatId}
default_engine = "claude"`;

      const configB64 = Buffer.from(config, "utf-8").toString("base64");
      const configCmd = `docker exec ${containerName} sh -c "mkdir -p /home/ccc/.takopi && printf %s '${configB64}' | base64 -d > /home/ccc/.takopi/takopi.toml"`;

      try {
        if (isRemote && host) {
          sshExec(host, configCmd, { stdio: "pipe" });
        } else {
          execSync(configCmd, { stdio: "pipe" });
        }
        ui.item("Config created at ~/.takopi/takopi.toml", "ok");
      } catch (error) {
        ui.error("Failed to create config");
        throw error;
      }

      ui.header(ui.step(4, 4, "Starting takopi"));

      const killCmd = `docker exec ${containerName} pkill -f takopi 2>/dev/null || true`;
      const startCmd = `docker exec -d ${containerName} takopi`;

      try {
        if (isRemote && host) {
          execSync(`ssh ${host} "${killCmd}"`, { stdio: "pipe" });
          execSync(`ssh ${host} "${startCmd}"`, { stdio: "pipe" });
        } else {
          execSync(killCmd, { stdio: "pipe" });
          execSync(startCmd, { stdio: "pipe" });
        }
        ui.item("takopi running in background", "ok");
      } catch (error) {
        ui.error("Failed to start takopi");
        throw error;
      }

      ui.success("Takopi is now running!");
      console.log(`\n  ${ui.style.dim("Check status:")}`);
      ui.showCommand(`docker exec ${containerName} ps aux | grep takopi`);
      ui.hint("Takopi will listen for Telegram messages and respond automatically");
    });

  return program;
}
