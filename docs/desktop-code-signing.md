# Desktop code signing & notarization (macOS + Windows)

This guide takes the **MoxxyAI Workspaces** desktop app from *unsigned (ad-hoc)*
to **Developer ID signed + notarized** on macOS, so users never see the
"damaged" / "unidentified developer" Gatekeeper prompts. It also covers
optional Windows Authenticode signing.

You only need a **paid Apple Developer Program** membership
(<https://developer.apple.com/programs/> — \$99/yr). Everything below is done
once; after that, every `desktop-v*` release is signed automatically by CI.

The release workflow (`.github/workflows/release.yml`) is already wired
to **activate signing automatically when the secrets exist** and fall back to
the current ad-hoc/unsigned build when they don't. So the entire task is:
**create the credentials → paste them into GitHub Secrets → cut a release**
(merge a changeset that bumps `@moxxy/desktop`).

---

## macOS

### Step 1 — Create a "Developer ID Application" certificate

This is the cert that signs apps distributed *outside* the Mac App Store.

**Easiest path (Xcode):**

1. Install Xcode (App Store) and sign in: **Xcode ▸ Settings ▸ Accounts**, add
   your Apple ID, select your Team.
2. Click **Manage Certificates… ▸ + ▸ Developer ID Application**. Xcode creates
   the cert and its private key in your login Keychain.

**Manual path (no Xcode):**

1. Keychain Access ▸ **Certificate Assistant ▸ Request a Certificate From a
   Certificate Authority…** → save a `CertificateSigningRequest.certSigningRequest`
   to disk ("Saved to disk", leave CA email blank).
2. <https://developer.apple.com/account/resources/certificates/list> ▸ **+** ▸
   **Developer ID Application** ▸ upload the CSR ▸ download the `.cer`.
3. Double-click the `.cer` to import it into Keychain Access.

> If you've never created a Developer ID cert for this team before, Apple may
> require you to be the **Account Holder** (or be granted access). See
> <https://developer.apple.com/help/account/create-certificates/create-developer-id-certificates/>.

### Step 2 — Export the cert as a `.p12` and base64-encode it

1. **Keychain Access ▸ login ▸ My Certificates**. Find
   **Developer ID Application: <Your Name> (<TEAMID>)**. Expand it — it must
   show a private key underneath (if not, the export won't work).
2. Right-click the certificate ▸ **Export…** ▸ format **Personal Information
   Exchange (.p12)** ▸ set a strong password (you'll need it as a secret) ▸ save
   as `moxxy-desktop.p12`.
3. Base64-encode it (single line, copied to your clipboard):

   ```sh
   base64 -i moxxy-desktop.p12 | pbcopy
   ```

### Step 3 — Create notarization credentials

Notarization is Apple scanning the signed app and issuing a "ticket". Pick **one**
method. **App Store Connect API key is recommended** (doesn't expire, no 2FA).

**Method A — App Store Connect API key (recommended)**

1. <https://appstoreconnect.apple.com/access/integrations/api> ▸ **Team Keys** ▸
   generate a key with the **Developer** role.
2. Download the `AuthKey_XXXXXXXXXX.p8` (one-time download). Note the **Key ID**
   (the `XXXXXXXXXX`) and the **Issuer ID** (UUID at the top of the page).
3. Base64-encode the key:

   ```sh
   base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
   ```

**Method B — Apple ID + app-specific password**

1. <https://account.apple.com> ▸ **Sign-In and Security ▸ App-Specific
   Passwords** ▸ **+** ▸ name it `moxxy-notarize` ▸ copy the generated password
   (form `abcd-efgh-ijkl-mnop`).
2. Find your **Team ID**: <https://developer.apple.com/account> ▸ **Membership
   details ▸ Team ID** (10 chars, e.g. `AB12CD34EF`).

### Step 4 — Add the GitHub repo secrets

Repo ▸ **Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret**.

Always add:

| Secret | Value |
|---|---|
| `CSC_LINK` | the base64 of `moxxy-desktop.p12` (Step 2) |
| `CSC_KEY_PASSWORD` | the `.p12` export password (Step 2) |

Then add **either** Method A **or** Method B from Step 3:

| Method A (API key) | Method B (Apple ID) |
|---|---|
| `APPLE_API_KEY` = base64 of the `.p8` | `APPLE_ID` = your Apple ID email |
| `APPLE_API_KEY_ID` = the Key ID | `APPLE_APP_SPECIFIC_PASSWORD` = the app-specific password |
| `APPLE_API_ISSUER` = the Issuer ID | `APPLE_TEAM_ID` = your 10-char Team ID |

> The workflow only turns on signing when `CSC_LINK` is present, and only
> notarizes when one of the credential sets above is present. With none set, it
> builds exactly as it does today (ad-hoc, unsigned).

### Step 5 — Release

There is **no tag to push by hand** — the `Release` workflow only triggers on
pushes to `main`, and the `desktop-v*` tag is created *by* the workflow, not
for it. A desktop release is cut by merging the changesets **Version Packages**
PR (i.e. land a changeset that bumps `@moxxy/desktop`). On that merge commit:

1. the `version-publish` job publishes npm packages, sees the committed desktop
   version has no `desktop-v<version>` tag yet, and **pins the release commit
   sha** (it does not tag);
2. the `desktop-build` matrix builds the installers on macOS/Windows/Linux
   **from that pinned sha** — this is where signing + notarization run;
3. only after **every** build leg succeeds does the `desktop-release` job push
   the `desktop-v<version>` tag at that sha and create a **draft** GitHub
   Release with the artifacts.

Tag-last ordering means a failed installer build leaves no tag behind — the
next run on `main` simply re-releases the same version. Review the draft and
**Publish** it (the self-updater ignores drafts — see
`docs/desktop-self-update.md`).

### Step 6 — Verify a build is properly signed

Download the DMG, then on a Mac:

```sh
# 1. The .app is signed with a Developer ID (not "adhoc")
codesign -dv --verbose=4 "/Applications/MoxxyAI Workspaces.app" 2>&1 | grep -E 'Authority|TeamIdentifier|flags'
#   → Authority=Developer ID Application: <you> (<TEAMID>), flags=…runtime…

# 2. Gatekeeper accepts it (this is the real test)
spctl -a -vvv -t install "/Applications/MoxxyAI Workspaces.app"
#   → accepted, source=Notarized Developer ID

# 3. The notarization ticket is stapled (works offline)
xcrun stapler validate "/Applications/MoxxyAI Workspaces.app"
#   → The validate action worked!
```

A correctly notarized build opens with a **double-click, no warning** — no
right-click→Open, no `xattr`.

---

## What the repo already does for you

When the secrets above exist, CI does all of this — you don't edit anything:

- **`apps/desktop/package.json` ▸ `build.mac`** declares `hardenedRuntime: true`
  and points at **`build/entitlements.mac.plist`** (Electron needs the JIT /
  unsigned-executable-memory entitlements under the hardened runtime). These are
  no-ops when the build isn't signed.
- **`release.yml`** has a **Configure macOS signing** step. With no `CSC_LINK`
  it exports `CSC_IDENTITY_AUTO_DISCOVERY=false` (electron-builder skips
  signing; `build/after-pack.cjs` ad-hoc signs instead). With `CSC_LINK` set it
  turns discovery on and base64-decodes `APPLE_API_KEY` to a `.p8` file; the
  **Package installers** step then adds `-c.mac.notarize=true` — but only when
  one of the notarization credential sets exists. `CSC_LINK` alone signs
  **without** notarizing.
- The **ad-hoc signing** in `build/after-pack.cjs` is skipped automatically when
  a real Developer ID cert is present (so we never double-sign).
- **The Python and the Git inside the app are signed too.** They travel as
  archives under `Resources/runtimes-seed`, and Apple's notary service opens
  archives: every program and library in them needs a Developer ID signature,
  a secure timestamp and, for a program, the hardened runtime. electron-builder
  signs the app and never looks inside an archive, so `release.yml` has an
  **Import the Developer ID certificate** step that puts `CSC_LINK` in a
  keychain and exports `MOXXY_MAC_SIGN_IDENTITY`; with it set,
  `apps/desktop/scripts/bundle-runtimes-seed.mjs` signs both runtimes before it
  packs them (see [Signed runtimes](#signed-runtimes-python-and-git) below).
- Signing also unblocks macOS **Tier-2** (shell) auto-updates: Squirrel.Mac
  refuses unsigned apps, so `apps/desktop/electron/main/shell-updater.ts`
  currently no-ops on macOS. Once signed builds ship, remove that
  `process.platform === 'darwin'` guard to enable it.

So the only thing that changes between an unsigned and a signed release is the
**presence of the secrets**.

### Signed runtimes (Python and Git)

`scripts/macos-code-signature.mjs` finds the Mach-O files of a runtime by
their content, not their name, and signs the ones without a Developer ID
signature:

- **What is left alone.** Node, `git-lfs` and the Git Credential Manager
  arrive signed by their makers (Node.js Foundation, GitHub, Microsoft). Apple
  accepts those signatures, and signing them again would drop the entitlements
  they need (the Credential Manager is a .NET program that compiles code as it
  runs).
- **Python's entitlements** (`build/entitlements.python.mac.plist`). The
  hardened runtime only loads libraries signed by Apple or by the team that
  signed the program. Without `disable-library-validation`, `import numpy`
  fails for every package installed later with `pip`, none of which we sign.
  The other three keep what a plain Python does: packages that compile code
  while running, `ctypes` callbacks on Intel Macs, and `DYLD_LIBRARY_PATH`.
  Git needs none.
- **The check before notarization.** `release.yml` runs
  `scripts/verify-macos-runtime-signatures.mjs` on the prepared resources: it
  unpacks each macOS archive and reads every signature, as the notary service
  does. Notarization answers after the installer is built and uploaded, most of
  an hour into a release; this fails in a minute and names the files.
- **Without a certificate.** `MOXXY_MAC_SIGN_IDENTITY=-` signs ad-hoc: no
  Developer ID, but the same hardened runtime and entitlements. The pull-request
  job `Packaged desktop smoke (macos-latest)` prepares the resources that way
  and runs them (`scripts/smoke-runtimes.mjs`), so a runtime the hardened
  runtime breaks fails there. Unset, the runtimes are packed as downloaded,
  which is what a local build does.

```sh
# What would notarization refuse in the resources prepared on this Mac?
node apps/desktop/scripts/verify-macos-runtime-signatures.mjs apps/desktop/resources
```

---

## Windows (optional)

Windows SmartScreen warnings are cleared by an Authenticode (preferably **EV** /
OV) code-signing certificate from a CA (DigiCert, Sectigo, SSL.com, …). EV certs
ship on a hardware token / use a cloud HSM, which doesn't fit headless CI without
the CA's signing service. The common setups:

- **Azure Trusted Signing** (<https://learn.microsoft.com/azure/trusted-signing/>)
  — Microsoft's managed signing; integrates with CI via `azure/trusted-signing-action`.
- **SSL.com eSigner** / **DigiCert KeyLocker** — cloud HSM + a CLI you call from CI.

To wire a file-based OV cert, add `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` as
repo secrets **and forward them as env on the "Package installers" step in
`release.yml`** (unlike the macOS `CSC_*`/`APPLE_*` secrets, the workflow does
not pass any `WIN_CSC_*` env today) — electron-builder then signs the `.exe`.
Cloud-HSM providers need their action/CLI added as a step instead. Until then,
Windows builds remain unsigned (users click **More info → Run anyway**).

---

## Troubleshooting

- **`The specified item could not be found in the keychain` / no identity** —
  `CSC_LINK`/`CSC_KEY_PASSWORD` wrong, or the `.p12` was exported **without** its
  private key (re-export from *My Certificates*, expanding to confirm the key).
- **`You must first sign the relevant contracts…`** — accept the latest Apple
  Developer agreements at <https://developer.apple.com/account> before issuing
  the cert / notarizing.
- **Notarization `Invalid` / `Team is not yet configured`** — the API key needs
  the **Developer** role; the Apple ID must be on the team; double-check
  `APPLE_API_ISSUER` (Issuer ID, not Key ID).
- **`Hardened Runtime` crash / "killed: 9" at launch** — a missing entitlement;
  ensure `build/entitlements.mac.plist` includes
  `com.apple.security.cs.allow-jit` and
  `com.apple.security.cs.allow-unsigned-executable-memory` (it does).
- **Notarization `Invalid`, "The binary is not signed with a valid Developer ID
  certificate" for paths under `runtimes-seed/…tar.gz`** — a program inside a
  runtime archive is not signed. Run `verify-macos-runtime-signatures.mjs`
  (above) on the prepared resources; if the list is not empty in a release,
  the **Import the Developer ID certificate** step did not export
  `MOXXY_MAC_SIGN_IDENTITY`.
- **`import numpy` fails with "different Team IDs" in the bundled Python** —
  `python3.12` lost `disable-library-validation`; see
  `build/entitlements.python.mac.plist`.
- **Still "damaged" after signing** — the build wasn't notarized (check the
  notarize step ran) or the ticket wasn't stapled; re-run `stapler validate`.
