---
'@moxxy/cli': patch
---

Computer Use (macOS helper): click, scroll, drag and step-by-step mouse gestures by screenshot point, with safety checks before any real input. A point must lie inside the latest screenshot, the window must not have moved since, and the pixels around the point must still look as the model saw them; the app comes forward only when the user is not typing, and the point must land on that app, never on the desktop, the Dock, Moxxy itself or another app's window. A control under the point is pressed through accessibility in the background; typing and pasting at a point go to the text field there. Scrolling tries the element's page action and its scroll bar before the wheel. The user's pointer goes back where it was after every gesture, and a button the model left pressed is released when the helper stops.
