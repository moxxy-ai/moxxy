---
'@moxxy/cli': patch
'@moxxy/sdk': patch
'@moxxy/desktop': patch
---

Pick up patched electron 43.7.7, undici, ip-address 10.7.1, brace-expansion, axios 1.20.0 and image-size 2.0.4 (with the metro patch that hands it a buffer). The dependency audit now keeps a reviewed list of advisories that have no upstream fix yet; it holds one entry, node-forge GHSA-86w9-cpqp-85rv, reached only through the Expo CLI's local iOS signing helper, and fails again as soon as a fix is published or the package appears anywhere else.
