import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

import { loadAgents, listAvailableAgents, enableAgents, getAgentsDir } from "./agents/loader.ts";
import type { Agent } from "./agents/types.ts";
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

export function createCLI(): Command {
  const program = new Command();

  program
    .name("ccc")
    .description("Coding Container CLI - Setup coding agents in Docker with firewall support")
    .version("0.1.0")
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
    .option("-o, --output <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
    .option("--no-build", "Skip building the container")
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

        try {
          await initRemote(host, selectedAgents, { build: options.build });
        } catch (error) {
          process.exit(1);
        }
        return;
      }

      ui.welcome();
      console.log(`${ui.symbols.rocket} ${ui.style.bold("Initializing local coding container...")}\n`);
      console.log(`  ${ui.style.dim("Agents:")} ${selectedAgents.map((a) => a.name).join(", ")}\n`);

      ui.header(ui.step(1, 4, "Checking SSH keys"));
      const localSshKey = join(homedir(), ".ssh", "id_ed25519");
      if (existsSync(localSshKey)) {
        ui.item(`Local SSH key found: ${ui.style.path(localSshKey)}`, "ok");
      } else {
        ui.item("No local SSH key found", "warn");
        ui.hint(`Run ${ui.style.command("ccc setup-ssh")} to generate one`);
      }

      ui.header(ui.step(2, 4, "Generating container files"));
      generateFiles({
        agents: selectedAgents,
        outputDir: options.output,
      });

      ui.header(ui.step(3, 4, "Setting up container SSH key"));
      const sshDir = join(options.output, "ssh-keys");
      await generateContainerSSHKeys(options.output);

      const pubKeyPath = join(sshDir, "id_ed25519.pub");
      if (existsSync(pubKeyPath)) {
        const pubKey = readFileSync(pubKeyPath, "utf-8").trim();
        console.log(`\n  ${ui.symbols.key} ${ui.style.bold("Container SSH public key")} ${ui.style.dim("(add to GitHub):")}`);
        console.log(`  ${ui.style.dim("─".repeat(60))}`);
        console.log(`  ${ui.style.info(pubKey)}`);
        console.log(`  ${ui.style.dim("─".repeat(60))}`);
      }

      ui.header(ui.step(4, 4, "Container setup"));

      console.log(`\n  ${ui.symbols.folder} Output directory: ${ui.style.path(options.output)}`);

      if (options.build) {
        console.log(`\n  ${ui.symbols.package} Building container... ${ui.style.dim("(this may take a few minutes)")}`);
        await buildContainer(options.output);
      } else {
        console.log(`\n  ${ui.style.dim("Files created. To build the container:")}`);
        ui.showCommand(`cd ${options.output} && docker compose build`);
        console.log(`\n  ${ui.style.dim("Or simply run:")}`);
        ui.showCommand("ccc build");
      }

      ui.success("Container initialized!");

      console.log(`\n  ${ui.symbols.lightning} ${ui.style.bold("Next steps:")}`);
      console.log(`  ${ui.style.dim("1.")} Edit ${ui.style.path(`${options.output}/.env`)} with your Git config`);
      console.log(`  ${ui.style.dim("2.")} Add the SSH key above to GitHub`);
      console.log(`  ${ui.style.dim("3.")} Build the container: ${ui.style.command("ccc build")}`);
      console.log(`  ${ui.style.dim("4.")} Start coding: ${ui.style.command("ccc")}`);

      ui.hint(`Detach from session: ${ui.style.command("Ctrl+Space Ctrl+Q")}`);
    });

  program
    .command("build [target]")
    .description("Build/rebuild the container")
    .option("-o, --output <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
    .action(async (target, options) => {
      const host = resolveTarget(target);

      if (!host) {
        requireDocker();
      }

      if (host) {
        console.log(`\n${ui.symbols.package} ${ui.style.bold("Building container on")} ${ui.style.highlight(host)}...\n`);
        try {
          await buildRemote(host);
        } catch {
          process.exit(1);
        }
        return;
      }

      console.log(`\n${ui.symbols.package} ${ui.style.bold("Building container...")}\n`);

      if (!existsSync(join(options.output, "Dockerfile"))) {
        ui.error("No Dockerfile found.");
        console.log(`\n  Run ${ui.style.command("ccc init")} first to generate the container files.`);
        process.exit(1);
      }

      await buildContainer(options.output);
    });

  program
    .command("start [target]")
    .description("Start the container")
    .option("-o, --output <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
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
      await startContainer(options.output);
      ui.success("Container started!");
      ui.hint(`Connect with: ${ui.style.command("ccc")}`);
    });

  program
    .command("ls [target]")
    .description("List active sessions")
    .action((target) => {
      const host = resolveTarget(target);

      if (host) {
        console.log(`\n${ui.symbols.terminal} ${ui.style.bold("Active sessions on")} ${ui.style.highlight(host)}:\n`);
        listRemoteSessions(host);
        return;
      }

      console.log(`\n${ui.symbols.terminal} ${ui.style.bold("Active sessions:")}\n`);
      listSessions(DEFAULT_CONTAINER_NAME);
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
    .action(async (target, options) => {
      const host = resolveTarget(target);
      const containerName = DEFAULT_CONTAINER_NAME;
      const { execSync } = await import("child_process");
      const agents = getAgents();

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
          const updateCmd = `docker exec ${containerName} sh -c "${agent.installCmd}"`;
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

  program
    .command("setup-tailscale")
    .description("Generate SSH config for multi-device access")
    .option("--host <name>", "Host alias in SSH config", "ccc-vps")
    .option("--ip <address>", "IP address or hostname (required)")
    .option("--user <name>", "SSH user", "ubuntu")
    .action((options) => {
      console.log(`\n${ui.symbols.link} ${ui.style.bold("Multi-Device SSH Setup")}\n`);

      if (!options.ip) {
        ui.error("Please provide --ip <address>");
        console.log(`\n  Example: ${ui.style.command("ccc setup-tailscale --ip 100.x.x.x")}`);
        process.exit(1);
      }

      console.log(`  Add this to ${ui.style.path("~/.ssh/config")} on your devices:\n`);
      console.log(`  ${ui.style.dim("─".repeat(50))}`);
      console.log(`  ${ui.style.info(`Host ${options.host}`)}`);
      console.log(`  ${ui.style.info(`    HostName ${options.ip}`)}`);
      console.log(`  ${ui.style.info(`    User ${options.user}`)}`);
      console.log(`  ${ui.style.info(`    RemoteCommand /home/${options.user}/bin/ccc-server`)}`);
      console.log(`  ${ui.style.info(`    RequestTTY yes`)}`);
      console.log(`  ${ui.style.dim("─".repeat(50))}`);

      console.log(`\n  ${ui.style.dim("Then connect from any device:")}`);
      ui.showCommand(`ssh ${options.host}`);

      ui.hint("Works with any SSH client (laptop, phone, tablet)");
    });

  return program;
}
