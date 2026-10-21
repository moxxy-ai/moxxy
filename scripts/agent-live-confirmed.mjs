#!/usr/bin/env node
/**
 * CI: fails a PR into development until its author ticks the PR template's
 * "I ran `pnpm test:agents:live`" box. The body comes in PR_BODY (an env var,
 * never interpolated into the shell). A warning, not a lock: the check is not
 * required by branch protection, so Merge stays possible.
 */
import { appendFileSync } from 'node:fs';
import { liveCheckBox } from './agent-checks.mjs';

const MESSAGES = {
  checked: 'The live check of the agent connections is confirmed in the PR description.',
  unchecked:
    'Run `pnpm test:agents:live` on this PR\'s latest commit, then tick its box in the PR description. This check turns green a few seconds later.',
  missing:
    'The PR description has no "I ran `pnpm test:agents:live`" box. Copy it from .github/pull_request_template.md, run the live check, then tick it.',
};

const state = liveCheckBox(process.env.PR_BODY);
const message = MESSAGES[state];
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
if (state === 'checked') {
  console.log(message);
} else {
  console.log(`::error title=Live check not confirmed::${message}`);
  process.exitCode = 1;
}
