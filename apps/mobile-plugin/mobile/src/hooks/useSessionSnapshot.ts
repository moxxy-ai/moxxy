import type { MobileState } from '../protocol';

export function useSessionSnapshot(state: MobileState) {
  return {
    activeWorkspaceId: state.activeWorkspaceId,
    session: state.session,
    readOnly: state.session?.readOnly === true,
    agents: state.agents,
    commands: state.commands,
    connected: state.connected,
    activeMode: state.activeMode,
    activeProvider: state.activeProvider,
    modeBadge: state.modeBadge,
    errors: state.errors,
  };
}
