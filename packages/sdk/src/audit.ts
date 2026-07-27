import type { MoxxyEvent, MoxxyEventType } from './events.js';
import type { SessionId, TurnId } from './ids.js';
import type { Principal } from './principal.js';

/**
 * The audit trail: a tamper-evident record of what the agent did, who it acted
 * for, and what was allowed or denied, in a form that can LEAVE the machine.
 *
 * Distinct from the event log, and the distinction is the whole point. The
 * event log is the conversation: complete, replayable, local, and full of
 * payloads nobody wants shipped to a SIEM. An audit record is the receipt:
 * bounded, redacted, hash-chained, and self-attributing, so one line is
 * meaningful on its own without replaying a session to interpret it.
 *
 * A swappable block like every other, mirroring `EventStoreDef`: core seeds a
 * protected local floor, plugins register alternatives (syslog, OTel, S3,
 * webhook), and the operator activates one by name.
 */

/** What kind of thing happened. Coarser than `MoxxyEventType` on purpose: an
 *  auditor reasons about categories of action, not about the loop's internals. */
export type AuditAction =
  /** The security-relevant config in force, recorded once per session. Without
   *  it a trail says what was done but not what the rules were at the time,
   *  which is the first question asked when reviewing a past run. */
  | 'policy'
  | 'prompt'
  | 'tool.request'
  | 'tool.approved'
  | 'tool.denied'
  | 'tool.result'
  | 'skill.invoked'
  | 'skill.created'
  | 'plugin.registered'
  | 'plugin.unregistered'
  | 'abort'
  /** Token counts for one provider call. Metadata only, never content, which
   *  is what makes cost attribution auditable without the trail carrying the
   *  conversation. */
  | 'usage'
  | 'error'
  | 'other';

/**
 * One record. Every field is either metadata or already-redacted, so the whole
 * object is safe to forward.
 */
export interface AuditRecord {
  /** Position in this sink's chain. Contiguous from 0; a gap is evidence. */
  readonly seq: number;
  readonly ts: number;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly action: AuditAction;
  /** The underlying event type, kept so a record can be traced back. */
  readonly eventType: MoxxyEventType;
  /**
   * Who it was done for. Absent means unattributed, which is itself worth
   * auditing: it says the surface could not establish an identity.
   */
  readonly actor?: Principal;
  /** Bounded, redacted, action-specific detail. Never raw payloads. */
  readonly detail?: Readonly<Record<string, unknown>>;
  /** Hash of the previous record, or null for the first. */
  readonly prevHash: string | null;
  /** Hash over this record's own fields plus {@link prevHash}. */
  readonly hash: string;
}

/** A record before the chain fields are computed. */
export type UnchainedAuditRecord = Omit<AuditRecord, 'seq' | 'prevHash' | 'hash'>;

export interface AuditSinkScope {
  readonly sessionId: SessionId;
  readonly cwd: string;
}

export interface AuditSinkSession {
  /**
   * Append one record.
   *
   * Takes an UNCHAINED record: sequencing and any tamper-evidence are the
   * sink's own concern, because each sink has its own ordering. The local file
   * chains by day; a syslog sink has no chain at all; a remote service assigns
   * its own sequence. Handing every sink a pre-sealed `seq`/`hash` would be a
   * lie for all but one of them.
   *
   * MUST NOT throw: a failing audit sink degrades loudly, it never takes down
   * the turn it is recording. Report failure by returning false.
   */
  write(record: UnchainedAuditRecord): Promise<boolean>;
  /** Flush anything buffered. Called on session close. */
  close(): Promise<void>;
}

export interface AuditSinkDef {
  readonly name: string;
  readonly description?: string;
  open(scope: AuditSinkScope): AuditSinkSession;
}

/** Freeze an audit-sink spec, mirroring the other `defineX` factories. */
export function defineAuditSink(def: AuditSinkDef): AuditSinkDef {
  return Object.freeze({ ...def });
}

/**
 * Which event types produce an audit record, and under what category.
 *
 * Everything absent from this map is conversation, not audit: assistant text,
 * reasoning, provider request/response, compaction, elision, mode iterations.
 * They belong in the event log and would only bloat a trail an auditor has to
 * read. Tool and permission traffic is what actually gets reviewed, so it is
 * named precisely.
 *
 * An exhaustive map rather than a `default:` so adding an event type is a
 * deliberate decision about whether it is auditable, not a silent 'other'.
 */
const AUDITED: Partial<Record<MoxxyEventType, AuditAction>> = {
  user_prompt: 'prompt',
  tool_call_requested: 'tool.request',
  tool_call_approved: 'tool.approved',
  tool_call_denied: 'tool.denied',
  tool_result: 'tool.result',
  skill_invoked: 'skill.invoked',
  skill_created: 'skill.created',
  plugin_registered: 'plugin.registered',
  plugin_unregistered: 'plugin.unregistered',
  abort: 'abort',
  provider_response: 'usage',
  error: 'error',
};

/** The audit category for an event, or null when it is conversation only. */
export function auditActionOf(event: MoxxyEvent): AuditAction | null {
  return AUDITED[event.type] ?? null;
}
