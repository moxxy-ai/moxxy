---
name: computer-app-video-editors
description: How to edit video in DaVinci Resolve, Premiere Pro and Final Cut Pro through Computer Use.
triggers:
  - "in davinci resolve"
  - "in premiere"
  - "in final cut"
  - "edit the video"
  - "on the timeline"
apps:
  - com.blackmagic-design.DaVinciResolve
  - com.blackmagic-design.DaVinciResolveLite
  - com.apple.FinalCut
  - com.adobe.PremierePro
  - DaVinci Resolve
  - Final Cut Pro
  - Adobe Premiere Pro
---

The timeline and viewer are drawn surfaces with few or no elements: work from
the screenshot there, and from elements for menus, bins and inspectors.

- Prefer shortcuts over the mouse; they do not depend on zoom or track height.
  Play/stop `space`; one frame `Left` / `Right`; start/end `Home` / `End`;
  in/out `i` / `o`; undo `super+z`. Blade at the playhead: `super+b` (Resolve,
  Final Cut), `super+k` (Premiere). Ripple delete: `shift+BackSpace` (Resolve),
  `shift+Delete` (Premiere), `BackSpace` (Final Cut, magnetic timeline).
- Move the playhead by typing a timecode into the timecode field rather than by
  dragging the ruler.
- To trim or move a clip with the mouse, use `computer_drag` with a path and a
  `duration_ms` of 400 or more, or `computer_mouse` down / move / up for
  press-and-hold; a fast drag is read as a click. Use `computer_zoom` on the
  clip edge first, and zoom the timeline in so the edge is wider than a few
  pixels.
- Snapping changes where a clip lands: check its start timecode after the move.
- Resolve works in pages (Media, Cut, Edit, Fusion, Color, Fairlight, Deliver):
  confirm the page before acting. Export on Deliver: set the format, "Add to
  Render Queue", then "Render All", and wait for the job to finish.
- After every edit, read the timeline duration or clip timecode to verify it;
  the picture alone does not prove a cut.
