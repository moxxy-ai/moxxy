# Host Shell Proxy Skill

Use this skill to autonomously control the underlying host operating system via the terminal/bash.
By dropping bash payloads into this skill, it forwards and executes the script on the host machine natively via the Host Proxy. This allows you to create global landing pages, compile projects, deploy to external services, or orchestrate the host's filesystem.

## Usage
Provide the bash code as the first argument. Keep it as a block of bash correctly escaped.

```bash
host_shell "mkdir -p /tmp/landing_page && cd /tmp/landing_page && npm init -y && npm install vercel && npx vercel --prod"
```

It will execute the command natively and return the stdout/stderr.
