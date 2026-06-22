# @moxxy/anonymizer

A pure, **dependency-free, network-free** PII detection + redaction engine with a
**region-aware detector dictionary** (Poland 🇵🇱 / UK 🇬🇧 / US 🇺🇸 + global) and
checksum-backed validators.

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

Crypto-wallet and secret detectors are therefore **structural** (prefix + charset
+ length), not cryptographic — implementing Base58Check / Keccak-256 / CRC32
would either pull in a dependency or hand-roll crypto, so the engine validates
shape and leaves the (rare) checksum false-positive to the high-priority
overlap resolution.

## The dictionary

Every detector lives in `dictionary.ts` as a `DetectorDef` — a candidate regex
plus an optional pure validator (`validators.ts`) and an optional *context*
keyword. The regex finds candidates; the **checksum/validator is the primary
precision lever**, and bare-numeric / no-checksum identifiers additionally
require a nearby keyword (e.g. `NIP`, `NHS`, `routing`) within 48 chars.

| Region | Identifiers (subtype label) | Validation |
| --- | --- | --- |
| global | `EMAIL`, `URL`, `IP` (v4/v6), `MAC` | shape / octet / structure |
| global | `CARD` | Luhn (+ all-zeros guard) |
| global | `IBAN` | mod-97 + per-country length |
| global | `PHONE` | 7–15 digits, grouped, not a date |
| global · secrets | `AWS_KEY`, `GITHUB_TOKEN`, `STRIPE_KEY`, `GOOGLE_API_KEY`, `SLACK_TOKEN`, `OPENAI_KEY`, `JWT`, `PRIVATE_KEY` | structural prefix |
| global · opt-in | `BTC`, `ETH` (crypto), `IMEI` (Luhn), `VIN` (ISO-3779), `DATE` | structural / Luhn / mod-11 |
| 🇵🇱 PL | `PESEL` | weighted mod-10 + embedded birth-date |
| 🇵🇱 PL | `NIP`, `REGON` | mod-11 |
| 🇵🇱 PL | `DOWOD` (ID card), `PASSPORT` | weighted mod-10 |
| 🇵🇱 PL | `NRB` (bank account) | mod-97 |
| 🇵🇱 PL | `DL` (prawo jazdy), `REG_DOC` | structural + context |
| 🇬🇧 UK | `NINO` | DWP prefix/suffix rules |
| 🇬🇧 UK | `NHS`, `UTR` | mod-11 + context |
| 🇬🇧 UK | `POSTCODE` | BS7666 grammar |
| 🇬🇧 UK | `PASSPORT`, `DL`, `SORT_CODE` | structural + context |
| 🇺🇸 US | `SSN` | area/group/serial rules |
| 🇺🇸 US | `ITIN`, `EIN` | range / IRS prefix set |
| 🇺🇸 US | `MBI` (Medicare) | CMS class pattern |
| 🇺🇸 US | `ROUTING` (ABA) | weighted mod-10 + context |
| 🇺🇸 US | `ACCOUNT`, `PASSPORT`, `ZIP` | structural + context |

`custom` matches literal user-supplied terms (names, addresses) case-insensitively
on word boundaries.

## Selecting what runs

```ts
detect(text, {
  categories: ['email', 'nationalId', 'healthId'], // default: DEFAULT_CATEGORIES
  regions: ['PL', 'UK'],                            // default: every region; `global` always runs
  detectorIds: ['pl-pesel'],                        // explicit allow-list (overrides the above)
  customTerms: ['Project Bluebird'],
  extraSpans: nerSpans,                             // person/org/location from NER
});
```

- **`DEFAULT_CATEGORIES`** (the safe default profile): the global structured set
  + secrets + Polish `PESEL`/`NIP` + US `SSN`. High-false-positive categories
  (postcodes, passports, bank accounts, crypto, device/vehicle ids, dates) are
  **opt-in**.
- **`regions`** scopes the market-specific detectors so a Polish user isn't
  hit with UK/US false positives. `global` detectors always run.
- Each span carries a `subtype` (e.g. `PESEL`) used as the redaction label, plus
  the `region` it came from.

## Names, orgs, locations (NER)

The engine does **not** do named-entity recognition — that needs a model. The
desktop app runs an on-device **multilingual** NER model (XLM-RoBERTa) and feeds
its results in via `detect(text, { extraSpans })`, where each span is
`{ category: 'person' | 'org' | 'location', start, end, value }`. They merge
through the same overlap-resolution pass as the built-in detectors.

## Redaction modes

- `label` (default) — `[EMAIL]`. **Irreversible — the only mode that approaches
  true anonymisation.**
- `pseudonym` — `EMAIL_1` (same value → same token, numbered in document order).
  Reversible, so legally this is **pseudonymisation**, not anonymisation.
- `hash` — `[EMAIL:a1b2c3d4]` (stable, compact). A salted hash is still
  pseudonymisation — the salt is the "additional information" — **not**
  anonymisation.

## Legal scope

Detector coverage is chosen so the tool can credibly *anonymise* (not merely
*redact*) documents across these regimes:

- **GDPR (EU/Poland)** — Art. 4(1) personal data incl. online identifiers (IP,
  device ids, cookies); Art. 9 special categories (health → `NHS`/`MBI`, etc.);
  **Recital 26** is the anonymisation-vs-pseudonymisation line the redaction
  modes are labelled against. Poland's RODO/UODO gives **PESEL** heightened
  status, so it is a default-on detector.
- **UK GDPR + DPA 2018** — mirrors EU GDPR; the **NHS number** is health data
  (special category) and the ICO treats salted-hash output as pseudonymisation.
- **US (sectoral)** — no single statute: **HIPAA** Safe Harbor (the 18
  identifiers → names/dates/`SSN`/`MBI`/`ROUTING`/`ZIP`/IP/URL/`VIN`/`IMEI`),
  **GLBA** (financial), the SSA (`SSN`), and **CCPA/CPRA** personal information.

This is a detection aid, **not legal advice or a compliance guarantee** — a clean
report does not by itself establish that a document is anonymised under any of
these regimes (residual quasi-identifiers, free-text, scanned images, and the
HIPAA "no actual knowledge" / Recital-26 "all means reasonably likely" tests
still apply).
