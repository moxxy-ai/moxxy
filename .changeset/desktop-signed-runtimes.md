---
'@moxxy/desktop': patch
---

The macOS installer is notarized again. Since it carries Python and Git for the agent, Apple refused it: the notary service also reads the programs inside the runtime archives, and 288 of them were unsigned. A signed release now signs the macOS Python and Git with the Developer ID before packing them, and checks every signature before the installer is built, so a missing one fails in a minute instead of after the upload to Apple. The bundled Python keeps loading packages installed later with `pip`.
