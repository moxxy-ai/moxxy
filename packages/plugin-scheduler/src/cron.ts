/**
 * Tiny POSIX-style 5-field cron parser.
 *
 *   ┌───────────── minute        (0-59)
 *   │ ┌─────────── hour          (0-23)
 *   │ │ ┌───────── day-of-month  (1-31)
 *   │ │ │ ┌─────── month         (1-12)
 *   │ │ │ │ ┌───── day-of-week   (0-6, Sunday=0)
 *   * * * * *
 *
 * Each field supports:
 *   - `*`           — any value in range
 *   - `n`           — literal
 *   - `a-b`         — inclusive range
 *   - `a,b,c`       — list
 *   - `*\/n`         — every n
 *   - `a-b/n`       — every n within a range
 *
 * `nextFireTime(expr, after)` walks forward minute-by-minute (with cheap
 * field-by-field jumps) until every field matches, capped at a year
 * lookahead. Returns null if no fire is reachable (impossible expression
 * like `0 0 31 2 *`).
 *
 * Standard cron quirk: when both DOM and DOW are restricted, vixie-cron
 * matches on EITHER. We follow that convention.
 */

interface FieldSpec {
  readonly values: ReadonlySet<number>;
  readonly restricted: boolean;
}

export interface ParsedCron {
  readonly minute: FieldSpec;
  readonly hour: FieldSpec;
  readonly dom: FieldSpec;
  readonly month: FieldSpec;
  readonly dow: FieldSpec;
}

interface FieldRange {
  readonly min: number;
  readonly max: number;
}

const FIELD_RANGES: Record<keyof ParsedCron, FieldRange> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dom: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dow: { min: 0, max: 6 },
};

function parseField(raw: string, range: FieldRange, fieldName: string): FieldSpec {
  const values = new Set<number>();
  const restricted = raw !== '*' && !raw.startsWith('*/');
  for (const piece of raw.split(',')) {
    const [rangePart, stepPart] = piece.split('/');
    if (rangePart === undefined) throw new Error(`empty term in ${fieldName}: "${raw}"`);
    const step = stepPart ? toIntStrict(stepPart, fieldName) : 1;
    if (step < 1) throw new Error(`step must be >= 1 in ${fieldName}: "${raw}"`);

    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = range.min;
      hi = range.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      lo = toIntStrict(a!, fieldName);
      hi = toIntStrict(b!, fieldName);
    } else {
      lo = toIntStrict(rangePart, fieldName);
      hi = lo;
    }
    if (lo < range.min || hi > range.max || lo > hi) {
      throw new Error(
        `out-of-range term "${piece}" in ${fieldName} (allowed ${range.min}-${range.max})`,
      );
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, restricted };
}

function toIntStrict(s: string, fieldName: string): number {
  if (!/^-?\d+$/.test(s)) throw new Error(`non-integer "${s}" in ${fieldName}`);
  return Number(s);
}

export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`cron expression must have 5 fields, got ${fields.length}: "${expr}"`);
  }
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  return {
    minute: parseField(minute, FIELD_RANGES.minute, 'minute'),
    hour: parseField(hour, FIELD_RANGES.hour, 'hour'),
    dom: parseField(dom, FIELD_RANGES.dom, 'dom'),
    month: parseField(month, FIELD_RANGES.month, 'month'),
    dow: parseField(dow, FIELD_RANGES.dow, 'dow'),
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Minute-precision walk forward from `after` (exclusive) until every
 * field matches. Operates in the caller-supplied IANA timezone via
 * `Intl.DateTimeFormat` — defaults to system local. The walk is
 * bounded at 1-year so a structurally-impossible expression returns
 * null instead of looping forever.
 */
export function nextFireTime(
  expr: string,
  after: Date,
  timeZone?: string,
): Date | null {
  const cron = parseCron(expr);
  // Start at after + 1 minute, zero seconds.
  const start = new Date(after.getTime() + 60_000);
  start.setSeconds(0, 0);
  const limit = new Date(start.getTime() + 366 * 24 * 60 * 60_000);

  // The field-by-field jump helpers mutate the cursor with system-local
  // `Date` methods, so they are only correct when matching is also done in
  // the host's local zone. For an explicit (non-local) IANA zone we walk
  // minute-by-minute on the absolute instant instead — slower, but advancing
  // the cursor by a fixed 60_000 ms is zone-independent, whereas the local
  // setHours/setDate jumps would land on the wrong wall-clock instant in the
  // target zone (off-by-offset / DST errors). The 1-year cap still bounds it.
  const explicitZone = !!timeZone && timeZone !== 'local';

  const cursor = new Date(start);
  while (cursor <= limit) {
    const parts = decomposeInZone(cursor, timeZone);
    if (!cron.month.values.has(parts.month)) {
      if (explicitZone) {
        cursor.setTime(cursor.getTime() + 60_000);
      } else {
        // Jump to the first day of the next candidate month.
        jumpToNextMonth(cursor, parts, cron.month.values, timeZone);
      }
      continue;
    }
    const domOk = cron.dom.values.has(parts.dom);
    const dowOk = cron.dow.values.has(parts.dow);
    // Vixie-cron OR semantics when both DOM and DOW are restricted.
    const dayMatches = cron.dom.restricted && cron.dow.restricted
      ? domOk || dowOk
      : domOk && dowOk;
    if (!dayMatches) {
      if (explicitZone) cursor.setTime(cursor.getTime() + 60_000);
      else jumpToNextDay(cursor, timeZone);
      continue;
    }
    if (!cron.hour.values.has(parts.hour)) {
      if (explicitZone) cursor.setTime(cursor.getTime() + 60_000);
      else jumpToNextHour(cursor, timeZone);
      continue;
    }
    if (!cron.minute.values.has(parts.minute)) {
      if (explicitZone) cursor.setTime(cursor.getTime() + 60_000);
      else cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(cursor.getTime());
  }
  return null;
}

interface DateParts {
  readonly year: number;
  readonly month: number; // 1-12
  readonly dom: number; // 1-31
  readonly dow: number; // 0=Sunday
  readonly hour: number;
  readonly minute: number;
}

function decomposeInZone(d: Date, timeZone?: string): DateParts {
  // Local time decomposition. We deliberately default to system-local —
  // a user saying "every day at 9 AM" overwhelmingly means their wall
  // clock, not UTC. Callers that need UTC pass timeZone='UTC'.
  if (!timeZone || timeZone === 'local') {
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      dom: d.getDate(),
      dow: d.getDay(),
      hour: d.getHours(),
      minute: d.getMinutes(),
    };
  }
  // Intl-based decomposition for explicit zones. Slower (allocates a
  // formatter) but correctness > perf on a per-minute poll.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) parts[part.type] = part.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    dom: Number(parts.day),
    dow: weekdayMap[parts.weekday!] ?? 0,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

function jumpToNextMonth(
  cursor: Date,
  current: DateParts,
  validMonths: ReadonlySet<number>,
  _timeZone?: string,
): void {
  // Find next valid month >= current+1; wraps to next year if needed.
  let nextMonth = current.month + 1;
  let yearDelta = 0;
  while (!validMonths.has(((nextMonth - 1) % 12) + 1)) {
    nextMonth += 1;
    if (nextMonth > 24) {
      // Pathological: walk hit a wall. Caller's outer loop will give up
      // at the 1-year limit.
      cursor.setFullYear(cursor.getFullYear() + 1);
      return;
    }
  }
  while (nextMonth > 12) {
    nextMonth -= 12;
    yearDelta += 1;
  }
  cursor.setFullYear(cursor.getFullYear() + yearDelta, nextMonth - 1, 1);
  cursor.setHours(0, 0, 0, 0);
}

function jumpToNextDay(cursor: Date, _timeZone?: string): void {
  cursor.setDate(cursor.getDate() + 1);
  cursor.setHours(0, 0, 0, 0);
}

function jumpToNextHour(cursor: Date, _timeZone?: string): void {
  cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
}
