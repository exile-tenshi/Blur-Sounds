import type { EditorProject } from '../../shared/videoStudio'

// Command pattern for undo/redo. Each command is a pure transform of the project
// plus its inverse, so the stack never needs to snapshot the whole document.
export interface EditorCommand {
  label: string
  apply: (project: EditorProject) => EditorProject
  invert: (project: EditorProject) => EditorProject
}

export interface CommandStackState {
  project: EditorProject
  past: EditorCommand[]
  future: EditorCommand[]
}

export function createInitialState(project: EditorProject): CommandStackState {
  return { project, past: [], future: [] }
}

export function runCommand(
  state: CommandStackState,
  command: EditorCommand,
): CommandStackState {
  return {
    project: command.apply(state.project),
    past: [...state.past, command],
    future: [],
  }
}

export function undo(state: CommandStackState): CommandStackState {
  if (state.past.length === 0) {
    return state
  }
  const command = state.past[state.past.length - 1]
  return {
    project: command.invert(state.project),
    past: state.past.slice(0, -1),
    future: [command, ...state.future],
  }
}

export function redo(state: CommandStackState): CommandStackState {
  if (state.future.length === 0) {
    return state
  }
  const command = state.future[0]
  return {
    project: command.apply(state.project),
    past: [...state.past, command],
    future: state.future.slice(1),
  }
}

export function canUndo(state: CommandStackState): boolean {
  return state.past.length > 0
}

export function canRedo(state: CommandStackState): boolean {
  return state.future.length > 0
}

export function lastUndoLabel(state: CommandStackState): string | undefined {
  return state.past[state.past.length - 1]?.label
}

export function nextRedoLabel(state: CommandStackState): string | undefined {
  return state.future[0]?.label
}
