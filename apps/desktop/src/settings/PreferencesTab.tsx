/**
 * Preferences tab — the app-level settings that don't read the runner-backed
 * settings slice: appearance (theme), the Voice Mode engine, plus the
 * About/update + CLI section.
 * Folds the former "Appearance" and "About" tabs into one so there's a single
 * place for "how the app looks and updates".
 */
import { AppearanceTab } from './AppearanceTab';
import { AboutTab } from './AboutTab';
import { VoiceEngineSection } from './VoiceEngineSection';

export function PreferencesTab(): JSX.Element {
  return (
    <>
      <AppearanceTab />
      <VoiceEngineSection />
      <AboutTab />
    </>
  );
}
