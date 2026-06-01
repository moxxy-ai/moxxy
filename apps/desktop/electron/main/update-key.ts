/**
 * Baked Ed25519 PUBLIC key (SPKI PEM) — the root of trust for desktop
 * self-updates. The bootstrap loads a hot-updated app bundle ONLY if its
 * manifest carries a valid signature from the matching private key (held by the
 * release owner as the `MOXXY_UPDATE_SIGNING_KEY` CI secret).
 *
 * EMPTY string ⇒ self-update is DISABLED: the bootstrap always runs the bundled
 * floor and the in-app updater refuses to download. This is the safe default —
 * an unconfigured build can never be tricked into loading an unsigned bundle.
 *
 * To enable self-updates, generate ONE keypair and paste the public SPKI PEM
 * below (keep the private key secret, add it as `MOXXY_UPDATE_SIGNING_KEY`):
 *
 *   openssl genpkey -algorithm ed25519 -out moxxy-update.key
 *   openssl pkey -in moxxy-update.key -pubout          # paste the output below
 *
 * The PEM must be the literal multi-line block, including the
 * -----BEGIN/END PUBLIC KEY----- lines.
 */
export const BUNDLED_UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAALQzzfvrq54zt+cgfcisTH5F25gO2dSFkw8UW3eS0Uw=
-----END PUBLIC KEY-----
`;
