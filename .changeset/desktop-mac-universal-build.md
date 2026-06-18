---
"@moxxy/desktop": patch
---

fix(desktop): build the macOS app as a universal binary (x86_64 + arm64)

The macOS installers were arm64-only, so Intel Macs — including many still on
Sonoma/Ventura/Monterey — could not launch the app at all (an arm64-only binary
cannot run on Intel; Rosetta only translates x86→arm). The mac `build.target`
now requests `arch: ["universal"]` for both the dmg and zip, producing a single
`moxxy-desktop-<v>-universal.{dmg,zip}` that runs on both architectures.

Supporting changes that were required for the universal merge to succeed and for
all native features to work on Intel:
- `build/after-pack.cjs` no longer ad-hoc signs the per-arch staging dirs
  (`mac-universal-*-temp`); signing them before the merge makes their
  `_CodeSignature` diverge and `@electron/universal` aborts. It now signs the
  merged universal app instead.
- `mac.x64ArchFiles` whitelists the single-arch native binaries the app bundles
  (sharp, @napi-rs/canvas, onnxruntime-node, node-pty, keyring) so the merge
  keeps them as-is while still lipo-merging the compiled `node-pty` addon.
- Root `pnpm.supportedArchitectures` installs both x64 and arm64 builds of the
  platform-split native deps (sharp / canvas / keyring), so each architecture
  loads its matching binary at runtime instead of degrading on Intel.

Also declares `minimumSystemVersion: 11.0.0` so Catalina (10.15) and older show
a clean "requires macOS 11" message (Electron 33's floor) instead of a confusing
launch failure.
