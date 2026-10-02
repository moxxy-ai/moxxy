import { createHash } from 'node:crypto';
import { ComputerUseError } from './outcome.js';
import type { AppTree } from './tree.js';

/** What the model can see of an app: its tree and its screenshot. Pixels count, so canvas work is progress. */
export function fingerprint(tree: AppTree, image?: { base64: string }): string {
  return createHash('sha256').update(JSON.stringify(tree)).update('\0').update(image ? image.base64 : '-').digest('hex');
}

/** Each app's last action, and how many times in a row it left the app looking the same. */
export class ProgressTracker {
  private readonly last = new Map<string, { signature: string; unchanged: number }>();

  /** The same action a third time after two that changed nothing is refused before it is sent. */
  check(app: string, signature: string): void {
    const last = this.last.get(app);
    if (last && last.signature === signature && last.unchanged >= 2) {
      throw new ComputerUseError('no_progress', 'This exact action already left the app unchanged twice and was not sent again');
    }
  }

  /** Returns how many times in a row `signature` has now left `app` unchanged (0 after a change). */
  record(app: string, signature: string, changed: boolean): number {
    const last = this.last.get(app);
    const unchanged = changed ? 0 : (last?.signature === signature ? last.unchanged : 0) + 1;
    this.last.set(app, { signature, unchanged });
    return unchanged;
  }

  forget(app: string): void { this.last.delete(app); }
}
