/**
 * Baked Ed25519 PUBLIC key (SPKI PEM) — the root of trust for the signed
 * plugin registry. `fetchSignedRegistry` accepts a remote `index.json` ONLY
 * when `index.json.sig` is a valid signature from the matching private key
 * (held by the registry maintainer in PRIVATE publisher tooling — never in
 * this repo).
 *
 * EMPTY string ⇒ the remote registry is DISABLED entirely: every lookup
 * short-circuits to the hardcoded `INSTALLABLE_PLUGIN_CATALOG` and no network
 * request is ever made. This is the safe default — an unconfigured build can
 * never be tricked into trusting an unsigned (or wrongly-signed) index.
 * Mirrors `BUNDLED_UPDATE_PUBLIC_KEY` in the desktop self-update bootstrap.
 *
 * There is deliberately NO PKI and NO runtime key configuration: one
 * maintainer key, baked as a constant. Key rotation = paste the new public
 * key here and ship a new CLI release; older CLIs keep verifying against the
 * old key until they update (indexes signed with the new key simply fail
 * verification there and those CLIs fall back to their hardcoded catalog —
 * degraded, never compromised).
 *
 * To provision, generate ONE keypair and paste the public SPKI PEM below
 * (the private key stays with the publisher tooling in the private repo):
 *
 *   openssl genpkey -algorithm ed25519 -out moxxy-registry.key
 *   openssl pkey -in moxxy-registry.key -pubout       # paste the output below
 *
 * The PEM must be the literal multi-line block, including the
 * -----BEGIN/END PUBLIC KEY----- lines.
 */
export const REGISTRY_PUBLIC_KEY = '';
