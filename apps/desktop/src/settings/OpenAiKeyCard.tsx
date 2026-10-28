/**
 * The one OpenAI API key Voice uses, entered once for GPT-Live and OpenAI
 * transcription. Render-only; saving lives in `useVaultKey`.
 */

import { Button, TextInput } from '@moxxy/desktop-ui';
import type { VaultKeyState } from './useVaultKey';

export function OpenAiKeyCard({ openAiKey }: { readonly openAiKey: VaultKeyState }): JSX.Element {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '13px 16px',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <label htmlFor="openai-api-key" style={{ fontSize: 'var(--type-ui)', fontWeight: 600 }}>
        OpenAI API key
      </label>
      <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-muted)' }}>
        GPT-Live and OpenAI transcription both use this key. OpenAI bills their use to it, separately from a ChatGPT plan.
        {openAiKey.hasKey ? ' · key saved in this device vault' : ''}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <TextInput
          id="openai-api-key"
          type="password"
          value={openAiKey.draft}
          onChange={(event) => openAiKey.setDraft(event.target.value)}
          placeholder={openAiKey.hasKey ? 'Paste a replacement key' : 'Paste your OpenAI API key (sk-…)'}
          autoComplete="off"
          style={{ flex: 1 }}
        />
        <Button
          variant="secondary"
          disabled={openAiKey.busy || !openAiKey.draft.trim()}
          onClick={() => void openAiKey.save()}
        >
          Save OpenAI key
        </Button>
      </div>
      {openAiKey.error && (
        <div role="alert" style={{ color: 'var(--color-red)', fontSize: 'var(--type-meta)' }}>{openAiKey.error}</div>
      )}
    </section>
  );
}
