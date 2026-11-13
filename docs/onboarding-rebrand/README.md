# Onboarding rebrand: plan

Branch: `feat/onboarding-rebrand` (from `development` at `8fe18d98`).

Goal: first run of the desktop app is short and pleasant for a person who has
never programmed. They answer one question, sign in once, and land in a chat.
The look follows `docs/desktop-design.md`; motion follows its Emil Kowalski
rules.

## Who it is for

A person who downloaded Moxxy and does not know what a "provider", "CLI",
"npm", "PATH", "vault", "OAuth" or "SDK" is. They may already pay for Claude or
ChatGPT. They may have nothing and want to try it first.

## What is wrong today

| Screen | Problem |
|---|---|
| Welcome | One click with no decision in it. |
| Install moxxy | Shown on every first run, although the installer carries the CLI (`cli-resolver.ts`, `moxxy-cli` in resources). It says "CLI", "npm", "PATH". |
| Connect a provider | A dropdown of internal names (`claude-code`, `codex-agent`, `opencode`), an `sk-…` field, install rows. The hardest screen, and the only one that matters. |
| Pick a workspace | Optional: the built-in workspace in `~/Moxxy` already exists, and the sidebar can add folders later (`NameWorkspaceModal`). |
| You're all set | One more click with no decision in it. |

Up to six screens; two of them do something.

## Target flow

```
first run:   [Getting ready]? → [Install]? → Start → (Plan sign-in | API key)? → chat
recovery:    whichever prerequisite is missing, as today
```

`?` = shown only when needed. Most people see one or two screens.

### Screen 1: Start (replaces Welcome + provider dropdown)

- The mark (breathing, as the loading mark does), a heading "Hi, I'm Moxxy."
  and one line: "How do you want to start? You can change this later."
- Three rows of one list, the same weight, each a full-width pressable row:
  1. **Use my Claude or ChatGPT plan**, detail "Sign in once. Moxxy uses your plan."
  2. **Start free**, detail "Free model, no account needed." (OpenCode's free model)
  3. a quiet text link under the list: **I have an API key**
- If a coding agent is already installed and signed in on this computer, the
  matching row says so ("Signed in as ana@… · Claude") and one press finishes
  setup. Idea from t3code's provider readiness, reimplemented here.
- "Start free" uses OpenCode's free model. It is installed only when the
  person presses it: Moxxy does not install a program nobody chose, so the
  background download OpenBot does was left out. The "start free or use your
  plan" question is an idea from OpenBot's first run, written from scratch
  (OpenBot is PolyForm Noncommercial: no code, CSS or copy is taken).

### Screen 2a: Your plan (only after row 1)

- Two rows: **Claude** and **ChatGPT**, each with its state in plain words:
  "Ready", "Sign in", "Install (about a minute)", "Installing… 40%".
- One press does the next thing for that row: install, then the browser
  sign-in (`OAuthSignIn`), then activate. No separate Continue button.
- Back returns to Start. "Start free instead" sits at the foot.

### Screen 2b: API key (only after the link)

- The current key form, simplified: provider as readable names
  ("Anthropic", "OpenAI", …), one password field, "Connect".
- The help line says where to get a key, with a link that opens the browser.

### Finish

- When the connection is active, the screen shows a short success state
  (green LED + "Connected") for about 600 ms and opens the chat. No "You're all
  set" screen. `onboardingComplete` is written by the same hook.

### Getting ready / Install (only when something is missing)

- One progress line in plain words ("Getting Moxxy ready… this happens once").
  The raw npm log moves behind "Show details".
- The CLI step applies only when the CLI is missing (like the Node step),
  in both first run and recovery.

### Recovery gate

Unchanged in behaviour: only the missing prerequisite shows and the gate closes
itself. A missing provider shows the Start screen with "Skip for now".

## Look and motion (from `docs/desktop-design.md`)

| Topic | Rule applied here |
|---|---|
| Ground | Keep `.onboard`: one card on the sidebar ground, no sidebar. |
| Accent | Signal orange only, for the one way forward. Rows are neutral; the pressed or chosen row gets the accent ring. |
| Geometry | Rows use `--radius-card`; inputs `--radius-chip`. No new radii. |
| Type | Platform face; heading `--type-display`, row title `--type-ui` 600, detail `--type-row` muted. |
| Step line | "Step n of N" disappears when only one or two screens remain; the step marks stay. |
| Entrance | Existing `.onboard__step` `@starting-style` (opacity + 6px, `--motion-overlay`, `--ease-out`). Rows stagger 40 ms, decorative only, never blocking input. |
| Press | Every row and button scales to 0.97 in `--motion-press`. |
| Hover | Row background shift, behind `@media (hover: hover) and (pointer: fine)`. |
| Exit | Faster than entrance; the finish hands over to the chat without a long fade. |
| Reduced motion | No movement; opacity and colour stay; the mark holds still. |
| Themes | Light and dark designed and checked; contrast tests in design-tokens must pass. |
| Copy | No jargon words listed above. Plain sentences, no em dashes. |

## Code layout (dumb components, logic in hooks)

| Layer | File | Role |
|---|---|---|
| Flow (pure) | `onboarding/flow.ts` | Step list: `node?`, `cli?`, `start`. The plan and key screens are views of `start`, not flow steps: they are branches, not a walk. |
| Domain (pure) | `onboarding/start-options.ts` | Turns agent connection rows into the answers: name, plain detail, state, which plan is ready. |
| Helper | `onboarding/activate-provider.ts` | Makes the runner use the connection, retrying only across a reconnect. |
| Hook | `onboarding/useStartStep.ts` | Which view shows, and the one-press chain: install, update, sign in, activate. |
| Hook | `onboarding/useApiKeyConnect.ts` | The key path (replaces `useProviderConnect`). |
| Hook | `onboarding/useFinishOnboarding.ts` | Writes `onboardingComplete` and enters the app (moved out of `DoneStep`). |
| Primitives | `onboarding/chrome/ChoiceRow.tsx`, `chrome/InstallLog.tsx` | A whole-row answer; install output folded under "Show details". |
| Views | `steps/StartStep.tsx` (wiring), `steps/start/ChooseView.tsx`, `PlanView.tsx`, `ApiKeyView.tsx` | Draw only. |
| Shared | `settings/shared/OAuthSignIn.tsx` | Gains `name` (the name shown) and `autoStart` (the press already asked). |
| Removed | `WelcomeStep`, `WorkspaceStep`, `useWorkspaceStep`, `DoneStep`, `ProviderStep`, `useProviderConnect` (+ tests) | Replaced as above. |

No backend change was needed (see risks).

## Phases (each: Red → Green → Refactor, then a live check)

0. **Baseline.** Run the current onboarding in an isolated Moxxy home (never the
   real `~/.moxxy`), light and dark; screenshots and click count to compare against.
1. **Flow.** Tests on `ONBOARDING_STEPS` with the real `useStepFlow`: CLI step
   only when missing; no welcome/workspace/done on first run; recovery unchanged.
   Verify that an agent connection (Claude Code / Codex / OpenCode free) clears
   `hasProvider` in `probeOnboarding` (today it looks for a vault key).
2. **Start options (domain).** Pure tests for `start-options.ts`: every agent
   state maps to the right words and action; an already signed-in agent is
   recommended.
3. **Hooks.** `useStartStep`, `useFinishOnboarding` with tests through the real
   client-core state; the IPC boundary to the host is the only double, as in the
   existing onboarding tests.
4. **Components.** `ChoiceRow`, `StartStep`, `PlanStep`, `ApiKeyStep`; tests on
   what a person sees and can press (roles, labels, disabled states).
5. **Look and motion.** CSS in the `.onboard` block; `styles.motion.test.ts`
   rules still pass; light/dark screenshots; reduced motion.
6. **Copy pass.** Every string read once with the no-jargon list; a test that
   the onboarding renders none of the banned words.
7. **Docs and release.** Update the first-run paragraph in
   `docs/desktop-design.md` and `docs/getting-started.md`; changeset for
   `@moxxy/desktop`; live check in an isolated app (first run, recovery,
   each of the three paths); `pnpm test:agents:live` before merge.

## Risks and open points

- `hasProvider` requires `<PROVIDER>_API_KEY` in the vault, which an agent
  never writes. Checked: it does not loop. A first run leaves by its own
  finish, and the app's provider gate reads the runner's active provider
  (`shouldShowProviderRecovery`), not this flag.
- OpenCode's free model can change or be rate limited; the Start free row must
  say plainly when it is unavailable and point to the other two.
- Windows: install progress and the sign-in browser detour already reconnect
  (`retryWhileReconnecting`); Windows itself is checked only by CI.
- Removing the workspace step changes `docs/desktop-design.md`, which promises
  it; the doc is updated in the same change.
