---
"@moxxy/cli": patch
"@moxxy/desktop": minor
"@moxxy/workspaces-app": minor
---

Moxxy has a new logo: a metal ribbon around a dark visor with two glowing eyes, replacing the woven squares. It is everywhere the old one was: the desktop window, Dock and installer icons, the macOS menu bar (the logo's outline with the eyes cut out), the sidebar, splash and focus window, the mobile app and its icon (which, being native, changes only with a new store build), and the terminal banner. Loading marks now breathe (they ease smaller and dim, then back) instead of turning. The logo blinks now and then in the sidebar's masthead and in the macOS menu bar, and holds still when the system asks for reduced motion. Every logo file comes from one source picture through `assets/brand/build.sh`, and tests fail when a shipped copy drifts from it. The old mark, wordmark, lockups and social card are kept in `assets/brand/alternates/weave/`.
