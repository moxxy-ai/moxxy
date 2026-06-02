---
"@moxxy/desktop": patch
---

Desktop: redesign sign-in, loading, focus mode, and onboarding; add one-click Node install.

- **Sign-in** now opens Clerk's own modal from the sidebar profile pill — the
  dedicated onboarding "Sign in" step and the heavily-customized embedded
  `<SignIn>` are gone. The pill shows only **Sign in** or your profile (no more
  "Guest" state).
- **Loading screen:** the connecting screen is now a friendly, branded surface
  on the app's near-white background (continuous with the splash and chat) — no
  more greyish "Starting moxxy serve…" with socket/pid rows. Failures show a
  short message + Retry with the diagnostics tucked behind a "Technical details"
  disclosure.
- **Focus widget:** the mini-text panel is drag-resizable, renders the full
  latest message as scrollable Markdown, and stopping a voice recording now
  opens the panel to show the transcript + streaming answer.
- **Onboarding:** refreshed two-column look (near-white pane, lighter step rail)
  plus a one-click **"Install automatically"** button that downloads the
  official Node LTS into the app's data dir — no admin or package manager — with
  the manual nodejs.org download as a fallback.
- Swapped the moxxy loader/avatar animation.
