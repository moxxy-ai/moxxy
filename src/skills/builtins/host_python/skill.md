# Host Python Proxy Skill

Use this skill to execute Python code natively on the underlying host operating system.
The code is forwarded to the Host Proxy which runs it via `python3` on the host machine. This allows you to perform data processing, file manipulation, API calls, web scraping, and any other task that Python excels at.

## Usage
Provide the Python code as the first argument. Keep it as a single string block.

```bash
host_python "import json; data = {'key': 'value'}; print(json.dumps(data, indent=2))"
```

For multi-line scripts, use semicolons or newlines within the string:

```bash
host_python "
import os
files = os.listdir('.')
for f in files:
    print(f)
"
```

It will execute the code natively and return the stdout/stderr.
