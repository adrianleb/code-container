import * as TOML from "@iarna/toml";

// @ts-ignore - Bun supports this import syntax
import claudeToml from "../../agents/claude.toml" with { type: "text" };
// @ts-ignore
import codexToml from "../../agents/codex.toml" with { type: "text" };
// @ts-ignore
import geminiToml from "../../agents/gemini.toml" with { type: "text" };
// @ts-ignore
import opencodeToml from "../../agents/opencode.toml" with { type: "text" };

export interface AgentTemplate {
  name: string;
  description: string;
  content: string;
}

function parseTemplate(content: string): AgentTemplate {
  const parsed = TOML.parse(content) as { name: string; description?: string };
  return {
    name: parsed.name,
    description: parsed.description || parsed.name,
    content,
  };
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  parseTemplate(claudeToml),
  parseTemplate(codexToml),
  parseTemplate(geminiToml),
  parseTemplate(opencodeToml),
];

export function getAvailableTemplates(): AgentTemplate[] {
  return AGENT_TEMPLATES;
}

export function getTemplate(name: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.name === name);
}
