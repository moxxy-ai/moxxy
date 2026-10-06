---
name: computer-app-blender
description: How to model in Blender through Computer Use.
triggers:
  - "in blender"
  - "w blenderze"
apps:
  - org.blenderfoundation.blender
  - Blender
---

Blender draws its whole window itself: there are no elements, so everything
goes by the screenshot and the keyboard. Prefer the keyboard.

- Keys go to the editor that was clicked last. Click an empty spot of the 3D
  viewport once before the first shortcut.
- Run a command by its name instead of through the menus: press `F3`, type the
  name with `computer_type_text` (`Torus`, `Shade Smooth`, `Subdivision
  Surface`), press `Return`. The header labels (View, Select, Add, Object) are
  small and close together, and a click easily opens the neighbour; if that
  happens press `Escape` and use `F3`.
- Add an object: `F3` and its name (`Torus` for a donut, `UV Sphere`, `Cube`),
  or `shift+a` for the Add menu. It appears at the 3D cursor, selected.
- Delete the selection: `x`, then `Return`. Select everything: `a`. Undo:
  `super+z`.
- Move `g`, rotate `r`, scale `s`; then an axis letter (`x`, `y`, `z`), a
  number and `Return`. `Tab` switches Object and Edit Mode.
- Verify in the Outliner (the list at the top right) that the object is there
  under its name, and in the viewport that it looks right.
