/**
 * Appearance tab — the light / dark / system theme picker.
 *
 * Standalone (like About / Mobile): it doesn't read the runner-backed
 * settings slice. The segmented control writes through the shared theme
 * store in `lib/useTheme`, which (1) flips `data-theme` on <html>
 * synchronously so the change is instant, and (2) persists the pref via
 * `prefs.update` — the main process mirrors it into
 * `nativeTheme.themeSource` so window chrome and the boot splash agree.
 */

import { useThemePreference, setThemePreference } from '@/lib/useTheme';
import type { ThemePreference } from '@moxxy/desktop-ipc-contract';
import { Section } from './settings-primitives';
import { Segmented } from '../shell/ViewHeader';

const THEME_OPTIONS: ReadonlyArray<{ id: ThemePreference; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

export function AppearanceTab(): JSX.Element {
  const theme = useThemePreference();
  return (
    <Section
      title="Appearance"
      description="Choose how the app looks. System follows your OS setting."
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          padding: '13px 16px',
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-card-border)',
          borderRadius: 14,
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>Theme</div>
        <Segmented
          items={THEME_OPTIONS}
          value={theme}
          onChange={setThemePreference}
          testIdPrefix="appearance-theme-"
        />
      </div>
    </Section>
  );
}
