/**
 * Preferences tab — the app-level settings that don't read the runner-backed
 * settings slice: appearance (theme), notifications, plus the About/update + CLI section.
 * Folds the former "Appearance" and "About" tabs into one so there's a single
 * place for "how the app looks and updates". Everything about voice lives in
 * Settings → Voice.
 */
import { AppearanceTab } from './AppearanceTab';
import { AboutTab } from './AboutTab';
import { NotificationsSection } from './NotificationsSection';

export function PreferencesTab(): JSX.Element {
  return (
    <>
      <AppearanceTab />
      <NotificationsSection />
      <AboutTab />
    </>
  );
}
