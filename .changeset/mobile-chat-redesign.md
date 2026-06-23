---
"@moxxy/workspaces-app": minor
---

Rebuild the mobile app's UI from scratch on a fresh design system, keeping the
existing data/business hooks.

- **New design system** (`src/ui/kit`): theme-aware Screen, headers, Card,
  Button, IconButton, ListRow, Pill, Segmented, EmptyState, and an iOS-26
  "Liquid Glass" material (`expo-blur`) used for the floating chrome.
- **Theming**: a designed dark theme (default) plus light and system modes,
  selectable under Account → Appearance; every color resolves through a
  swappable palette.
- **Drawer-centric navigation** (no bottom tab bar): the chat is the immersive
  home; the drawer holds collapsible workspace folders with their session
  history and a footer with Apps and Account. Apps (Workflows, Schedules) and
  Account are pushed screens.
- **Onboarding**: a proper first-run pairing flow (QR scan + manual link) shown
  until the phone is paired to the desktop gateway.
- **Composer**: a minimal glass single line that grows as you type — `+`
  (options bottom sheet), text, voice, send — with a drag grabber to
  minimize/restore.
- Pairing copy now points to the desktop **Mobile** sidebar tab.
