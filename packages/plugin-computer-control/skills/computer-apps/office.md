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

- Long or formatted text: `computer_paste` (text, markdown or html) instead of
  typing; it restores the clipboard afterwards.
- Spreadsheets: go to a cell through the name box or `ctrl+g` / `F5`, type the
  value and press `Return` or `Tab`. Read the result back from the formula bar
  element, not from the screenshot.
- Enter several cells with one `computer_batch` (type, `Tab`, type, `Return`).
- Menus are elements; open one with a click on its index, or run the command by
  its shortcut. Ribbon groups can collapse: observe again after resizing.
- A start screen, a template picker or an "update available" sheet blocks the
  document: deal with it first, then observe again.
- Save with `super+s`; a first save opens a dialog where the name field is the
  focused element.
