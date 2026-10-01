---
name: computer-app-video-editors
description: How to edit video in DaVinci Resolve, Premiere Pro, Final Cut Pro and CapCut through Computer Use.
triggers:
  - "in davinci resolve"
  - "in premiere"
  - "in final cut"
  - "in capcut"
  - "edit the video"
  - "on the timeline"
apps:
  - com.blackmagic-design.DaVinciResolve
  - com.blackmagic-design.DaVinciResolveLite
  - com.apple.FinalCut
  - com.adobe.PremierePro
  - com.lemon.lvoverseas
  - DaVinci Resolve
  - Final Cut Pro
  - Adobe Premiere Pro
  - CapCut
---

The timeline and viewer are drawn surfaces with few or no elements: work from
the screenshot there, and from elements for menus, bins and inspectors.

- Prefer shortcuts over the mouse. Play/stop `space`; one frame `Left` /
  `Right`; start/end `Home` / `End`; in/out `i` / `o`; undo `super+z`. Blade at
  the playhead: `super+b` (Resolve, Final Cut, CapCut), `super+k` (Premiere).
  Ripple delete: `shift+BackSpace` (Resolve), `shift+Delete` (Premiere),
  `BackSpace` (Final Cut).
- Move the playhead by typing a timecode into the timecode field, not by
  dragging the ruler.
- `computer_drag` trims or moves a clip, and the grab point decides: two or
  three pixels inside the clip's edge trims, anywhere else moves the clip.
  Read the edge's exact pixel with `computer_zoom` first. If the clip moved
  instead of getting shorter, undo and grab closer to the edge.
- Snapping changes where a clip lands: check its start timecode after a move.
- Resolve works in pages (Media, Cut, Edit, Fusion, Color, Fairlight, Deliver):
  confirm the page before acting. Export on Deliver: set the format, "Add to
  Render Queue", "Render All", then wait for the job.
- CapCut: the clip's length is written on the clip and the total next to the
  play button; Import is in the media panel and Export at the top right.
- After every edit, read the timeline duration or clip timecode to verify it;
  the picture alone does not prove a cut.
