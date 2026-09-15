import { AsyncLocalStorage } from 'node:async_hooks';
import type { PermissionResolver } from '@moxxy/sdk';

const scope = new AsyncLocalStorage<PermissionResolver>();

/** Trusted host-only context, inherited by asynchronous workflow children. */
export function withPermissionScope<T>(resolver: PermissionResolver, run: () => T): T {
  return scope.run(resolver, run);
}

export function currentPermissionScope(): PermissionResolver | undefined {
  return scope.getStore();
}
