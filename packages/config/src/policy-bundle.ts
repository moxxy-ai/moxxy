import { z } from 'zod';
import { verifyEd25519 } from '@moxxy/sdk';
import { permissionRuleSchema } from './schema.js';

/**
 * A signed, versioned set of permission rules an operator distributes to a
 * fleet.
 *
 * The problem it solves: pushing rules through `/etc/moxxy/config.yaml` works
 * on one machine, but across a fleet it means every rule change is a file
 * change on every host, and a machine that missed the change is
 * indistinguishable from one that received it. A bundle is fetched, signature
 * verified, and its version recorded in the audit trail, so "which rules was
 * this host running" has an answer.
 *
 * WHAT A BUNDLE MAY CONTAIN IS DELIBERATELY NARROW.
 *
 * It carries permission rules and nothing else. It cannot set `registryUrl`,
 * a public key, an audit sink, a proxy, or `security.enabled`. The reason is
 * the failure mode: a bundle arrives over the network, so the interesting
 * question is what someone who compromises the bundle host can do. Confined to
 * permission rules, the worst case is that they deny things and break the
 * fleet, which is loud, reversible, and fails safe. Let a bundle touch
 * `registryUrl` or a trust key and the worst case becomes redirecting every
 * machine's trust, silently. Denial of service is a much better worst case than
 * privilege escalation, and this schema is where that is enforced.
 */
export const policyBundleSchema = z.object({
  /** Bumped by this format, not by the publisher. Refuse what we cannot read. */
  version: z.literal(1),
  /** Identifies the bundle for humans and for the audit trail. */
  id: z.string().min(1).max(200),
  /** The publisher's own revision. Surfaced in `moxxy policy` and receipts. */
  revision: z.string().min(1).max(64),
  description: z.string().max(1000).optional(),
  permissions: z
    .object({
      allow: z.array(permissionRuleSchema).max(1000).optional(),
      deny: z.array(permissionRuleSchema).max(1000).optional(),
    })
    .optional(),
});

/**
 * Strict, so a bundle carrying anything outside the contract is REJECTED
 * rather than quietly stripped. Stripping would let a publisher believe they
 * had set `security.enabled` while the field silently did nothing, and it
 * would make "what can a bundle do" a question about this parser's defaults
 * instead of about the schema. `version` is a literal, so extending the format
 * later is a version bump, which is the right cost for a security document.
 */
export const strictPolicyBundleSchema = policyBundleSchema.strict();

export type PolicyBundle = z.infer<typeof policyBundleSchema>;
export type PolicyBundleRule = z.infer<typeof permissionRuleSchema>;

/** A real bundle is rules, not a payload. Refuse absurd bodies before parsing. */
const MAX_BUNDLE_BYTES = 1024 * 1024;

export type PolicyBundleFailure =
  | 'too-large'
  | 'unparseable'
  | 'schema'
  | 'bad-signature'
  | 'id-mismatch';

export interface PolicyBundleResult {
  readonly ok: boolean;
  readonly bundle?: PolicyBundle;
  readonly failure?: PolicyBundleFailure;
  readonly detail?: string;
}

/**
 * Verify then parse. Order matters: nothing is parsed until the signature over
 * the received bytes checks out, so a malformed or hostile document never
 * reaches the schema, let alone the permission engine.
 */
export function verifyPolicyBundle(
  bytes: Uint8Array,
  signatureB64: string,
  publicKeyPem: string,
  expectedId?: string,
): PolicyBundleResult {
  if (bytes.byteLength > MAX_BUNDLE_BYTES) {
    return { ok: false, failure: 'too-large', detail: `${bytes.byteLength} bytes` };
  }
  if (!verifyEd25519(bytes, signatureB64, publicKeyPem)) {
    return { ok: false, failure: 'bad-signature', detail: 'signature did not verify' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return { ok: false, failure: 'unparseable', detail: 'not valid JSON' };
  }

  const parsed = strictPolicyBundleSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, failure: 'schema', detail: parsed.error.issues[0]?.message ?? 'invalid' };
  }

  // A valid signature proves the publisher wrote this document. It does not
  // prove it is the document this host was configured to receive: without this
  // check, one signed bundle could be served in place of another from the same
  // publisher, which is a downgrade the signature alone will not catch.
  if (expectedId !== undefined && parsed.data.id !== expectedId) {
    return {
      ok: false,
      failure: 'id-mismatch',
      detail: `configured for '${expectedId}', served '${parsed.data.id}'`,
    };
  }

  return { ok: true, bundle: parsed.data };
}
