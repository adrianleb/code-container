import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as TOML from "@iarna/toml";

const CONFIG_DIR = join(homedir(), ".config", "ccc");
const CONFIG_FILE = join(CONFIG_DIR, "config.toml");
const HOSTNAME_PATTERN = /^[A-Za-z0-9._~:%\-[\]]+$/;

function assertValidHost(host: string): void {
  if (!host) {
    console.error("Invalid host: empty value");
    process.exit(1);
  }

  const parts = host.split("@");
  if (parts.length > 2) {
    console.error(`Invalid host: ${host}`);
    process.exit(1);
  }

  const [user, hostname] = parts.length === 2 ? parts : [undefined, parts[0]];
  if (parts.length === 2 && (!user || !hostname)) {
    console.error(`Invalid host: ${host}`);
    process.exit(1);
  }

  if (user && !/^[A-Za-z0-9._~-]+$/.test(user)) {
    console.error(`Invalid host: ${host}`);
    process.exit(1);
  }

  if (!hostname || !HOSTNAME_PATTERN.test(hostname)) {
    console.error(`Invalid host: ${host}`);
    process.exit(1);
  }
}

export interface RemoteConfig {
  host: string;
  alias?: string[];
}

export interface Config {
  default: string;
  default_agent?: string;
  remotes: Record<string, RemoteConfig>;
}

const DEFAULT_CONFIG: Config = {
  default: "local",
  default_agent: undefined,
  remotes: {},
};

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureConfigDir();

  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = TOML.parse(content) as unknown as Config;
    return {
      default: parsed.default || "local",
      default_agent: parsed.default_agent,
      remotes: parsed.remotes || {},
    };
  } catch (error) {
    console.error(`Warning: Could not parse config file: ${error}`);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const content = TOML.stringify(config as unknown as TOML.JsonMap);
  writeFileSync(CONFIG_FILE, content);
}

export function resolveTarget(target?: string): string | null {
  const config = loadConfig();

  if (!target) {
    target = config.default;
  }

  if (target === "local") {
    return null;
  }

  if (target.includes("@") && !target.startsWith("@")) {
    assertValidHost(target);
    return target;
  }

  const aliasName = target.startsWith("@") ? target : `@${target}`;

  for (const [name, remote] of Object.entries(config.remotes)) {
    if (`@${name}` === aliasName) {
      assertValidHost(remote.host);
      return remote.host;
    }
    if (remote.alias?.some((alias) => (alias.startsWith("@") ? alias : `@${alias}`) === aliasName)) {
      assertValidHost(remote.host);
      return remote.host;
    }
  }

  console.error(`Unknown remote: ${target}`);
  console.error(`Use 'ccc remote add <name> <user@host>' to register a remote.`);
  process.exit(1);
}

export function addRemote(name: string, host: string, aliases?: string[]): void {
  const config = loadConfig();
  assertValidHost(host);

  config.remotes[name] = {
    host,
    alias: aliases,
  };

  saveConfig(config);
}

export function removeRemote(name: string): boolean {
  const config = loadConfig();

  if (!config.remotes[name]) {
    return false;
  }

  delete config.remotes[name];

  if (config.default === `@${name}`) {
    config.default = "local";
  }

  saveConfig(config);
  return true;
}

export function setDefault(target: string): void {
  const config = loadConfig();
  config.default = target;
  saveConfig(config);
}

export function listRemotes(): Record<string, RemoteConfig> {
  const config = loadConfig();
  return config.remotes;
}

export function getDefault(): string {
  const config = loadConfig();
  return config.default;
}

export function getDefaultAgent(): string | undefined {
  const config = loadConfig();
  return config.default_agent;
}

export function setDefaultAgent(agent: string): void {
  const config = loadConfig();
  config.default_agent = agent;
  saveConfig(config);
}
