# Desktop self-update (hot-update the app without reinstalling)

The **MoxxyAI Workspaces** desktop updates itself **without making users download
and reinstall a new binary** for the common case. Most of the app is JavaScript —
only the Electron/Chromium/Node shell is a true binary — so a release ships as a
small signed JS bundle that the app verifies and swaps in on the next launch.

This is the same trust model the app already uses to update the bundled
`@moxxy/cli` (install into writable userData, prefer it over the bundled copy):
here it's the desktop's **own** renderer + main + preload + IPC contract.

---

## Two tiers

| | What changes | Mechanism | User experience |
|---|---|---|---|
| **Tier 1** (≈ every release) | renderer, main process, preload, **IPC/protocol**, any JS | Signed **app bundle** downloaded into `<userData>/app/<version>/`, activated on next launch | Banner → "Update" → relaunch. **No binary download.** |
| **Tier 2** (rare) | Electron / Chromium / Node version, native-module ABI | `electron-updater` against GitHub Releases | Win/Linux: background download + install on restart. macOS: notify + open release page (until signed). |

Tier 1 covers protocol/IPC changes safely because the renderer and the main
process that talk to each other always come from the **same** bundle — there's
never a version skew. You can rename/add/remove IPC commands freely.

---

## How Tier 1 works

```
package.json#main → dist-electron/main/bootstrap.js   ← the immutable "floor" (in the signed .app)
                         │
                         │ verify + pick
                         ▼
   <userData>/app/<version>/dist-electron/main/index.js   ← hot-updatable bundle (if present + valid)
        else  <app>/dist-electron/main/index.js           ← bundled floor
```

1. **Bootstrap (`apps/desktop/electron/main/bootstrap.ts`)** is the only piece a
   hot-update can never replace. It picks which bundle's real `index.js` to load,
   verifying first. The verify/resolve logic + the baked public key are inlined
   into `bootstrap.js`, so the gate lives in the part an attacker can't swap.
2. **The real main** resolves its preload + renderer relative to its own
   `import.meta.dirname`, so loading the userData copy automatically uses that
   copy's preload + `dist/`. The whole bundle moves together.
3. **The updater** (`@moxxy/desktop-host/app-update`, surfaced via the
   `app.checkUpdate` / `app.updateDashboard` IPC and the About → Dashboard panel
   + launch banner) fetches the manifest, verifies it, downloads + integrity-checks
   the bundle, extracts it atomically, and flips `active.json`.
4. **Boot-probe rollback** — the renderer pings `app.appBooted` once it renders;
   a bundle that loads but never confirms (white-screen / crash) is poisoned and
   the previous-good bundle (or the floor) is used. Both an in-session timer and
   a next-launch check (`recoverFromFailedBoot`) cover this.

### Security model

- **Ed25519 signature** over the manifest (baked public key) — the root of trust.
- **SHA-256** of the gzipped bundle, bound by the signed manifest.
- **HTTPS + host-pin** to GitHub + its asset CDN; the update SOURCE is resolved
  main-side only (the renderer never supplies a URL).
- **Compatibility gate** (`minElectron`, optional `nodeAbi`) — an incompatible
  bundle is treated as a Tier-2 (shell) update, never loaded as JS.
- **Off by default:** with no public key baked in, the app always runs the floor
  and the updater refuses to download. A build can't be tricked into loading an
  unsigned bundle.

---

## Enabling it (one-time, owner)

Self-update ships **disabled** until you bake a signing key.

### 1. Generate the keypair

```sh
openssl genpkey -algorithm ed25519 -out moxxy-update.key   # PRIVATE — keep secret
openssl pkey -in moxxy-update.key -pubout                  # PUBLIC — paste below
```

### 2. Bake the public key

Paste the public SPKI PEM (the whole `-----BEGIN/END PUBLIC KEY-----` block) into
`apps/desktop/electron/main/update-key.ts`:

```ts
export const BUNDLED_UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA...
-----END PUBLIC KEY-----
`;
```

### 3. Add the private key as a CI secret

In GitHub → Settings → Secrets → Actions, add **`MOXXY_UPDATE_SIGNING_KEY`** =
the contents of `moxxy-update.key`. The release workflow signs the manifest with
it (and skips the bundle if it's absent — forks/PRs still build).

### 4. Publish the release

`release-desktop.yml` builds + signs the bundle and uploads
`moxxy-app-manifest.json` + `moxxy-app-bundle-<version>.json.gz` (Tier 1) and the
`latest*.yml` + blockmaps (Tier 2) on each `desktop-v*` tag.

> **The release must be PUBLISHED, not left as a draft.** Clients fetch via
> `releases/latest/download/...`, which only resolves to published releases. The
> workflow creates a draft for review; **Publish** it to turn updates on.

For Tier-2 auto-apply on macOS, also complete `docs/desktop-code-signing.md`
(Developer ID signing + notarization). Until then macOS Tier-2 is notify-only.

---

## Verifying locally

The full build → stage → load round-trip (including a renamed IPC command, to
prove protocol changes ride Tier 1) is covered by the unit/integration tests:

```sh
pnpm --filter @moxxy/desktop-host test app-update
```

To exercise the publisher against a real `dist/`:

```sh
pnpm --filter @moxxy/desktop build
MOXXY_UPDATE_SIGNING_KEY="$(cat moxxy-update.key)" node scripts/build-app-bundle.mjs
# → apps/desktop/release/update/{moxxy-app-manifest.json, moxxy-app-bundle-<v>.json.gz}
```

A packaged end-to-end check (build vN, install vN+1 via a local manifest, confirm
relaunch picks up the new bundle, corrupt it and confirm rollback) uses the
`MOXXY_UPDATE_URL` dev override (honored only in non-packaged / dev runs).

---

## Files

- `apps/desktop/electron/main/bootstrap.ts` — the immutable floor / loader.
- `apps/desktop/electron/main/update-key.ts` — the baked public key.
- `apps/desktop/electron/main/shell-updater.ts` — Tier-2 (electron-updater).
- `packages/desktop-host/src/app-update/` — manifest + verify + resolve + stager +
  build, exposed as the `@moxxy/desktop-host/app-update` subpath (node-builtins
  only, baked into the bootstrap).
- `packages/desktop-host/src/ipc/update.ts` — the `app.*` update IPC handlers.
- `apps/desktop/src/settings/DashboardUpdateSection.tsx`,
  `apps/desktop/src/shell/UpdateBanner.tsx`, `apps/desktop/src/lib/useAppUpdate.ts`
  — the UI.
- `scripts/build-app-bundle.mjs` — the CI publisher.
