import { existsSync, mkdirSync, writeFileSync, unlinkSync, symlinkSync, lstatSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { Agent } from "../agents/types.ts";
import type { Extension, SkillConfig } from "./types.ts";

const SKILLS_DIR = join(homedir(), ".ccc", "skills");

/**
 * Get the global skills directory path
 */
export function getSkillsDir(): string {
  return SKILLS_DIR;
}

/**
 * Ensure global skills directory exists
 */
export function ensureSkillsDir(): void {
  if (!existsSync(SKILLS_DIR)) {
    mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

/**
 * Install a skill extension to the global skills directory
 */
export function installSkill(extension: Extension): boolean {
  if (!extension.skill) {
    return false;
  }

  ensureSkillsDir();

  const skillPath = join(SKILLS_DIR, extension.skill.filename);
  writeFileSync(skillPath, extension.skill.content.trim());
  return true;
}

/**
 * Remove a skill from the global skills directory
 */
export function removeSkill(extension: Extension): boolean {
  if (!extension.skill) {
    return false;
  }

  const skillPath = join(SKILLS_DIR, extension.skill.filename);
  if (existsSync(skillPath)) {
    unlinkSync(skillPath);
    return true;
  }
  return false;
}

/**
 * Create symlink from agent's skills path to global skills directory
 */
export function linkSkillsToAgent(agent: Agent): boolean {
  if (!agent.skills) {
    return false;
  }

  const agentSkillsPath = join(homedir(), agent.skills.path);
  const agentSkillsDir = dirname(agentSkillsPath);

  // Ensure parent directory exists
  if (!existsSync(agentSkillsDir)) {
    mkdirSync(agentSkillsDir, { recursive: true });
  }

  // If symlink already exists and points to correct location, skip
  if (existsSync(agentSkillsPath)) {
    try {
      const stat = lstatSync(agentSkillsPath);
      if (stat.isSymbolicLink()) {
        // Already a symlink, check if it points to right place
        return true;
      } else {
        // It's a real directory, remove it
        // (could be dangerous, so just return false)
        console.warn(`${agentSkillsPath} exists and is not a symlink`);
        return false;
      }
    } catch {
      return false;
    }
  }

  // Create symlink
  try {
    ensureSkillsDir();
    symlinkSync(SKILLS_DIR, agentSkillsPath);
    return true;
  } catch (err) {
    console.warn(`Failed to create symlink for ${agent.name}:`, err);
    return false;
  }
}

/**
 * Remove symlink from agent's skills path
 */
export function unlinkSkillsFromAgent(agent: Agent): boolean {
  if (!agent.skills) {
    return false;
  }

  const agentSkillsPath = join(homedir(), agent.skills.path);

  if (existsSync(agentSkillsPath)) {
    try {
      const stat = lstatSync(agentSkillsPath);
      if (stat.isSymbolicLink()) {
        unlinkSync(agentSkillsPath);
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Link skills directory to all agents that support skills
 */
export function linkSkillsToAllAgents(agents: Agent[]): string[] {
  const linked: string[] = [];
  for (const agent of agents) {
    if (agent.skills) {
      if (linkSkillsToAgent(agent)) {
        linked.push(agent.name);
      }
    }
  }
  return linked;
}

/**
 * List all installed skills
 */
export function listInstalledSkills(): string[] {
  ensureSkillsDir();
  try {
    return readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}
