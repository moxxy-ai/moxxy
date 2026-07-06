# @moxxy/anonymizer

## 0.1.1

### Patch Changes

- 2d085b2: Replace non-null assertions (`x!`) and deep optional chains (`a?.b?.c`) with
  guard clauses across the desktop-group packages, per the "Guard, don't chain"
  rule. Behaviour is preserved: silent-absence paths keep their early return /
  single-level `?.` / fallback, while accesses that are impossible-by-construction
  (in-bounds loop indices, mandatory regex capture groups, class invariants,
  checked preconditions) now fail loudly at the assumption site via
  `assertDefined`/`invariant` instead of a cryptic downstream `undefined`.

  Browser-bundled code (`@moxxy/chat-model` and the desktop renderer) uses a small
  dependency-free local guard helper rather than importing the helpers from the
  `@moxxy/sdk` root barrel, which transitively pulls Node-only modules (`node:fs`)
  and cannot be bundled for the browser.

## 0.1.0

### Minor Changes

- c058735: feat(desktop): Apps gallery with install lifecycle + offline document anonymizer

  Adds an **Apps** section (a new top-level header tab next to Chat / Workflows) — a
  registry-backed gallery of self-contained mini-applications. Apps that need local
  assets show a predefined **Install** step that downloads everything they need
  before first use; installation is the only time the network is touched, runs in
  the main process, and is gated behind an explicit click.

  The first app is an **offline document anonymizer**. Paste text or open a
  document (PDF / Office / text, parsed locally via the existing officeparser
  pipeline) and it detects + redacts PII — emails, phone numbers, credit cards
  (Luhn), SSNs, IPs, MACs, IBANs (mod-97), URLs — plus a custom-terms list and an
  **on-device NER** model (`Xenova/bert-base-NER`, ~109 MB, downloaded on install)
  for names, organizations and locations. Redaction runs entirely in the renderer
  (`@moxxy/anonymizer`, a new pure, dependency-free, network-free engine) with
  labeled / pseudonym / hash styles. **Documents never leave the machine**: the
  analyze path touches no provider/runner/network, the CSP `connect-src` stays
  local-only (the NER model is served from a confined `moxxy-app://` scheme over
  `userData/moxxy-apps`), and the engine's emptiness of dependencies is enforced by
  a unit test.
