# Prompt Scenarios

Real-world examples of what happens when you give Moxxy a task. Each scenario shows the user prompt, the agent execution graph (which primitives fire and in what order), and the end result.

---

## 1. "Get me fresh tech news every Friday morning"

**What happens:** The agent creates a heartbeat schedule, then on each trigger it fetches news, summarizes findings, and notifies you.

### Setup Run (one-time)

```
You: Get me fresh tech news every Friday morning at 9am and send a summary to my Slack
```

```
Agent Execution Graph:

[run.started]
  |
  +-- LLM decides: set up recurring schedule + webhook
  |
  +-- heartbeat.create
  |     action_type: "execute_skill"
  |     action_payload: "Fetch this week's top tech news, summarize the 5 most
  |                      important stories, and send the digest to Slack"
  |     cron_expr: "0 0 9 * * FRI"
  |     timezone: "America/New_York"
  |     => { id: "hb-001", next_run_at: "2026-03-06T14:00:00Z" }
  |
  +-- webhook.create
  |     url: "https://hooks.slack.com/services/T.../B.../xxx"
  |     label: "Friday Tech Digest"
  |     => { id: "wh-001" }
  |
  +-- memory.append
  |     content: "Configured weekly tech digest: Fridays 9am ET -> Slack #news"
  |     tags: ["setup", "digest", "slack"]
  |
  +-- message.final
  |     "Done! Every Friday at 9am ET I'll fetch the latest tech news,
  |      pick the top 5 stories, and post a digest to your Slack channel."
  |
[run.completed]
```

### Recurring Run (every Friday at 9am)

```
Heartbeat fires -> new run with task "Fetch this week's top tech news..."

[run.started]
  |
  +-- browse.fetch
  |     url: "https://news.ycombinator.com"
  |     selector: ".titleline > a"
  |     => { selected_text: "Show HN: ..., Apple releases..., ..." }
  |
  +-- browse.fetch
  |     url: "https://techcrunch.com"
  |     selector: "h2.post-block__title a"
  |     => { selected_text: "AI Startup raises..., New chip..." }
  |
  +-- browse.fetch
  |     url: "https://arstechnica.com"
  |     selector: "h2 a"
  |     => { selected_text: "Linux kernel 7.0..., Quantum..." }
  |
  +-- memory.append
  |     content: "<raw headlines + links>"
  |     tags: ["tech-news", "2026-03-06"]
  |
  +-- notify.webhook
  |     url: "https://hooks.slack.com/services/..."
  |     payload:
  |       text: "*Friday Tech Digest - Mar 6, 2026*\n
  |              1. Linux kernel 7.0 released with...\n
  |              2. Apple announces new M5 chip...\n
  |              3. AI startup raises $200M for...\n
  |              4. Quantum error correction breakthrough...\n
  |              5. Show HN: Open-source alternative to..."
  |
[run.completed]
```

**Primitives used:** `heartbeat.create`, `webhook.create`, `browse.fetch`, `memory.append`, `notify.webhook`

**Skills needed:** [web-researcher](../../examples/skills/web-researcher.md) + [webhook-notifier](../../examples/skills/webhook-notifier.md)

---

## 2. "Scaffold a Vite + React app for a recipe manager"

**What happens:** The agent creates the full project structure, writes config files and initial components, initializes git, and commits.

```
You: Build me a Vite React app for managing recipes. I want to browse,
     add, and search recipes with a clean UI. Use TypeScript and Tailwind.
```

```
Agent Execution Graph:

[run.started]
  |
  +-- shell.exec
  |     command: "ls"
  |     args: ["-la"]
  |     => (checks workspace is empty/ready)
  |
  +-- fs.write  (x12, in sequence - LLM decides structure first)
  |     "package.json"           -> Vite + React + TS + Tailwind deps
  |     "tsconfig.json"          -> strict TS config
  |     "vite.config.ts"         -> Vite config with React plugin
  |     "tailwind.config.js"     -> Tailwind content paths
  |     "postcss.config.js"      -> PostCSS with Tailwind/autoprefixer
  |     "index.html"             -> Entry HTML with root div
  |     "src/main.tsx"           -> React entry point
  |     "src/App.tsx"            -> Router with 3 pages
  |     "src/pages/Browse.tsx"   -> Recipe grid with search bar
  |     "src/pages/AddRecipe.tsx"-> Form with title, ingredients, steps
  |     "src/pages/Recipe.tsx"   -> Single recipe detail view
  |     "src/types.ts"           -> Recipe interface definition
  |
  +-- git.init
  |     => { initialized: true }
  |
  +-- fs.write
  |     ".gitignore"             -> node_modules, dist, .env
  |
  +-- git.commit
  |     message: "feat: scaffold Vite + React + TS recipe manager"
  |     => { hash: "a1b2c3d" }
  |
  +-- memory.append
  |     content: "Created recipe-manager project. Stack: Vite, React 19,
  |               TypeScript, Tailwind CSS. Pages: Browse, Add, Detail."
  |     tags: ["project-setup", "recipe-manager"]
  |
  +-- message.final
  |     "Your recipe manager is ready! I've created:
  |      - Vite + React 19 + TypeScript project
  |      - Tailwind CSS for styling
  |      - 3 pages: Browse (with search), Add Recipe, Recipe Detail
  |      - Type definitions for Recipe model
  |      - Git initialized with first commit
  |
  |      Run `npm install && npm run dev` to start."
  |
[run.completed]
```

**Primitives used:** `shell.exec`, `fs.write` (x13), `git.init`, `git.commit`, `memory.append`

---

## 3. "Monitor my API endpoint and alert me if it goes down"

**What happens:** The agent sets up a recurring health check that pings your endpoint and sends alerts on failure.

```
You: Check https://api.myapp.com/health every 5 minutes.
     If it returns anything other than 200, send an alert to my Discord.
```

```
Agent Execution Graph (setup):

[run.started]
  |
  +-- webhook.create
  |     url: "https://discord.com/api/webhooks/123/abc"
  |     label: "API Health Alerts"
  |     => { id: "wh-health" }
  |
  +-- heartbeat.create
  |     action_type: "execute_skill"
  |     action_payload: "Check https://api.myapp.com/health — if status != 200,
  |                      send alert to Discord webhook wh-health with the status
  |                      code and response body. If healthy, log to memory silently."
  |     interval_minutes: 5
  |     => { id: "hb-monitor", next_run_at: "+5m" }
  |
  +-- message.final
  |     "Health monitor active. I'll check api.myapp.com/health every 5 minutes.
  |      If it goes down, you'll get a Discord alert immediately."
  |
[run.completed]
```

```
Recurring check (every 5 min):

[run.started]
  |
  +-- http.request
  |     method: "GET"
  |     url: "https://api.myapp.com/health"
  |     => { status: 503, body: "Service Unavailable" }
  |
  +-- (LLM sees non-200, decides to alert)
  |
  +-- notify.webhook
  |     url: "https://discord.com/api/webhooks/123/abc"
  |     payload:
  |       content: "**API DOWN** api.myapp.com/health returned 503
  |                 at 2026-03-02 15:30 UTC\nResponse: Service Unavailable"
  |
  +-- memory.append
  |     content: "ALERT: api.myapp.com returned 503 at 15:30 UTC"
  |     tags: ["monitor", "incident", "api.myapp.com"]
  |
[run.completed]
```

**Primitives used:** `webhook.create`, `heartbeat.create`, `http.request`, `notify.webhook`, `memory.append`

---

## 4. "Review the auth module and open a PR with fixes"

**What happens:** The agent reads code, identifies issues, writes fixes, and opens a pull request — all in one run.

```
You: Review src/auth/ for security issues. Fix anything you find
     and open a PR against main.
```

```
Agent Execution Graph:

[run.started]
  |
  +-- fs.list
  |     path: "src/auth/"
  |     => ["middleware.ts", "jwt.ts", "session.ts", "index.ts"]
  |
  +-- fs.read  (x4, parallel in LLM's mind — sequential primitive calls)
  |     "src/auth/middleware.ts"  -> reads auth middleware
  |     "src/auth/jwt.ts"        -> reads JWT handling
  |     "src/auth/session.ts"    -> reads session management
  |     "src/auth/index.ts"      -> reads exports
  |
  +-- shell.exec
  |     command: "grep"
  |     args: ["-rn", "TODO\\|FIXME\\|HACK", "src/auth/"]
  |     => (finds 2 TODOs)
  |
  +-- (LLM analyzes code, finds 3 issues:
  |     1. JWT expiry not validated
  |     2. Session token stored in localStorage (XSS risk)
  |     3. Missing rate limit on login endpoint)
  |
  +-- git.checkout
  |     branch: "fix/auth-security-review"
  |     create: true
  |     => { checked_out: true }
  |
  +-- fs.write  (x3 — targeted fixes)
  |     "src/auth/jwt.ts"        -> adds expiry check in verify()
  |     "src/auth/session.ts"    -> switches to httpOnly cookie
  |     "src/auth/middleware.ts"  -> adds rate limit guard
  |
  +-- git.status
  |     => { clean: false, files: ["jwt.ts", "session.ts", "middleware.ts"] }
  |
  +-- git.commit
  |     message: "fix(auth): validate JWT expiry, use httpOnly cookies, add rate limiting"
  |     => { hash: "f4e5d6" }
  |
  +-- git.push
  |     remote: "origin"
  |     branch: "fix/auth-security-review"
  |     => (vault resolves github-token, pushes)
  |
  +-- git.pr_create
  |     title: "fix(auth): address 3 security issues"
  |     body: "## Security Review Fixes\n\n
  |            1. **JWT expiry** — `verify()` now rejects expired tokens\n
  |            2. **Session storage** — moved from localStorage to httpOnly cookie\n
  |            3. **Rate limiting** — login endpoint now limited to 5 req/min\n\n
  |            Found during automated code review."
  |     head: "fix/auth-security-review"
  |     base: "main"
  |     => { pr_url: "https://github.com/user/repo/pull/42", number: 42 }
  |
  +-- memory.append
  |     content: "Auth review: fixed JWT expiry, session XSS, rate limiting.
  |               PR #42 opened."
  |     tags: ["code-review", "security", "auth"]
  |
  +-- message.final
  |     "Done! I found and fixed 3 security issues in src/auth/:
  |
  |      1. JWT tokens weren't checking expiry — added validation
  |      2. Session token in localStorage was XSS-vulnerable — moved to httpOnly cookie
  |      3. Login had no rate limit — added 5 req/min guard
  |
  |      PR: https://github.com/user/repo/pull/42"
  |
[run.completed]
```

**Primitives used:** `fs.list`, `fs.read` (x4), `shell.exec`, `git.checkout`, `fs.write` (x3), `git.status`, `git.commit`, `git.push`, `git.pr_create`, `memory.append`

**Vault grant needed:** `github-token` for push + PR

---

## 5. "Research competitors and build a comparison spreadsheet"

**What happens:** The agent browses multiple websites, extracts product info, synthesizes into structured data, and saves as CSV.

```
You: Research the top 5 project management tools (Linear, Asana, Jira,
     Monday, Shortcut). Compare their pricing, key features, and integrations.
     Save as a CSV I can open in Sheets.
```

```
Agent Execution Graph:

[run.started]
  |
  +-- browse.fetch  (x5 — one per competitor)
  |     "https://linear.app/pricing"        selector: ".pricing-card"
  |     "https://asana.com/pricing"         selector: ".pricing-tier"
  |     "https://www.atlassian.com/..."     selector: ".pricing-table"
  |     "https://monday.com/pricing"        selector: ".pricing-plan"
  |     "https://shortcut.com/pricing"      selector: ".plan-card"
  |     => (extracts pricing tiers, feature lists)
  |
  +-- browse.fetch  (x5 — feature/integration pages)
  |     "https://linear.app/features"
  |     "https://asana.com/features"
  |     ... etc
  |     => (extracts key features, integration lists)
  |
  +-- memory.append
  |     content: "<raw research data for all 5 tools>"
  |     tags: ["research", "competitors", "project-management"]
  |
  +-- (LLM synthesizes all data into structured comparison)
  |
  +-- fs.write
  |     path: "competitor-analysis.csv"
  |     content:
  |       "Tool,Free Tier,Pro Price,Enterprise,Key Features,Integrations\n
  |        Linear,Yes (250 issues),$8/user/mo,Custom,Cycles/Roadmaps/Triage,...\n
  |        Asana,Yes (15 users),$10.99/user/mo,$24.99/user/mo,Timeline/Portfolios,...\n
  |        ..."
  |
  +-- message.final
  |     "Saved competitor-analysis.csv with pricing and features for all 5 tools.
  |
  |      Quick summary:
  |      - Best free tier: Asana (15 users)
  |      - Cheapest pro: Linear ($8/user)
  |      - Most integrations: Jira (3000+)
  |      - Best for small teams: Shortcut
  |      - Most enterprise features: Monday"
  |
[run.completed]
```

**Primitives used:** `browse.fetch` (x10), `memory.append`, `fs.write`

---

## 6. "Fork this repo, add tests, and send a PR upstream"

**What happens:** The agent forks an open-source repo, clones it, reads the code, writes tests, and opens a PR to the original repo.

```
You: Fork github.com/someuser/fast-json-parser, add unit tests
     for the parse() function, and open a PR.
```

```
Agent Execution Graph:

[run.started]
  |
  +-- git.fork
  |     repo: "someuser/fast-json-parser"
  |     => { forked: true, fork_url: "https://github.com/myuser/fast-json-parser" }
  |
  +-- git.clone
  |     url: "https://github.com/myuser/fast-json-parser.git"
  |     => { cloned: true, commit_hash: "abc123", branch: "main" }
  |
  +-- fs.list
  |     path: "."
  |     => ["src/", "package.json", "README.md", "tsconfig.json"]
  |
  +-- fs.read
  |     path: "src/parser.ts"
  |     => (reads the parse() function implementation)
  |
  +-- fs.read
  |     path: "package.json"
  |     => (checks existing test framework — vitest)
  |
  +-- git.checkout
  |     branch: "add-parser-tests"
  |     create: true
  |
  +-- fs.write
  |     path: "src/parser.test.ts"
  |     content: (comprehensive test suite: valid JSON, edge cases,
  |               error handling, nested objects, arrays, unicode)
  |
  +-- git.commit
  |     message: "test: add comprehensive unit tests for parse()"
  |
  +-- git.push
  |     remote: "origin"
  |     branch: "add-parser-tests"
  |
  +-- git.pr_create
  |     title: "test: add unit tests for parse()"
  |     body: "Adds 12 test cases covering:\n- Valid JSON parsing\n
  |            - Nested objects/arrays\n- Edge cases (empty, whitespace)\n
  |            - Error handling (malformed input)\n- Unicode strings"
  |     head: "myuser:add-parser-tests"
  |     base: "main"
  |     => { pr_url: "https://github.com/someuser/fast-json-parser/pull/7" }
  |
  +-- message.final
  |     "PR opened: https://github.com/someuser/fast-json-parser/pull/7
  |      Added 12 test cases for parse() covering happy paths and edge cases."
  |
[run.completed]
```

**Primitives used:** `git.fork`, `git.clone`, `fs.list`, `fs.read` (x2), `git.checkout`, `fs.write`, `git.commit`, `git.push`, `git.pr_create`

---

## 7. "Compact my agent's memory and show me a weekly summary"

**What happens:** The agent triggers memory compaction, then reads the archive and synthesizes a summary.

```
You: Clean up old memory entries and give me a summary of what
     I've been working on this week.
```

```
Agent Execution Graph:

[run.started]
  |
  +-- memory.search
  |     query: "2026-03"
  |     => { results: [14 entries from this week] }
  |
  +-- memory.summarize
  |     => { summary: "This week: 3 code reviews (auth, payments, API),
  |                     2 project scaffolds (recipe-app, blog),
  |                     1 competitor research (PM tools),
  |                     5 monitoring alerts (2 resolved)" }
  |
  +-- heartbeat.create
  |     action_type: "memory_compact"
  |     interval_minutes: 10080  (weekly)
  |     => { id: "hb-compact" }
  |
  +-- message.final
  |     "Here's your week in review:
  |
  |      **Code Reviews** (3)
  |      - Auth module security fixes -> PR #42
  |      - Payments refactor -> PR #38
  |      - API validation improvements -> PR #45
  |
  |      **Projects Created** (2)
  |      - Recipe Manager (Vite + React + TS)
  |      - Blog Platform (Next.js + MDX)
  |
  |      **Research** (1)
  |      - PM tool comparison: Linear vs Asana vs Jira vs Monday vs Shortcut
  |
  |      **Monitoring** (5 alerts, 2 incidents resolved)
  |      - api.myapp.com had 2 outages (503s), both recovered within 10 min
  |
  |      I've also set up weekly memory compaction so old entries
  |      get archived automatically."
  |
[run.completed]
```

**Primitives used:** `memory.search`, `memory.summarize`, `heartbeat.create`

---

## Execution Model Summary

Every prompt follows the same graph pattern:

```
User prompt
  -> POST /v1/agents/{id}/runs { task: "..." }
    -> RunExecutor loop (max 10 iterations):
         LLM thinks -> emits tool_calls -> primitives execute -> results fed back
    -> Events stream in real-time via SSE
    -> Final message returned to user
```

The agent decides which primitives to call based on the task. It can chain them across multiple iterations — read files, analyze, write fixes, commit, push, all in a single run.

For recurring tasks, the agent creates **heartbeats** that re-trigger new runs on a schedule (cron or interval). Each triggered run is a fresh execution with its own event stream.

For large tasks, the parent agent can **spawn subagents** that work in parallel, each with their own run and primitive access.
