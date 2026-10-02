---
'@moxxy/cli': patch
---

The Computer Use live view on Windows no longer stays empty when the window stands still and the video encoder holds back the first picture: the picture is encoded again until it comes out, and single pictures are sent when the encoder never answers.
