---
'@moxxy/cli': minor
---

Apply config permission rules, and add anchored path matchers.

`permissions.allow` and `permissions.deny` were declared in the config schema but never applied: only `permissions.policyPath` was read. The config surface was dead, so there was no way for an operator to push a permission rule at all.

They now form an immutable layer above `~/.moxxy/permissions.json`: checked first, never written back, and not removable by editing that file, by answering "allow always", or by deleting it. From the system scope with `permissions` in `locked:`, that is a rule a user cannot get rid of. Decision order is managed deny, file deny, managed allow, file allow.

Two anchored matchers join the existing unanchored `inputMatches`, whose semantics are unchanged. `inputPathPrefix` compares path segments, so `/srv/app` covers `/srv/app/x` but not `/srv/apple`, and `..` is normalised away before comparison. `inputGlob` anchors the whole value, with `*` staying inside a path segment and `**` crossing. An organisation's policy should prefer them: `{ Read: { path: '/etc' } }` as a regex means "contains /etc anywhere", which over-blocks as a deny and over-grants as an allow.
