---
name: computer-app-design-tools
description: How to work in design and image tools (Figma, Photoshop, Illustrator, Sketch, Affinity) through Computer Use.
triggers:
  - "in figma"
  - "in photoshop"
  - "in illustrator"
  - "in sketch"
apps:
  - com.figma.Desktop
  - com.adobe.Photoshop
  - com.adobe.illustrator
  - com.bohemiancoding.sketch3
  - com.seriflabs.affinitydesigner2
  - com.seriflabs.affinityphoto2
  - Figma
  - Adobe Photoshop
  - Adobe Illustrator
  - Sketch
---

The canvas has no elements: work on it from the screenshot. Panels, layers and
menus are elements; use them whenever a value can be typed instead of dragged.

- Set position, size, colour and text through the inspector fields
  (`computer_set_value` or click, type, `Return`), not by dragging handles.
- Select through the layers panel by `element_index`; a click on the canvas can
  hit the wrong layer or start a drag.
- Tools have one-letter shortcuts (`v` move, `t` text, `r` rectangle, `b` brush
  in Photoshop). Press `Escape` first so the key is not typed into a text field.
- Draw or drag with `computer_drag` (a path of points, `duration_ms` 300 or
  more); hold a modifier with its `modifiers` field (`shift` keeps proportions).
- Zoom changes what a pixel means: after zooming or panning the canvas, take a
  fresh state before using coordinates again.
- Verify the result in the inspector values or the layers list, then in the
  picture with `computer_zoom`.
