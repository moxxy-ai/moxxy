import { loadPreferences, savePreferences } from '@moxxy/core';
import {
  providerConfigureParamsSchema,
  providerSetActiveParamsSchema,
  providerSetEnabledParamsSchema,
} from '../protocol.js';
import type { HandlerContext } from './context.js';

export async function handleProviderSetActive(
  ctx: HandlerContext,
  raw: unknown,
): Promise<Record<string, never>> {
  const { session, prefsMutex, broadcastInfo } = ctx;
  const { name, config } = providerSetActiveParamsSchema.parse(raw);
  // Mirror the in-process picker: resolve credentials (the CLI stashes a
  // resolver on the session at boot), drop any cached instance, re-activate.
  const resolver = session.credentialResolver;
  const cfg = config ?? (resolver ? await resolver(name) : {});
  const def = session.providers.list().find((p) => p.name === name);
  if (def) session.providers.replace(def);
  session.providers.setActive(name, cfg);
  // Persist the pick to ~/.moxxy/preferences.json so it survives to the NEXT
  // freshly-spawned runner. Without this, a remote client (e.g. the desktop)
  // that switches provider only mutates THIS runner's in-memory state — so
  // spawning another runner (the desktop spawns one `moxxy serve` per
  // workspace) boots back on the default provider with no key, comes up
  // `connected` but provider-less, and bounces the user to "Connect a
  // provider". Mirrors the TUI / Telegram pickers, which already persist.
  // Best-effort: savePreferences swallows its own write errors and never
  // throws, so a read-only home can't fail the setActive RPC. Run under the
  // shared `prefsMutex` so this write serializes against the disabledProviders
  // RMW in handleProviderSetEnabled (invariant #5): a setActive racing a
  // toggle must not interleave with that handler's load→compute→save.
  void prefsMutex.run(() => savePreferences({ providerName: name }));
  broadcastInfo();
  return {};
}

export async function handleProviderSetEnabled(
  ctx: HandlerContext,
  raw: unknown,
): Promise<Record<string, never>> {
  const { session, prefsMutex, broadcastInfo } = ctx;
  const { name, enabled } = providerSetEnabledParamsSchema.parse(raw);
  if (!session.providers.list().some((p) => p.name === name)) {
    throw new Error(`Provider not registered: ${name}`);
  }
  // Throws when disabling the ACTIVE provider — surface that verbatim.
  session.providers.setEnabled(name, enabled);
  // Persist so the next boot's activation walk skips it (setup.ts seeds the
  // registry from this list). Read-merge so concurrent writers of other
  // preference fields aren't clobbered; best-effort like every prefs write.
  // The load→compute→save is run under `prefsMutex` so it serializes against
  // the other prefs-writing handler — without it, two overlapping toggles (or
  // a setActive racing a toggle) could both read the same `disabledProviders`
  // set and the second clobber the first (invariant #5).
  void prefsMutex.run(async () => {
    const prefs = await loadPreferences();
    const current = new Set(prefs.disabledProviders ?? []);
    if (enabled) current.delete(name);
    else current.add(name);
    await savePreferences({ disabledProviders: [...current] });
  });
  broadcastInfo();
  return {};
}

export async function handleProviderRefreshReady(
  ctx: HandlerContext,
): Promise<Record<string, never>> {
  const { session, prefsMutex, broadcastInfo } = ctx;
  // Re-probe every registered provider's credentials (vault keys / env /
  // OAuth tokens) so a key the user just saved flips readiness without a
  // runner restart. The resolver is the same non-interactive probe boot
  // uses; absent resolver (bare test sessions) → leave the set untouched.
  const resolver = session.credentialResolver;
  if (resolver) {
    // Run the read-await-loop-then-replace under the SAME mutex that serializes
    // setActive/setEnabled. The body sequentially awaits a credential probe per
    // provider, then assigns `session.readyProviders` in one shot — a multi-await
    // critical section. Without serialization, two overlapping refreshReady calls
    // (or a setActive landing mid-probe) can have the slower one's STALE set
    // clobber the newer state (last-writer-wins). The mutex makes overlapping
    // readiness recomputes serialize, matching setEnabled/setActive (invariant #5).
    await prefsMutex.run(async () => {
      const ready = new Set<string>();
      const active = session.providers.getActiveName();
      if (active) ready.add(active);
      for (const p of session.providers.list()) {
        if (ready.has(p.name)) continue;
        try {
          await resolver(p.name);
          ready.add(p.name);
        } catch {
          // not ready — leave out
        }
      }
      session.readyProviders = ready;
    });
  }
  broadcastInfo();
  return {};
}

export async function handleProviderConfigure(
  ctx: HandlerContext,
  raw: unknown,
): Promise<Record<string, never>> {
  const { session, broadcastInfo } = ctx;
  const { name, patch } = providerConfigureParamsSchema.parse(raw);
  const admin = session.providerAdmin;
  if (!admin) throw new Error('provider admin not supported on this runner');
  await admin.configure(name, patch as Parameters<typeof admin.configure>[1]);
  broadcastInfo();
  return {};
}
