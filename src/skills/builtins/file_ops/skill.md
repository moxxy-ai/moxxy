# file_ops

Read, write, patch, remove, and navigate files. Use this instead of host_shell for file manipulation.

**Read a file:**
`<invoke name="file_ops">["read", "/path/to/file"]</invoke>`

**Read specific lines (e.g. lines 10-20):**
`<invoke name="file_ops">["read", "/path/to/file", "10", "20"]</invoke>`

**Write a file (creates parent dirs):**
`<invoke name="file_ops">["write", "/path/to/file", "file content here"]</invoke>`

**Patch a file (find and replace first occurrence):**
`<invoke name="file_ops">["patch", "/path/to/file", "old text", "new text"]</invoke>`

**Append to a file:**
`<invoke name="file_ops">["append", "/path/to/file", "content to append"]</invoke>`

**Remove a file or directory:**
`<invoke name="file_ops">["remove", "/path/to/file_or_dir"]</invoke>`

**List directory:**
`<invoke name="file_ops">["ls", "/path/to/dir"]</invoke>`

**Create directory:**
`<invoke name="file_ops">["mkdir", "/path/to/new/dir"]</invoke>`

**Tree view (default depth 3):**
`<invoke name="file_ops">["tree", "/path/to/dir", "2"]</invoke>`
