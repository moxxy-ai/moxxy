/**
 * "Generate skill with AI" modal. Takes a free-text description and runs it as
 * a real runner turn against the active workspace's session — the only path to
 * the model from this thin client — but HIDES the turn from the transcript via
 * `chatStore.hideTurn`, mirroring the assistant chunks into a local preview.
 * On confirm the draft is handed to the Create modal so the user can tweak the
 * filename and body before persisting.
 */

import { useEffect, useState } from 'react';
import { toErrorMessage } from '@moxxy/client-core';
import { useActiveWorkspaceId } from '@moxxy/client-core';
import { chatStore } from '@moxxy/client-core';
import { api } from '@moxxy/client-core';
import { Button, Icon, Modal, TextArea } from '@moxxy/desktop-ui';
import { MarkdownBody } from '@/chat/MarkdownBody';
import type { MoxxyEvent } from '@moxxy/sdk';
import { SKILL_PROMPT_TEMPLATE } from './skill-prompt';

export function GenerateSkillModal({
  onCancel,
  onUseGenerated,
}: {
  readonly onCancel: () => void;
  readonly onUseGenerated: (content: string) => void;
}): JSX.Element {
  const workspaceId = useActiveWorkspaceId();
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle');
  const [generated, setGenerated] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [turnId, setTurnId] = useState<string | null>(null);

  // The generation runs as a real runner turn (the only path to the model
  // from this thin client), but the turn is HIDDEN from the transcript via
  // chatStore.hideTurn — so it never pollutes the chat. We mirror the
  // assistant chunks into local state for the in-modal preview.
  useEffect(() => {
    if (!turnId) return;
    const offEvent = api().subscribe(
      'runner.event',
      ({ event: ev }: { workspaceId: string; event: MoxxyEvent }) => {
        if (ev.turnId !== turnId) return;
        if (ev.type === 'assistant_chunk') {
          setGenerated((cur) => cur + ev.delta);
        } else if (ev.type === 'assistant_message') {
          setGenerated(ev.content);
        }
      },
    );
    const offDone = api().subscribe(
      'runner.turn.complete',
      ({ turnId: id, error: err }: { workspaceId: string; turnId: string; error: string | null }) => {
        if (id !== turnId) return;
        chatStore.unhideTurn(id);
        if (err) {
          setPhase('error');
          setError(err);
        } else {
          setPhase('done');
        }
      },
    );
    return () => {
      offEvent();
      offDone();
      chatStore.unhideTurn(turnId);
    };
  }, [turnId]);

  const onGenerate = async (): Promise<void> => {
    if (!workspaceId || !description.trim()) return;
    setPhase('streaming');
    setGenerated('');
    setError(null);
    try {
      const { turnId: id } = await api().invoke('session.runTurn', {
        workspaceId,
        prompt: SKILL_PROMPT_TEMPLATE(description.trim()),
      });
      // Hide BEFORE we start reading: the runner echoes a user_prompt + the
      // assistant output for this turn, and none of it should reach the
      // transcript. We deliberately do NOT dispatch send_started either, so
      // the chat never shows a phantom "sending" turn.
      chatStore.hideTurn(id);
      setTurnId(id);
    } catch (e) {
      setPhase('error');
      setError(toErrorMessage(e));
    }
  };

  return (
    <Modal title="Generate skill with AI" onClose={onCancel} width={760}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Describe the skill
          </span>
          <TextArea
            tone="soft"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. A skill that summarises long URLs by fetching them, extracting the headline and key bullets, and citing each source link."
            disabled={phase === 'streaming'}
            style={{ minHeight: 110, padding: '12px 14px', fontSize: 13, lineHeight: 1.6 }}
          />
        </label>
        <span style={{ fontSize: 11.5, color: 'var(--color-text-dim)' }}>
          {workspaceId
            ? 'Generated privately — it stays here in the editor and never shows in the chat.'
            : 'No active workspace — open one before generating.'}
        </span>
        {(phase === 'streaming' || phase === 'done' || phase === 'error') && (
          <section
            style={{
              border: '1px solid var(--color-card-border)',
              borderRadius: 12,
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            <header
              style={{
                padding: '8px 12px',
                background: '#f4f5fb',
                borderBottom: '1px solid var(--color-card-border)',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--color-text-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              Preview {phase === 'streaming' && '· streaming'}
            </header>
            <div
              style={{
                maxHeight: 360,
                overflowY: 'auto',
                padding: 16,
              }}
            >
              {generated ? (
                <MarkdownBody text={generated} streaming={phase === 'streaming'} />
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-dim)' }}>
                  Waiting for the first chunk…
                </p>
              )}
            </div>
          </section>
        )}
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--color-red)' }}>
            {error}
          </p>
        )}
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          {(() => {
            // One primary action that morphs by phase: Generate → Generating…
            // → Use this skill (shown in the same spot once a draft exists).
            const ready = phase === 'done' && generated.trim().length > 0;
            const canGenerate = !!workspaceId && description.trim().length > 0;
            const disabled = phase === 'streaming' || (!ready && !canGenerate);
            return (
              <Button
                variant="cta"
                onClick={ready ? () => onUseGenerated(generated) : () => void onGenerate()}
                disabled={disabled}
                style={{ padding: '8px 16px', opacity: disabled ? 0.5 : 1 }}
              >
                <Icon name={ready ? 'check' : 'spark'} size={14} />
                {phase === 'streaming'
                  ? 'Generating…'
                  : ready
                    ? 'Use this skill'
                    : 'Generate'}
              </Button>
            );
          })()}
        </footer>
      </div>
    </Modal>
  );
}
