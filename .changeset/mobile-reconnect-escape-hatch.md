---
"@moxxy/workspaces-app": patch
---

Mobile: stop trapping the app behind connection loaders.

The whole UI used to be gated behind the gateway transport — a paired phone that
couldn't reach its Mac (the desktop gateway is on-demand and off by default) sat
on a full-screen "Connecting to your Mac…" spinner with no way to reach settings
or re-pair, because the drawer and Account lived inside the connected-only chat.

Now the app shell always renders once a gateway is paired, connected or not:

- Removed the blocking gateway loaders (`SplashScreen`, `ReconnectScreen`,
  `ConnectingView`). Launch shows a neutral backdrop only while storage is read.
- Connection state is a single derived model (`buildConnectionState`) driving an
  inline status chip and, when the bridge is down, a non-blocking banner with
  Reconnect + Settings — never a screen that traps the user. Ordinary chat
  history still loads normally once the gateway is connected.
- A Connection sheet (tap the header status, or "Settings" in the banner) and the
  always-available drawer → Account expose Reconnect / Re-pair / Disconnect plus
  guidance to enable the gateway on the Mac.
- `usePairing` gains a non-destructive `reconnect()` and re-arms the bridge when
  the app returns to the foreground, so opening the app after enabling the Mac
  gateway just connects.
