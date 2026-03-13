import type { AssistantCommandInput } from '@/shared/api/types'

export type PlannerAssistantDialogCommand = 'generate' | 'regenerate' | 'reset'
export type PlannerAssistantDirectCommand = AssistantCommandInput['name']
export type PlannerAssistantCommandName =
  | PlannerAssistantDialogCommand
  | PlannerAssistantDirectCommand

export type PlannerAssistantCommandDefinition = {
  name: PlannerAssistantCommandName
  label: string
  description: string
  kind: 'dialog' | 'direct'
  chipLabel?: string
  template?: string
}

export type ParsedPlannerAssistantCommand =
  | {
      type: 'dialog'
      name: PlannerAssistantDialogCommand
      displayText: string
    }
  | {
      type: 'direct'
      name: PlannerAssistantDirectCommand
      args: Record<string, unknown>
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
    description: 'Open the structured generation dialog.',
    kind: 'dialog',
    chipLabel: 'Generate',
  },
  {
    name: 'regenerate',
    label: 'Regenerate itinerary',
    description: 'Open the regeneration dialog.',
    kind: 'dialog',
    chipLabel: 'Regenerate',
  },
  {
    name: 'reset',
    label: 'Reset generated itinerary',
    description: 'Open the reset dialog.',
    kind: 'dialog',
    chipLabel: 'Reset',
  },
  {
    name: 'snapshot',
    label: 'Trip snapshot',
    description: 'Load the latest trip days, activities, and inbox items.',
    kind: 'direct',
    chipLabel: 'Snapshot',
  },
  {
    name: 'search_places',
    label: 'Search places',
    description: 'Search Google Places for a query.',
    kind: 'direct',
    chipLabel: 'Search places',
    template: '/search_places Louvre Museum',
  },
  {
    name: 'create_activity',
    label: 'Create activity',
    description: 'Create an activity from a JSON payload.',
    kind: 'direct',
    template:
      '/create_activity {"trip_day_id":"day-id","category":"visit","title":"Morning museum"}',
  },
  {
    name: 'update_activity',
    label: 'Update activity',
    description: 'Patch an activity from a JSON payload.',
    kind: 'direct',
    template: '/update_activity {"activity_id":"activity-id","title":"Updated title"}',
  },
  {
    name: 'move_activity',
    label: 'Move activity',
    description: 'Move an activity with a JSON payload.',
    kind: 'direct',
    template:
      '/move_activity {"activity_id":"activity-id","target_day_id":"day-id","target_index":0}',
  },
  {
    name: 'delete_activity',
    label: 'Delete activity',
    description: 'Delete an activity with a JSON payload.',
    kind: 'direct',
    template: '/delete_activity {"activity_id":"activity-id"}',
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

export function formatPlannerAssistantCommandText(
  name: PlannerAssistantCommandName,
  args: Record<string, unknown> = {},
): string {
  if (name === 'snapshot') {
    return '/snapshot'
  }
  if (name === 'search_places') {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    return query ? `/search_places ${query}` : '/search_places'
  }
  if (Object.keys(args).length > 0) {
    return `/${name} ${JSON.stringify(args)}`
  }
  return `/${name}`
}

function parseJsonArgs(
  commandName: Exclude<PlannerAssistantDirectCommand, 'search_places' | 'snapshot'>,
  rest: string,
): ParsedPlannerAssistantCommand {
  if (!rest.trim()) {
    return {
      type: 'invalid',
      message: `/${commandName} requires a JSON object payload.`,
    }
  }

  try {
    const parsed = JSON.parse(rest)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        type: 'invalid',
        message: `/${commandName} expects a JSON object payload.`,
      }
    }
    return {
      type: 'direct',
      name: commandName,
      args: parsed as Record<string, unknown>,
      displayText: `/${commandName} ${JSON.stringify(parsed)}`,
    }
  } catch {
    return {
      type: 'invalid',
      message: `/${commandName} expects valid JSON after the command name.`,
    }
  }
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

  const [, rawName, rawRest = ''] = match
  const definition = getPlannerAssistantCommandDefinition(rawName)
  if (!definition) {
    return {
      type: 'invalid',
      message: `Unknown command: /${rawName}`,
    }
  }

  if (definition.kind === 'dialog') {
    return {
      type: 'dialog',
      name: definition.name as PlannerAssistantDialogCommand,
      displayText: `/${definition.name}`,
    }
  }

  if (definition.name === 'snapshot') {
    return {
      type: 'direct',
      name: 'snapshot',
      args: {},
      displayText: '/snapshot',
    }
  }

  if (definition.name === 'search_places') {
    const query = rawRest.trim()
    if (!query) {
      return {
        type: 'invalid',
        message: '/search_places requires a search query.',
      }
    }
    return {
      type: 'direct',
      name: 'search_places',
      args: { query },
      displayText: `/search_places ${query}`,
    }
  }

  return parseJsonArgs(
    definition.name as Exclude<
      PlannerAssistantDirectCommand,
      'search_places' | 'snapshot'
    >,
    rawRest,
  )
}
