---
'@moxxy/desktop': minor
'@moxxy/cli': patch
---

The desktop installer now carries Python and Node, so the agent can run the scripts it writes on a computer that has neither. Python comes with pip and the packages common tasks need (requests, numpy, pandas, matplotlib, openpyxl, python-docx, pypdf, pillow, beautifulsoup4, lxml, pyyaml); Node comes with npm and npx. Both are unpacked to `~/.moxxy/runtimes` on first launch, with no download, and the bundled Python is the one `python`, `python3` and `pip` mean inside Moxxy on Windows and macOS alike. The step that used to download Node during setup no longer appears.
