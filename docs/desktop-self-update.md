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
| **Tier 2** (rare) | Electron / Chromium / Node version, native-module ABI | `electron-updater` against GitHub Releases | Win/Linux: background download + install on restart. macOS: disabled (`shell-updater.ts` no-ops — Squirrel.Mac needs a signed app); the Tier-1 "needs a full app update" banner links the release page instead. |

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
   copy's preload + `dist/`. The whole bundle moves together. The main's
   `@moxxy/*` workspace deps are inlined into `dist-electron` by electron-vite
   (`BUNDLED_WORKSPACE_DEPS` in `apps/desktop/electron.vite.config.ts`), so both
   the floor and a hot bundle are self-contained — the packaged app ships no
   workspace `node_modules`.
3. **The updater** (`@moxxy/desktop-host/app-update`, surfaced via the
   `app.checkUpdate` / `app.updateDashboard` IPC, the update dashboard panel +
   launch banner) resolves the newest **published** `desktop-v*` release via the
   GitHub Releases API (semver-highest; drafts + prereleases skipped), verifies
   its manifest, downloads + hash-checks the gzipped bundle, extracts into a
   fresh `*.incoming-*` dir, re-verifies the signed per-file hashes against the
   extracted tree, then atomically renames it into place and flips
   `active.json` (pruning keeps {new, previous-good}). A `{"type":"module"}`
   `package.json` marker sits at the staged bundle root (shipped by
   `buildAppBundle`, with a stager safety-net for older bundles) so the ESM
   main loads under the bootstrap's `import()` instead of being parsed as
   CommonJS.
4. **Boot-probe rollback** — the bootstrap writes a breadcrumb
   (`last-attempt.json`) before loading an override. Health is then confirmed
   **from the main process** by polling the renderer DOM: `index.html` ships a
   static `#splash-fallback` that React replaces on mount, so "splash gone +
   `#root` populated" proves a healthy render with no renderer cooperation. The
   renderer's `app.appBooted` IPC heartbeat is kept only as a fast path (it
   proved flaky in packaged builds and used to poison healthy updates). A
   bundle that never renders within 15s is poisoned (`bad.json`) and the app
   relaunches onto the previous-good bundle or the floor; a next-launch check
   (`recoverFromFailedBoot`) covers crashes that beat the probe.
5. **Boot-decision log** — every boot/recover/probe/confirm/load-error decision
   (and *why*: the structured resolve reject reason, e.g. `bad-signature`,
   `file-tampered`) is appended to `<userData>/app/boot-log.json` (rolling 50
   entries) and surfaced via the `app.updateDiagnostics` IPC in the update
   dashboard's Diagnostics panel — a silent fall-back-to-floor is no longer
   invisible.

State files live under `<userData>/app/`: `active.json` (which bundle to load),
`confirmed.json` (last healthy version), `bad.json` (poisoned versions),
`last-attempt.json` (boot breadcrumb), `boot-log.json` (decision log), and one
`<version>/` dir per staged bundle.

### Security model

- **Ed25519 signature** over the manifest (public key baked into the bootstrap)
  — the root of trust. The signature covers the version, the compatibility
  gates, `bundleUrl`, the archive `sha256`, and (when present) the per-file
  `files` map — so neither the payload nor the map can be swapped or stripped.
- **SHA-256 of the gzipped download**, bound by the signed manifest — checked
  by the stager before extraction.
- **Signed per-file integrity map** (`files`: bundle-relative path → sha256) —
  verified against the extracted tree at stage time (fail fast, nothing
  activates) **and again by the bootstrap at every load**
  (`resolveActiveBundleDetailed`'s `file-tampered` reject), so an unprivileged
  write under `<userData>/app/` can't pair a tampered file with a genuine
  manifest. **Legacy manifests** (published before the map existed) carry no
  `files` map: they still load, but only their download hash was ever verified
  — their staged tree is NOT re-checked at load time (grandfathered).
- **HTTPS + host allow-list** — only `github.com` / `githubusercontent.com`
  (and subdomains) are ever fetched; the update SOURCE is resolved main-side
  only (the renderer never supplies a URL; the `MOXXY_UPDATE_URL` override is
  honored only in non-packaged runs).
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

A desktop release is cut by merging the changesets **Version Packages** PR that
bumps `@moxxy/desktop`. `release.yml` then builds + signs the bundle (the
"Build + sign app update bundle" step, Linux leg, skipped without the key),
builds the installers from a pinned sha, and — only after **every** installer
build succeeds — pushes the `desktop-v<version>` tag and attaches
`moxxy-app-manifest.json` + `moxxy-app-bundle-<version>.json.gz` (Tier 1) plus
the electron-updater `latest*.yml` + blockmaps (Tier 2) to a **draft** GitHub
Release. Tag-last ordering means a failed build never burns the version.

> **The release must be PUBLISHED, not left as a draft.** Clients discover
> updates by listing the repo's releases via the GitHub API and picking the
> semver-highest **published** `desktop-v*` release — the stager skips drafts
> and prereleases (it does NOT use `releases/latest/...`, which in this
> monorepo usually points at a CLI release). The workflow always creates a
> draft for review; **Publish** it to turn updates on.

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
pnpm build   # the script needs @moxxy/desktop-host/dist + apps/desktop/dist*
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
- `packages/desktop-host/src/app-update/` — manifest (signing/canonicalization) +
  resolve (the verify gate, incl. the per-file check) + stager + boot-log +
  build, exposed as the `@moxxy/desktop-host/app-update` subpath (node-builtins
  only, baked into the bootstrap).
- `packages/desktop-host/src/ipc/update.ts` — the `app.*` update IPC handlers
  (incl. `app.updateDiagnostics`).
- `apps/desktop/src/settings/DashboardUpdateSection.tsx`,
  `apps/desktop/src/shell/UpdateBanner.tsx`, and the shared
  `packages/client-core/src/useAppUpdate.ts` hook — the UI.
- `scripts/build-app-bundle.mjs` — the CI publisher.
