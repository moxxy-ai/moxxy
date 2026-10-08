/**
 * The extensions an installer carries and replaces itself (the OpenAI
 * connections, Computer Use), installed before the first runner starts and
 * without asking anyone: the installer the person ran is the approval. The
 * previous copy is always kept. One that was changed since the installer put
 * it there is still replaced, and that comes back in the result so it can be
 * said once, afterwards; a copy with no record (from before records existed)
 * is not reported — nearly every profile has those.
 *
 * Electron-free: what to tell the person is the caller's.
 */

export type BundledUpdateOutcome = 'current' | 'declined' | 'updated';

interface ReplacementOffer {
  readonly backupPath: string;
  readonly localChanges: 'untracked' | 'unchanged' | 'changed';
}

export interface BundledPackageUpdate<Offer extends ReplacementOffer = ReplacementOffer> {
  readonly plugin: string;
  /** Runs the package's updater; `confirm` is asked when it would replace a copy it did not install. */
  readonly run: (confirm: (offer: Offer) => Promise<boolean>) => Promise<BundledUpdateOutcome>;
}

export interface BundledUpdateResult {
  readonly plugin: string;
  readonly outcome: 'current' | 'updated' | 'failed';
  /** Where the previous copy is, when it was changed since the installer put it there. */
  readonly replacedLocalCopy?: string;
  /** Why the package kept its previous version. */
  readonly error?: string;
}

export async function installBundledUpdates<Offer extends ReplacementOffer>(
  updates: ReadonlyArray<BundledPackageUpdate<Offer>>,
): Promise<BundledUpdateResult[]> {
  const results: BundledUpdateResult[] = [];
  for (const { plugin, run } of updates) {
    let replaced: string | undefined;
    try {
      const outcome = await run(async (offer) => {
        if (offer.localChanges === 'changed') replaced = offer.backupPath;
        return true;
      });
      results.push(
        outcome === 'updated'
          ? { plugin, outcome, ...(replaced ? { replacedLocalCopy: replaced } : {}) }
          : { plugin, outcome: 'current' },
      );
    } catch (error) {
      results.push({ plugin, outcome: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
