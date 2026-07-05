import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * The Expo *account* identity — `owner` and the EAS `projectId` — is injected
 * from the environment instead of being committed, so the account details are
 * not exposed in the repo. Supply them via:
 *
 *   - GitHub Actions secrets `EXPO_OWNER` + `EAS_PROJECT_ID` (see
 *     `.github/workflows/mobile-eas-build.yml`) for CI EAS builds, and
 *   - a local untracked `.env` / shell export for `eas build` on your machine.
 *
 * Everything static (name/slug/icon/plugins/iOS+Android config) stays in
 * app.json — kept as the base so tooling that reads it directly keeps working;
 * this file only overlays the identity bits on top.
 *
 * `expo start` for day-to-day local development needs none of these — only EAS
 * build / submit / update read the account identity.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const owner = process.env.EXPO_OWNER?.trim();
  const envProjectId = process.env.EAS_PROJECT_ID?.trim();

  // Resolve the EAS project id from the env override first, then the value
  // committed in app.json (`extra.eas.projectId`). It drives both `eas build`'s
  // project link and the EAS Update (OTA) endpoint derived below.
  const committedProjectId =
    typeof config.extra?.eas?.projectId === 'string' ? config.extra.eas.projectId : undefined;
  const projectId = envProjectId || committedProjectId;

  return {
    ...config,
    name: config.name ?? 'Moxxy Mobile',
    slug: config.slug ?? 'moxxy-mobile-gateway',
    // Only set `owner` when provided — leaving it undefined keeps local
    // (non-EAS) flows account-agnostic.
    ...(owner ? { owner } : {}),
    extra: {
      ...config.extra,
      // `eas build` resolves the project from extra.eas.projectId; absent it
      // falls back to interactive `eas init`. Kept env-driven so the id isn't
      // committed.
      ...(projectId ? { eas: { projectId } } : {}),
    },
    // EAS Update (OTA) endpoint. The static `updates` knobs (enabled /
    // checkAutomatically / fallbackToCacheTimeout) and the `runtimeVersion`
    // policy live in app.json; only the account-specific URL is injected here so
    // it always tracks the resolved project id. Without a project id (plain
    // `expo start`) OTA is simply left unconfigured.
    ...(projectId
      ? {
          updates: {
            ...config.updates,
            url: `https://u.expo.dev/${projectId}`,
          },
        }
      : {}),
  };
};
