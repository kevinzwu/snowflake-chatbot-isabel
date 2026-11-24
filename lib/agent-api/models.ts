/**
 * Available AI model choices for the Cortex Agent selector.
 */
export type ModelChoice = "sonnet" | "haiku" | "opus";

export type AgentNames = Record<ModelChoice, string>;

/**
 * Derive the Snowflake Cortex Agent name from the selected model choice.
 * Falls back to the default (sonnet) agent when the chosen model has no agent configured.
 */
export function getAgentName(
  model: ModelChoice,
  agentNames: AgentNames,
): string {
  return agentNames[model] || agentNames.sonnet;
}

/** Models that have an agent configured, in selector order. */
export function getAvailableModels(agentNames: AgentNames): ModelChoice[] {
  return (["sonnet", "haiku", "opus"] as const).filter(
    (model) => agentNames[model] !== "",
  );
}
