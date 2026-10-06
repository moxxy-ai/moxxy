---
name: computer-app-office
description: How to work with office suites (Word, Excel, PowerPoint, Pages, Numbers, Keynote, LibreOffice) through Computer Use.
triggers:
  - "in excel"
  - "in word"
  - "in numbers"
  - "in keynote"
  - "in powerpoint"
apps:
  - com.microsoft.Word
  - com.microsoft.Excel
  - com.microsoft.Powerpoint
  - com.apple.iWork.Pages
  - com.apple.iWork.Numbers
  - com.apple.iWork.Keynote
  - org.libreoffice.script
  - Microsoft Word
  - Microsoft Excel
  - Microsoft PowerPoint
  - Pages
  - Numbers
  - Keynote
  - LibreOffice
---

If the task is only about the file's content, prefer a file tool or a script on
the document; use the app when the user wants to see it done, or the feature
exists only in the app.

- Long text: `computer_type_text` into the text element inserts it at once;
  it does not use the clipboard.
- Spreadsheets: go to a cell through the name box or `ctrl+g` / `F5`, type the
  value and press `Return` or `Tab`. `Return` already moves one cell down and
  `Tab` one cell right, so do not add an arrow key after them. A cell that is
  not a text element takes text after a click on it: click the cell, then
  `computer_type_text` with no `element_index`. When done, select each cell you filled
  and read it back from the formula bar element, not from the screenshot.
- A formula opens an editor over the cell: commit it with `Return`. Its close
  (X) button discards the formula. A sum you did not read back is not done.
- Menus are elements; open one with a click on its index, or run the command by
  its shortcut. Ribbon groups can collapse: observe again after resizing.
- A start screen, a template picker or an "update available" sheet blocks the
  document: deal with it first, then observe again.
- Save with `super+s`; a first save opens a dialog where the name field is the
  focused element.
