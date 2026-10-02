---
'@moxxy/cli': patch
---

Computer Use screenshots on macOS now show a window exactly where clicks land. Apps whose window surface is larger than its frame (CapCut and other Qt apps) used to be captured about 1% off, so points read from the picture missed small targets such as a clip edge. A window the system briefly leaves out of its list is looked up again instead of failing the screenshot or the zoom.
