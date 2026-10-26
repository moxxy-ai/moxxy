/**
 * How the person's own Claude runs when Moxxy names no mode, read the way
 * Claude reads it: its settings merged across tiers, with the trust filter
 * that drops an escalating mode a repository sets.
 */
import { installedClaudeAgentSdk } from './sdk-install.js';
import type { ClaudeAgentSdk, ClaudePermissionMode } from './sdk-types.js';
import { autoApproveFor } from './translate.js';

/** The mode the person's own Claude starts in for `cwd`; `undefined` when their settings name none or cannot be read. */
export async function ownPermissionMode(sdk: ClaudeAgentSdk, cwd: string): Promise<ClaudePermissionMode | undefined> {
  if (!sdk.resolveSettings || !sdk.filterEscalatingDefaultMode) return undefined;
  try {
    return sdk.filterEscalatingDefaultMode(await sdk.resolveSettings({ cwd })).permissions?.defaultMode;
  } catch {
    return undefined;
  }
}

/**
 * Whether the person's own Claude acts without asking in `cwd`. Unknown while
 * the SDK is not installed (it is installed when the connection is first used,
 * never just to read this) and for a mode Moxxy's switch does not stand for.
 */
export async function claudeOwnAutoApprove(
  cwd: string,
  opts: { readonly load?: () => Promise<ClaudeAgentSdk | undefined> } = {},
): Promise<boolean | undefined> {
  const sdk = await (opts.load ?? (() => installedClaudeAgentSdk()))().catch(() => undefined);
  if (!sdk) return undefined;
  const mode = await ownPermissionMode(sdk, cwd);
  return mode === undefined ? undefined : autoApproveFor(mode);
}
