import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as TOML from "@iarna/toml";
import type { Extension, ExtensionConfig, ExtensionType } from "./types.ts";
import { getExtensionTemplate, getAvailableExtensionTemplates, type ExtensionTemplate } from "./templates.ts";

const EXTENSIONS_DIR = join(homedir(), ".config", "ccc", "extensions");

function configToExtension(config: ExtensionConfig): Extension {
  return {
    name: config.name,
    type: config.type || "host", // default to host for backwards compat
    description: config.description || config.name,
    firewallDomains: config.firewall?.domains || [],
    installCmd: config.install_cmd,
    runCmd: config.run_cmd,
    mcp: config.mcp,
    skill: config.skill,
  };
}

export function loadExtensions(): Record<string, Extension> {
  const extensions: Record<string, Extension> = {};

  if (!existsSync(EXTENSIONS_DIR)) {
    return extensions;
  }

  try {
    const files = readdirSync(EXTENSIONS_DIR).filter((f) => f.endsWith(".toml"));

    for (const file of files) {
      try {
        const filePath = join(EXTENSIONS_DIR, file);
        const content = readFileSync(filePath, "utf-8");
        const config = TOML.parse(content) as unknown as ExtensionConfig;

        if (!config.name) {
          console.warn(`Skipping ${file}: missing required field (name)`);
          continue;
        }

        extensions[config.name] = configToExtension(config);
      } catch (err) {
        console.warn(`Failed to load extension from ${file}:`, err);
      }
    }
  } catch {}

  return extensions;
}

export function loadExtensionsByType(type: ExtensionType): Extension[] {
  const all = loadExtensions();
  return Object.values(all).filter((ext) => ext.type === type);
}

export function getExtensionsDir(): string {
  return EXTENSIONS_DIR;
}

export function listAvailableExtensions(): ExtensionTemplate[] {
  return getAvailableExtensionTemplates();
}

export function listAvailableExtensionsByType(type: ExtensionType): ExtensionTemplate[] {
  return getAvailableExtensionTemplates().filter((t) => {
    // Parse the template to get its type
    try {
      const config = TOML.parse(t.content) as unknown as ExtensionConfig;
      return (config.type || "host") === type;
    } catch {
      return false;
    }
  });
}

export function enableExtensions(names: string[]): string[] {
  if (!existsSync(EXTENSIONS_DIR)) {
    mkdirSync(EXTENSIONS_DIR, { recursive: true });
  }

  const enabled: string[] = [];

  for (const name of names) {
    const template = getExtensionTemplate(name);
    if (!template) {
      console.warn(`Unknown extension template: ${name}`);
      continue;
    }

    const filePath = join(EXTENSIONS_DIR, `${name}.toml`);
    writeFileSync(filePath, template.content);
    enabled.push(name);
  }

  return enabled;
}

export function disableExtension(name: string): boolean {
  const filePath = join(EXTENSIONS_DIR, `${name}.toml`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    return true;
  }
  return false;
}

export function isExtensionEnabled(name: string): boolean {
  return existsSync(join(EXTENSIONS_DIR, `${name}.toml`));
}

export function getExtensionConfig(name: string): ExtensionConfig | undefined {
  const filePath = join(EXTENSIONS_DIR, `${name}.toml`);
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, "utf-8");
      return TOML.parse(content) as unknown as ExtensionConfig;
    } catch {
      return undefined;
    }
  }

  // Fall back to template
  const template = getExtensionTemplate(name);
  if (template) {
    try {
      return TOML.parse(template.content) as unknown as ExtensionConfig;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
