import { describe, expect, it, vi } from 'vitest';
import { flipRule } from './PermissionEditor.js';

describe('flipRule — toggling a permission rule is atomic (a failed re-add must not drop the rule)', () => {
  it('happy path: removes then re-adds with the new kind, reports ok', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const reAdd = vi.fn().mockResolvedValue(undefined);
    const res = await flipRule({ remove, reAdd, from: 'deny', to: 'allow' });
    expect(res).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(reAdd).toHaveBeenCalledTimes(1);
    expect(reAdd).toHaveBeenCalledWith('allow');
  });

  it('re-add fails after a successful remove → restores the ORIGINAL kind (vanished deny is the worst case)', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    // First re-add (to 'allow') rejects; the restore re-add (back to 'deny') succeeds.
    const reAdd = vi
      .fn()
      .mockRejectedValueOnce(new Error('EACCES: policy file read-only'))
      .mockResolvedValueOnce(undefined);
    const res = await flipRule({ remove, reAdd, from: 'deny', to: 'allow' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(errText(res.error)).toContain('EACCES');
    // The original deny rule must have been re-added so the policy is unchanged.
    expect(reAdd).toHaveBeenNthCalledWith(1, 'allow');
    expect(reAdd).toHaveBeenNthCalledWith(2, 'deny');
  });

  it('never throws even when BOTH the re-add and the restore fail', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const reAdd = vi
      .fn()
      .mockRejectedValueOnce(new Error('write 1 failed'))
      .mockRejectedValueOnce(new Error('restore also failed'));
    let res: Awaited<ReturnType<typeof flipRule>> | undefined;
    await expect(
      (async () => {
        res = await flipRule({ remove, reAdd, from: 'allow', to: 'deny' });
      })(),
    ).resolves.toBeUndefined();
    expect(res?.ok).toBe(false);
  });

  it('remove itself fails → no restore attempted (nothing was removed), reports the error', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('locked'));
    const reAdd = vi.fn().mockResolvedValue(undefined);
    const res = await flipRule({ remove, reAdd, from: 'deny', to: 'allow' });
    expect(res.ok).toBe(false);
    // Nothing was removed, so we must NOT touch reAdd at all.
    expect(reAdd).not.toHaveBeenCalled();
  });
});

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
