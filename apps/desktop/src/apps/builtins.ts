/**
 * First-party desktop apps. Imported once for side-effect registration (the way
 * the core plugin builtins self-register). Add a new app here — navigation and
 * the gallery pick it up automatically.
 */
import { registerDesktopApp } from './registry';
import { AnonymizerApp } from './anonymizer/AnonymizerApp';

registerDesktopApp({
  id: 'anonymizer',
  name: 'Document anonymizer',
  description:
    'Detect and redact personal data in documents — runs entirely on your machine. Nothing is uploaded.',
  icon: 'lock',
  offline: true,
  requiresInstall: true,
  installSummary:
    'Downloads a ~110 MB on-device model for detecting names. After install it runs fully offline.',
  canSendToSession: true,
  Component: AnonymizerApp,
});
