---
"@moxxy/desktop-host": patch
"@moxxy/desktop": patch
---

Fix desktop self-update failing to load every override ("Cannot use import
statement outside a module").

The hot-update bundle ships only `dist/**` + `dist-electron/**`, so a staged
bundle under `<userData>/app/<version>/` had **no `package.json` above its
main**. The real main (`dist-electron/main/index.js`) is emitted as an ES module
(`import` syntax), and Electron's bundled Node (v20, no ESM syntax
auto-detection) decides ESM-vs-CJS from the nearest `package.json#type` — with
none reachable it defaults to CommonJS and the bootstrap's `import()` threw
`Cannot use import statement outside a module`. Every staged version
(0.0.28/29/31/32) loaded this way got poisoned and the app silently reverted to
the baked floor. The floor itself loads fine only because the packaged `.app`
carries the desktop `package.json` (`"type":"module"`).

`buildAppBundle` now ships a minimal `{"type":"module"}` `package.json` at the
bundle root (signed into the bundle), and the stager writes the same marker at
extract time when a bundle lacks one — so already-published bundles are also
rescued on re-stage. The single marker is sourced from one constant shared by
the producer and the stager so they can't drift.
