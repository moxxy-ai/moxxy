# @moxxy/anonymizer

A pure, **dependency-free, network-free** PII detection + redaction engine.

```ts
import { redact } from '@moxxy/anonymizer';

const { text, report } = redact('Call me at john@acme.com or +1 (415) 555-2671');
// text   → 'Call me at [EMAIL] or [PHONE]'
// report → { counts: { email: 1, phone: 1, ... }, total: 2, spans: [...] }
```

## Why it has zero dependencies

This package is imported into the desktop app's **renderer**, where CSP
`connect-src 'self'` blocks all network egress. The engine's only inputs are
strings and options — it never imports a network or filesystem API. That
emptiness is the load-bearing offline guarantee and is enforced by
`offline.test.ts` (asserts `dependencies` is `{}` and the source references no
`fetch` / `XMLHttpRequest` / `node:http` / etc.). **Keep `dependencies` empty.**

## What it detects

High-precision, validator-backed detectors (correctness over recall):

| Category | Validation |
| --- | --- |
| `email`, `url` | shape + TLD |
| `creditCard` | Luhn |
| `iban` | mod-97 |
| `ipv4` | octet ≤ 255 |
| `ipv6` | group structure (a MAC is not an IPv6) |
| `mac` | 6 hex groups |
| `ssn` | US area/group/serial sanity |
| `phone` | 7–15 digits, requires grouping, rejects date shapes |
| `date` | opt-in (high false-positive rate) |

`custom` matches literal user-supplied terms (names, addresses) case-insensitively
on word boundaries.

## Names, orgs, locations (NER)

The engine does **not** do named-entity recognition — that needs a model. The
desktop app runs an on-device NER model and feeds its results in via
`detect(text, { extraSpans })` / `redact(text, { extraSpans })`, where each span
is `{ category: 'person' | 'org' | 'location', start, end, value }`. They merge
through the same overlap-resolution pass as the built-in detectors.

## Redaction modes

- `label` (default) — `[EMAIL]`
- `pseudonym` — `EMAIL_1` (same value → same token, numbered in document order)
- `hash` — `[EMAIL:a1b2c3d4]` (stable, compact; obfuscation, not cryptography)
