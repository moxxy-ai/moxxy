---
"@moxxy/desktop": minor
"@moxxy/design-tokens": minor
"@moxxy/desktop-ui": minor
---

Redesign the desktop UI to a z.ai-style aesthetic.

- **Design tokens:** neutral off-white/grey palette with near-black text (pink
  kept as a sparing accent), a serif display font, an `ink` action color, and a
  re-tuned dark theme. All chrome reskins from the token change.
- **Shell:** the sidebar collapses to a narrow icon rail (instead of hiding), a
  Chat/Agent toggle drives the session mode, the model selector moves to the top
  bar (with Share/API), and the profile row gains an avatar + settings gear.
- **Chat:** a centered serif empty state ("What can I build for you?") with an
  inline composer, suggestion chips, and starter cards; grey user bubbles and
  full-width assistant prose; a collapsible Thinking/Thought-Process block with a
  Skip button; a circular send button; a centered reading column.
- **Embedded panel:** now a plugin-extensible host driven by a renderer-side
  surface registry (closed, audited set) with a syntax-highlighted code pane +
  code/preview toggle, a sandboxed HTML preview, generic web/text renderers for
  plugin-contributed surfaces, contextual header actions including pane→agent
  ("Ask agent about this file"), and auto-reveal of the file pane on Write/Edit.
- New `highlight.js`-based syntax highlighting (theme-aware) for chat code fences
  and the file pane.
