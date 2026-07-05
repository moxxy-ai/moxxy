---
'@moxxy/workspaces-app': minor
---

Over-the-air (OTA) updates for the Expo mobile app via EAS Update. The whole JS
bundle + assets can now ship without an App Store / Play Store review.

- `expo-updates` wired in: `updates.url` derived from the resolved EAS project id
  in `app.config.ts`, `runtimeVersion` on the `appVersion` policy, `preview` /
  `production` update channels stamped on the eas.json build profiles, and the
  committed iOS `Expo.plist` flipped on.
- A generic in-app update mechanism: the pure `reduceOta` state machine
  (`src/otaUpdates.ts`) driving `useOtaUpdates`, mounted headlessly via
  `<OtaUpdateController/>`. It checks on launch and on every foreground,
  downloads silently, and applies the new bundle on the next activation. Dormant
  in Expo Go, dev, and web.
- A manual-trigger CI job (`.github/workflows/mobile-eas-update.yml`) that builds
  the workspace deps, typechecks + tests the app, and publishes `eas update` to a
  chosen channel.
