---
'@moxxy/workspaces-app': patch
---

Rebrand the mobile app to "workspaces". Rename the package
`@moxxy/mobile-gateway-app` → `@moxxy/workspaces-app`, set the iOS bundle
identifier to `ai.moxxy.workspaces` (app.json, the native Xcode project, and the
matching bundle-id URL scheme in Info.plist — including the Live Activity
extension), and set the Expo slug to `workspaces`.
