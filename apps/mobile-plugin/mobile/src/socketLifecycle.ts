interface SocketCloseState {
  readonly disposed: boolean;
  readonly current: boolean;
}

export function shouldReconnectAfterClose(state: SocketCloseState): boolean {
  return !state.disposed && state.current;
}
