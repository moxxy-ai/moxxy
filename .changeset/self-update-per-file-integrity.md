---
'@moxxy/desktop-host': patch
---

Self-update now verifies the bytes it executes (audit A2): the signed manifest
carries a per-file sha256 map, checked against the extracted tree at stage time
and re-checked by the bootstrap gate on every load (new `file-tampered` reject
reason). Legacy manifests without the map keep loading but get no load-time
verification; stripping the map from a new manifest breaks its signature.
