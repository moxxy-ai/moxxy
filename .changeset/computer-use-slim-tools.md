---
'@moxxy/cli': minor
---

Computer Use now gives the model 12 tools with only the fields each one needs. `computer_paste`, `computer_select_text`, `computer_mouse`, `computer_hold_key`, `computer_batch`, `computer_screenshot` and `computer_wait` are removed, `computer_drag` takes a start and an end point, and `computer_get_app_state` always returns the window image. Permission rules and allow-lists that name a removed tool need updating.
