---
'@moxxy/desktop': patch
'@moxxy/desktop-host': patch
---

Two desktop fixes. (1) Fresh OAuth sign-up no longer strands the window on the Account Portal profile page: the portal-recovery net now also watches in-page (SPA) navigations — the portal's post-transfer router push to `/user` never fired `did-navigate` — and puts a 30s watchdog on the automatic `#/sso-callback` leg so a dead transfer page recovers into the app (where the boot sweep completes the sign-up) instead of requiring a restart. (2) Installing a full app update now actually runs it: the bootstrap's bundle gate gained a floor-version check (`older-than-floor` reject + active-pointer cleanup), so a hot-update override staged by a PREVIOUS install can no longer outrank the freshly installed shell — previously a stale 0.6 override kept booting over a newly installed 0.7.0, which then re-demanded the full installer forever.
