export type PlannerAssistantInlineCommand = 'generate' | 'reset'
export type PlannerAssistantCommandName = PlannerAssistantInlineCommand

export type PlannerAssistantCommandDefinition = {
  name: PlannerAssistantCommandName
  label: string
  description: string
  chipLabel?: string
}

export type ParsedPlannerAssistantCommand =
  | {
      type: 'inline'
      name: PlannerAssistantInlineCommand
      displayText: string
    }
  | {
      type: 'invalid'
      message: string
    }

export const PLANNER_ASSISTANT_COMMANDS: PlannerAssistantCommandDefinition[] = [
  {
    name: 'generate',
    label: 'Generate itinerary',
    description: 'Open the itinerary setup form in chat.',
    chipLabel: 'Generate',
  },
  {
    name: 'reset',
    label: 'Reset generated itinerary',
    description: 'Open the reset form in chat.',
    chipLabel: 'Reset',
  },
]

export function getPlannerAssistantCommandDefinition(
  name: string,
): PlannerAssistantCommandDefinition | undefined {
  return PLANNER_ASSISTANT_COMMANDS.find((command) => command.name === name)
}

export function getPlannerAssistantCommandSuggestions(
  draft: string,
): PlannerAssistantCommandDefinition[] {
  const trimmed = draft.trimStart()
  if (!trimmed.startsWith('/')) {
    return []
  }

  const query = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  return PLANNER_ASSISTANT_COMMANDS.filter((command) => {
    if (!query) {
      return true
    }
    return (
      command.name.includes(query) ||
      command.label.toLowerCase().includes(query) ||
      command.description.toLowerCase().includes(query)
    )
  })
}

export function parsePlannerAssistantCommand(
  draft: string,
): ParsedPlannerAssistantCommand | null {
  const trimmed = draft.trim()
  if (!trimmed.startsWith('/')) {
    return null
  }

  const match = trimmed.match(/^\/([a-z_]+)(?:\s+([\s\S]*))?$/)
  if (!match) {
    return {
      type: 'invalid',
      message: 'Unrecognized assistant command.',
    }
  }

  const rawName = match[1]
  if (!rawName) {
    return {
      type: 'invalid',
      message: 'Unrecognized assistant command.',
    }
  }
  const definition = getPlannerAssistantCommandDefinition(rawName)
  if (!definition) {
    return {
      type: 'invalid',
      message: `Unknown command: /${rawName}`,
    }
  }

  return {
    type: 'inline',
    name: definition.name,
    displayText: `/${definition.name}`,
  }
}
