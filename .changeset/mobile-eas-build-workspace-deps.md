---
"@moxxy/workspaces-app": patch
---

fix(mobile): build workspace deps on EAS before Metro bundles

The app consumes `@moxxy/*` workspace packages from their built `dist/`, which is
git-ignored and never produced on a fresh EAS checkout (EAS only runs
`pnpm install`). Metro then failed to resolve `@moxxy/client-core` and friends.
An `eas-build-post-install` hook now builds the app's transitive workspace dep
closure after install and before bundling.

Also pins the iOS `submit` target (`ascAppId` + `bundleIdentifier`) so
`eas submit --non-interactive` resolves the App Store Connect app deterministically
instead of running its auto app-creation path.
