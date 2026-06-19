---
"@moxxy/desktop": minor
---

feat(anonymizer): region-aware PII dictionary (PL/UK/US) + multilingual on-device NER

The document anonymizer now *really* anonymises across markets instead of only
catching a handful of English-shaped patterns.

**Engine (`@moxxy/anonymizer`, still pure + offline + zero-dependency):**

- A `DICTIONARY` of 47 checksum-backed detectors assembled from official sources
  and adversarially verified, grouped by market:
  - **Poland** — PESEL (checksum + embedded birth-date), NIP, REGON, dowód
    osobisty, passport, NRB bank account (mod-97), driving licence, vehicle reg.
  - **UK** — National Insurance Number, NHS number, UTR, postcode (BS7666),
    passport, driving licence, sort code.
  - **US** — SSN, ITIN, EIN, Medicare MBI, ABA routing, bank account, passport,
    ZIP.
  - **Global** — credit card, IBAN (+ per-country length), IMEI, VIN, BTC/ETH
    wallets, and leaked secrets (AWS / GitHub / Stripe / Google / Slack / OpenAI
    keys, JWTs, PEM private keys).
- New `PiiCategory` buckets (`taxId`, `healthId`, `passport`, `driverLicense`,
  `postalCode`, `bankAccount`, `crypto`, `deviceId`, `vehicleId`, `secret`) and a
  `Region` axis; `detect`/`redact` gain `regions` and `detectorIds` options.
  Spans carry a `subtype` so output is specific (`[PESEL]`, `[NHS]`).
- Precision contract: the validator (checksum) is the primary lever; bare-numeric
  / no-checksum identifiers are context-keyword-gated; weighted-mod validators
  reject the degenerate all-zeros run.

**Desktop app:**

- A **Markets** selector (PL/UK/US; global always on) so a market's ID formats
  can be scoped without false positives from the others.
- The on-device NER model is swapped from English-only `Xenova/bert-base-NER` to
  multilingual `tjruesch/xlm-roberta-base-ner-hrl-onnx`, so names are detected in
  Polish and other languages (download ~110 MB → ~300 MB). The span aggregator
  was made robust to SentencePiece sub-words so agglutinated names (e.g. Polish
  surnames) are recovered rather than leaked.
- Redaction-mode hints now state honestly that only `label` approaches true
  anonymisation, while `pseudonym`/`hash` are pseudonymisation (still personal
  data under GDPR).
