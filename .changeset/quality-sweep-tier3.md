---
"@moxxy/sdk": patch
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Quality sweep, wave 4 (Tier-3 safe subset — coverage + mechanical cleanup)

Largely additive and behavior-preserving (every behavioral change is tested):

- **Test coverage** for previously under-tested critical subsystems: core surface
  host multiplexer, runner surface RPC + `surface.data` broadcast, desktop-host
  git porcelain/diff + provider-discovery + prefs + onboarding + surface relay,
  config loader, skill-draft fence extraction, and more.
- **Real bugs found while adding coverage:** desktop-host git `-z` rename parsing
  emitted a phantom `ChangedFile`; untracked-file diff used a hardcoded POSIX
  `/dev/null` (now `os.devNull`); `fetchProviderModels` could hang (now a 15s
  `AbortSignal.timeout`).
- **Mechanical cleanup:** removed proven-dead exports/params, tightened weak
  types (dropped `as never` / unchecked double-casts, exhaustive switches),
  consolidated duplicated `<NAME>_API_KEY` slug + config up-walk helpers.

Risky/voluminous Tier-3 (god-file decomposition, the long-tail review/test-gap/
consistency/perf clusters) remains tracked in `TECH_DEBT.md` as the standing
journal.
