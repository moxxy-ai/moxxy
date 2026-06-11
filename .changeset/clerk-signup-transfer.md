---
'@moxxy/desktop': patch
'@moxxy/desktop-host': patch
---

Fix desktop sign-in never creating accounts for new users ("External account not found"). The account-portal recovery net no longer kills the portal's `/sign-in` + `/sign-up` pages — the OAuth sso-callback leg that converts a new-user sign-in into a sign-up runs there — and the renderer now sweeps up any dangling transferable OAuth attempt on boot and completes the sign-up + sign-in itself (`OAuthTransferBridge`), with a `clerk-captcha` mount node so bot-protection challenges can render outside the prebuilt components.
