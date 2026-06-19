import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { PermissionEngine } from '@moxxy/core';

export interface PermissionEditorProps {
  readonly policyPath: string;
}

interface Row {
  readonly kind: 'deny' | 'allow';
  readonly name: string;
  readonly reason?: string;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'add'; buffer: string; bucket: 'allow' | 'deny' }
  | { kind: 'confirm-delete'; row: Row }
  | { kind: 'message'; text: string };

export const PermissionEditor: React.FC<PermissionEditorProps> = ({ policyPath }) => {
  const { exit } = useApp();
  const [engine, setEngine] = useState<PermissionEngine | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [status, setStatus] = useState<string>('');

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const e = await PermissionEngine.load(policyPath);
      if (cancelled) return;
      setEngine(e);
      setRows(toRows(e));
    })();
    return () => {
      cancelled = true;
    };
  }, [policyPath]);

  const refresh = (e: PermissionEngine): void => {
    const next = toRows(e);
    setRows(next);
    if (cursor >= next.length) setCursor(Math.max(0, next.length - 1));
  };

  useInput((input, key) => {
    if (mode.kind === 'message') {
      setMode({ kind: 'list' });
      return;
    }

    if (mode.kind === 'add') {
      if (key.escape) {
        setMode({ kind: 'list' });
        return;
      }
      if (key.return) {
        const name = mode.buffer.trim();
        if (!name || !engine) {
          setMode({ kind: 'list' });
          return;
        }
        const promise =
          mode.bucket === 'allow'
            ? engine.addAllow({ name })
            : engine.addDeny({ name });
        const bucket = mode.bucket;
        void promise
          .then(() => {
            refresh(engine);
            setDirty(true);
            setMode({ kind: 'message', text: `added ${bucket}: ${name}` });
            setStatus('saved');
          })
          .catch((err: unknown) => {
            // A rejected disk write (EACCES/ENOSPC/locked) must NOT read as
            // "saved" on a security-policy editor — surface it and avoid the
            // unhandled rejection.
            setMode({ kind: 'message', text: `FAILED to add ${bucket}: ${errMessage(err)}` });
            setStatus('save failed');
          });
        return;
      }
      if (key.backspace || key.delete) {
        setMode({ ...mode, buffer: mode.buffer.slice(0, -1) });
        return;
      }
      if (!key.ctrl && !key.meta && input && input.length === 1) {
        setMode({ ...mode, buffer: mode.buffer + input });
      }
      return;
    }

    if (mode.kind === 'confirm-delete') {
      if (input === 'y' || key.return) {
        if (!engine) {
          setMode({ kind: 'list' });
          return;
        }
        const removedName = mode.row.name;
        void engine
          .removeByName(removedName)
          .then(() => {
            refresh(engine);
            setDirty(true);
            setMode({ kind: 'message', text: `removed: ${removedName}` });
            setStatus('saved');
          })
          .catch((err: unknown) => {
            setMode({ kind: 'message', text: `FAILED to remove ${removedName}: ${errMessage(err)}` });
            setStatus('save failed');
          });
        return;
      }
      setMode({ kind: 'list' });
      return;
    }

    // list mode
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(rows.length - 1, c + 1));
      return;
    }
    if (input === 'd' || key.delete) {
      const row = rows[cursor];
      if (row) setMode({ kind: 'confirm-delete', row });
      return;
    }
    if (input === 'a') {
      setMode({ kind: 'add', buffer: '', bucket: 'allow' });
      return;
    }
    if (input === 'D') {
      setMode({ kind: 'add', buffer: '', bucket: 'deny' });
      return;
    }
    if (input === ' ' || key.return) {
      // Toggle: remove + re-add with the opposite kind.
      const row = rows[cursor];
      if (!row || !engine) return;
      const targetKind: 'allow' | 'deny' = row.kind === 'allow' ? 'deny' : 'allow';
      const rule = { name: row.name, ...(row.reason ? { reason: row.reason } : {}) };
      const reAdd = (kind: 'allow' | 'deny'): Promise<unknown> =>
        kind === 'allow' ? engine.addAllow(rule) : engine.addDeny(rule);
      void flipRule({
        remove: () => engine.removeByName(row.name),
        reAdd,
        from: row.kind,
        to: targetKind,
      }).then((result) => {
        refresh(engine);
        if (result.ok) {
          setDirty(true);
          setStatus(`flipped ${row.name} → ${targetKind}`);
        } else {
          setStatus(`flip FAILED for ${row.name}: ${errMessage(result.error)}`);
        }
      });
      return;
    }
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">moxxy perms editor</Text>
        <Text dimColor>  ({policyPath})</Text>
      </Box>

      {rows.length === 0 ? (
        <Text dimColor>(no rules — press `a` to add an allow rule, `D` for deny)</Text>
      ) : (
        rows.map((row, i) => {
          const focused = i === cursor;
          return (
            <Box key={`${row.kind}:${row.name}:${i}`}>
              <Text color={focused ? 'cyan' : undefined}>{focused ? '› ' : '  '}</Text>
              <Text color={row.kind === 'allow' ? 'green' : 'red'}>{row.kind.padEnd(5)}</Text>
              <Text>  {row.name}</Text>
              {row.reason ? <Text dimColor>  — {row.reason}</Text> : null}
            </Box>
          );
        })
      )}

      <Box marginTop={1}>
        {mode.kind === 'add' ? (
          <Text>
            new {mode.bucket} rule: <Text color="cyan">{mode.buffer}</Text>
            <Text dimColor> (enter to confirm, esc to cancel)</Text>
          </Text>
        ) : mode.kind === 'confirm-delete' ? (
          <Text color="yellow">delete `{mode.row.name}` ({mode.row.kind})? [y/N]</Text>
        ) : mode.kind === 'message' ? (
          <Text color={/FAILED/i.test(mode.text) ? 'red' : 'green'}>{mode.text}  (press any key)</Text>
        ) : (
          <Text dimColor>
            ↑/↓ move · space/enter flip · a add allow · D add deny · d delete · q quit
            {dirty || /FAILED/i.test(status) ? (
              <Text color={/FAILED/i.test(status) ? 'red' : 'green'}>{`  · ${status}`}</Text>
            ) : null}
          </Text>
        )}
      </Box>
    </Box>
  );
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type FlipResult = { ok: true } | { ok: false; error: unknown };

/**
 * Atomically flip a permission rule from `from` to `to`. The flip is two disk
 * writes (remove + re-add); if the re-add fails AFTER the remove succeeded we'd
 * silently DROP the rule — the worst outcome being a vanished DENY rule on a
 * security-policy editor. This best-effort restores the original kind so a
 * failed toggle leaves the policy exactly as it was. Never throws — the caller
 * surfaces the error via the returned result. Exported for unit tests.
 */
export async function flipRule(ops: {
  readonly remove: () => Promise<unknown>;
  readonly reAdd: (kind: 'allow' | 'deny') => Promise<unknown>;
  readonly from: 'allow' | 'deny';
  readonly to: 'allow' | 'deny';
}): Promise<FlipResult> {
  let removed = false;
  try {
    await ops.remove();
    removed = true;
    await ops.reAdd(ops.to);
    return { ok: true };
  } catch (error) {
    if (removed) {
      try {
        await ops.reAdd(ops.from);
      } catch {
        // Restore also failed — nothing more we can safely do; the original
        // error is still surfaced to the caller.
      }
    }
    return { ok: false, error };
  }
}

function toRows(engine: PermissionEngine): Row[] {
  const snap = engine.policySnapshot;
  const out: Row[] = [];
  for (const r of snap.deny) out.push({ kind: 'deny', name: r.name, reason: r.reason });
  for (const r of snap.allow) out.push({ kind: 'allow', name: r.name, reason: r.reason });
  return out;
}
