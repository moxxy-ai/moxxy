import type { CategoryView } from '@moxxy/sdk';

/**
 * The onboarding step that teaches the product's actual shape.
 *
 * Everything in moxxy is a swappable block: the loop, the compactor, the cache
 * strategy, the isolator, the event store, the audit sink. `moxxy plugins
 * defaults` has always exposed that, but onboarding never mentioned it, so a
 * user could finish setup without ever learning the central idea, and would
 * then reach for config files to change something the swap axis already owns.
 *
 * The rule that keeps this from becoming ceremony: only ever OFFER a swap for a
 * category that genuinely has an alternative. On a fresh install most
 * categories hold exactly one registration (the protected floor), and asking
 * "which compactor?" when there is one compactor wastes the user's attention
 * and teaches them that the wizard asks pointless questions.
 */

/** A category worth interacting about: more than one registered option. */
export interface SwappableCategory {
  readonly category: string;
  readonly active: string | null;
  readonly options: ReadonlyArray<string>;
}

/**
 * Split the categories into the ones worth a question and the ones that are
 * only worth showing.
 *
 * `provider` is excluded on purpose: onboarding already has a dedicated
 * provider step with credential handling, and offering it twice under a
 * different name would be actively confusing.
 */
export function partitionCategories(views: ReadonlyArray<CategoryView>): {
  readonly swappable: ReadonlyArray<SwappableCategory>;
  readonly fixed: ReadonlyArray<CategoryView>;
} {
  const swappable: SwappableCategory[] = [];
  const fixed: CategoryView[] = [];
  for (const view of views) {
    if (view.category === 'provider') continue;
    const options = view.items.map((i) => i.name);
    if (options.length > 1) {
      swappable.push({ category: view.category, active: view.active, options });
    } else if (options.length === 1) {
      fixed.push(view);
    }
    // Zero options means nothing is registered for that kind (no transcriber,
    // no reflector on a fresh install). Showing "transcriber: (none)" during
    // setup invites a question the user cannot act on yet.
  }
  return { swappable, fixed };
}

/**
 * One line per category with something registered, e.g. `mode  default`.
 * Deliberately a plain summary rather than a prompt: the goal is that the user
 * leaves onboarding knowing this axis exists and how to reach it later.
 */
export function summariseBlocks(views: ReadonlyArray<CategoryView>): string {
  const { swappable, fixed } = partitionCategories(views);
  const rows = [
    ...swappable.map((s) => [s.category, `${s.active ?? '(none)'}  (${s.options.length} options)`] as const),
    ...fixed.map((f) => [f.category, f.active ?? '(none)'] as const),
  ];
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map(([c]) => c.length));
  return rows.map(([c, v]) => `${c.padEnd(width)}  ${v}`).join('\n');
}
