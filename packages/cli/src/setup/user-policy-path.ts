import { moxxyPath } from '@moxxy/sdk/server';

/** The user's standing permission rules: `permissions.json` in the moxxy home. */
export function userPolicyPath(): string {
  return moxxyPath('permissions.json');
}
