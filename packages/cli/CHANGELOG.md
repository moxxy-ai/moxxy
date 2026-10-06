# @moxxy/cli

## 0.42.0

### Minor Changes

- ac81f33: The agent now waits on events instead of sleeping on a clock. `Bash` takes `background: true` to start a long command (a dev server, a watcher, a slow build) as a job and return its id at once; the new `Wait` tool wakes the instant that job finishes or prints output matching `until`, and `StopJob` ends it. Closing a conversation stops its jobs. A collaborative run's coordinator now resumes the moment an agent finishes or its process exits instead of on a 500 ms poll. `Sleep` accepts `ms: 0` next to `seconds` (models sent it and every such first sleep failed). The SDK exports `waitFor` / `wakeAfter` for event-driven waits with a deadline. `moxxy -p` now closes its session on Ctrl+C / SIGTERM before exiting, so neither background jobs nor a running foreground command are left behind as orphans.
- f529046: Desktop browser: with a TypeSafe key and Jev on, `browser_run` carries out a run of steps named in words — each element found from what worked on the site before, by its name, or by Jev, each `expect` checked by Jev — and stops at the first step that does not work, saying why. Jev's engine (client, element grounding, per-app memory) moves from Computer Use into the new `@moxxy/jev` package that both share, and Settings → Jev now covers the Browser too. A press waits for a document still loading and follows an element that moves before the pointer reaches it, so a click right after opening a page no longer lands where the element was before the page's styles applied.
- 313152d: Desktop browser: work on what the accessibility tree cannot name. `browser_capture` without a uid returns a named viewport picture in CSS pixels, and the new `browser_point` clicks, drags, scrolls, presses keys and types at places in it — refused when the page navigated, scrolled or changed at that place since the picture, and answering with a fresh one. The new `browser_upload` gives a page's file field local files (asking every time), including the hidden input behind an "Add attachment" button.
- 8906c4a: Desktop browser: allow a site once instead of approving every action. The new `browser_allow_site` asks for a site for the rest of the conversation; clicks, typing, keys, navigation and the other acting tools no longer prompt per call, and the desktop refuses any of them that would land on a site the conversation has not allowed. Approvals live in the session log, so every client sees the same sites; dialogs and `browser_session` still ask every time, and the terminal UI is unchanged.
- e1341f9: Chat with a channel bot from the desktop: a new "Channels" section in the Runs sidebar opens Channels → <bot> as an ordinary chat attached live to the bot's own runner — write from the channel or from the app into one conversation (replies to app messages are also posted to the channel, falling back to the paired owner's DM). While the bot is down the chat shows its saved history and waits for it; the desktop never starts, stops or wipes a bot's runner (`/new` clears the conversation over the runner protocol). Setup, run mode and model moved behind the page's Setup button. Dedicated channel runners (Discord, Telegram, Slack, …) now resume one sticky session across restarts instead of starting a fresh one each time, and channel bot sessions no longer appear in the workspace tree, where opening one started a second writer on the bot's log.
- ca9a67f: Approving a `computer_run` call on an app that is not granted yet now grants that app for the conversation at its default level, so a task no longer spends a model round on `computer_request_access`. Approvals record whether the call was decided now (`decidedNow`); a standing "always allow" rule grants no new app.
- 711ac74: Computer Use: a remembered step returns the moment the window shows what it showed last time (macOS), and a key pressed for an expected result is remembered too. Five remembered steps in one `computer_run` take about 2.5 s instead of 5.9 s, with no request to Jev.
- c58ac4a: Computer Use on macOS can click, drag and scroll on a canvas or timeline while the app stays in the background: the app in front keeps the focus and the pointer stays with the user. When the window shows no change, when the same gesture is asked for again, for the right and middle buttons, or when the window is not on the current screen, the helper falls back to real input as before. The helper records the route it took (`ax`, `background` or `input`) in its result.
- c68bc61: Computer Use: the model goes from the access request straight to `computer_run` (two fewer tool rounds), an app can be named the way it was asked for, and a lesson is used even when the model words the target differently: Jev confirms all such guesses in one request per run.
- 789cd60: Computer Use: shipped lessons for Finder and Safari. A click in Finder's sidebar now opens the place, Safari's toolbar stays reachable on long pages, long pages are fitted to Jev's input limit instead of failing, toolbar buttons known only by a description are remembered, and a typing step is remembered once a later step of the run was verified.
- f9b6fae: Computer Use: new `computer_run` tool carries out a plan of steps in one call. Jev (TypeSafe) finds each control and checks each result; needs the `TYPESAFE_API_KEY` secret. On macOS an action with its fresh state now takes about 2 s instead of 5–7 s.
- 66633a8: Computer Use works on Linux in X11 sessions. A native helper reads apps through the accessibility bus (AT-SPI) and operates them with the same 12 tools as on macOS and Windows: controls are pressed and text is entered in the background, everything else goes through real input with the pointer given back, Escape stops the turn, and the desktop chat shows a live view of the window. In a Wayland session `computer_status` says that Computer Use is not ready and why. The Linux desktop installer ships the helper.
- 1060794: Computer Use on macOS now has a live picture-in-picture view in the desktop chat. While the agent works in an app, a small view above the composer shows that window at about two frames a second, with the agent's cursor drawn on top. The picture is for the person only: it travels over the surface channel, is never sent to the model, and is never written to the session log. The helper captures only while someone is watching and stops when the turn ends or the user presses Stop. The view can be hidden for one conversation or for all of them, and brought back from the control strip.
- 8483361: Computer Use on macOS now runs on the native helper. The old macOS tools (`computer_type`, `computer_key`, `computer_open`, `computer_clipboard`, `computer_applescript` and the coordinate-only `computer_click` / `computer_screenshot`) are removed; macOS offers the shared tool set instead: `computer_request_access`, `computer_get_app_state`, element and point actions, `computer_batch`, `computer_zoom`, and `computer_status`, which reports missing system permissions and can open the right settings pane. A Mac without a matching helper offers `computer_status` only, with the reason. The model gets short working rules with every request that carries these tools, and notes for an app (browsers, Finder, office suites, video editors, design tools) the first time it looks at that app in a turn. The desktop app ships the universal helper: packaging on macOS builds it, verifies it, and its manifest stays valid after the app is signed.
- dd35216: Computer Use: `computer_run` remembers what worked in each app (on this computer), so a repeated step needs no request to Jev. Without a TypeSafe key the tool is not offered and Computer Use works as before.
- a070317: Computer Use: lessons for `computer_run` now ship with moxxy and are read before the computer's own and before Jev. On macOS a click on a list row selects it through accessibility (also rows scrolled out of view), and an action with its fresh state takes about 1 s.
- c58ac4a: Computer Use now gives the model 12 tools with only the fields each one needs. `computer_paste`, `computer_select_text`, `computer_mouse`, `computer_hold_key`, `computer_batch`, `computer_screenshot` and `computer_wait` are removed, `computer_drag` takes a start and an end point, and `computer_get_app_state` always returns the window image. Permission rules and allow-lists that name a removed tool need updating.
- 73a8f95: The live Computer Use view in the desktop chat is now real video on macOS. The helper encodes the app window as H.264 with the system encoder and the desktop decodes it with WebCodecs, so the view uses about thirty times less data than the JPEG frames it replaces and less CPU in the helper. A viewer that cannot decode video still gets JPEG frames, and so does everyone on Windows. When a viewer joins late or falls behind, it shows nothing new until the next key frame, which it asks for itself.
- a846016: Computer Use on Windows x64 now uses the same tools as macOS. The earlier Windows-only tools (`computer_observe`, `computer_windows`, `computer_open`, `computer_action`, …) are removed: the model asks for access to an app with `computer_request_access`, reads it with `computer_get_app_state` (elements with an index plus a picture of the window) and acts by index or by a point of that picture. The Windows helper speaks protocol 5, shows the agent's own cursor over the target window, puts the user's pointer back after a click, hides apps that were not granted in full-screen pictures, and feeds the live picture-in-picture view in the desktop chat. An installed Computer Use extension from an earlier version is offered an update at startup of the Windows desktop app.
- c58ac4a: The Computer Use live view on Windows is now H.264 video, encoded with the system's Media Foundation encoder, when the viewer can decode it. A system without that encoder keeps sending JPEG frames, and the view shows them.
- c329313: Allow selecting custom model IDs with an explicit or 200,000-token context window.
- bd8473c: Moxxy now requires Node.js 22.19 or newer; Node 24 LTS is the recommended and default version. Node 20 reached end of life in April 2026, and the updated `openai`, `undici`, `officeparser` and `vitest` no longer support it.

  Dependencies are updated in one batch: `@modelcontextprotocol/sdk` 1.31 (fixes a high-severity advisory), `openai` 7, `undici` 8, `officeparser` 8, `vitest` 5 with `@vitest/coverage-v8` 5, plus the non-major group (Anthropic SDK, turbo, typescript-eslint, Expo patch releases and others). Document text extraction drops an option officeparser 8 removed; behavior is unchanged.

  Stopping `moxxy mobile` on macOS and Linux now ends the Expo server too, not only the npm process that started it; before, Expo could keep running in the background and hold port 8081.

- e1341f9: Give the Discord bot its own model. Pick it in Channels → Discord → Model in the desktop, or with `/model` in the chat (`/model <name>`, `/model default`). The choice is channel-scoped, so it never changes the model the app or TUI use, and it applies from the next message without restarting the bot. A saved model whose provider isn't connected falls back to the default with a notice.
- e1341f9: Choose how the Discord bot runs from Channels → Discord → Run mode: Manual (Start/Stop in the panel), With the app (starts when the desktop opens), or Always (a launchd/systemd background service that stays online with the app closed). Switching away from Always stops and removes the service, so nothing keeps running or restarts at login; the panel never starts a second copy of a bot the service already runs. Adds `discord` to `moxxy service` and `moxxy service status <name> --json`.
- 00e2898: `discord_send_message` can attach local files (`files`: up to 10, 10 MB in total — Discord's bot upload cap), so the bot can send you a file you ask for instead of a path. Oversized, missing or non-file paths are refused before anything is sent.
- 788cfda: Add the `discord_send_message` tool so the agent can proactively DM the paired Discord owner about progress, finished work, or blockers from any session (desktop, goal mode, scheduled prompts) without the Discord channel running.
- 6e36940: Discord voice calls: `/call` joins you in a server voice channel (or rings with a DM link), the agent can call you with `discord_call`, and you talk turn by turn — replies are spoken, talking over one stops it, and `/hangup` or leaving the channel ends the call.
- 40b40f4: Add Google Gemini Flash-Lite speech synthesis with configurable cloud voices, interruption-aware sentence playback, and speech cleanup for links and file paths. Settings → Voice now holds everything voice in one place: the Voice Mode engine (Local / GPT-Live) and, for the Local engine, the spoken voice (Gemini Flash-Lite or Local Piper).
- 194abc6: Desktop Voice Mode can now talk through GPT-Live over the existing ChatGPT login (Settings → Voice). GPT-Live holds the conversation itself with the chat as context; when the user explicitly asks for a task, the user's own transcribed words run as an ordinary agent turn and GPT-Live reads back that turn's real result. Conversation it answers itself is recorded into the chat through the new runner method `session.recordExchange` (runner protocol v20). While a task runs, GPT-Live hears the agent's progress and answers status questions itself; the agent works on one task at a time, so a task asked for by voice while it is busy is not started (voice never feeds the chat queue). Nothing is sent to GPT-Live while it is speaking, so its answers are no longer cut off mid-sentence. Voice conversation spoken while the agent works is appended after that turn ends as one collapsed "Voice conversation" block (new `TriggerOrigin` kind `voice` in the SDK), so it never enters the running task's context. In both voice engines the Voice Mode rail now shows "Agent thinking · m:ss" or "Agent writing a reply" while the agent works between tool calls, instead of "No tools running".
- 40d310e: A session with more than 200 tools now sends the model only the core tools and an index of the rest, without being asked to (`context.lazyTools` unset; `true` and `false` still force it either way). With several MCP servers connected, every request used to carry all tool schemas (513 tools and 410 KB in the measured setup), which cost 7–9 s per request. Tools that share a name prefix are listed as one family and loaded with one call: `load_tool({ name: "computer_*" })`.

  SDK: `ToolDef.liveState` marks a tool that looks at state outside the session (a screen, an app). Its repeated calls count toward the stuck-loop guard only when they come back to back. New exports: `shouldGateTools`, `matchLoadableTools`, `LAZY_TOOLS_AUTO_THRESHOLD`.

- 5ca8fbe: Fast mode: `context.fast` (and the desktop's model panel) asks OpenAI for its priority tier on models that offer it (`supportsFast`). The conversation's reasoning effort and fast mode live in the session, reported in `SessionInfo` and switched with `session.setFast` (runner protocol v24), so every client shows the same values; reasoning that is on without a set effort shows as **Default**, not Off. Effort and fast switches made in quick succession reach the runner in order, the last one winning. The desktop sets both under the model list in **Model & usage** instead of in Settings → Providers.
- 5a18a15: Reasoning effort has a new level, `xhigh`, in `context.reasoning.effort`, in the desktop's provider settings and in the SDK's `ReasoningEffort` type. Anthropic models receive it as `high`. `context.reasoning` from the config is now applied when a session starts; before, it only took effect after the config was edited while Moxxy was running, so one-shot runs always used the provider's default effort.
- b6cc796: Telegram works like the Discord bot: it keeps a model of its own (`/model` buttons, or Channels → Telegram → Setup in the desktop) that no longer changes the desktop's or TUI's model, `/auto-approve` is the same switch as Auto-approve in the desktop's chat with the bot, a message written in the app shows in Telegram with its reply, `telegram_send_message` sends files you ask for (up to 50 MB), a voice message is answered with a voice message, and the bot can run in the background from Channels → Telegram → Run mode. Telegram bots cannot take or place calls, so `/call` points to voice messages.

### Patch Changes

- 1bde2f6: The agent checks live facts — prices, timetables, availability, news — before stating them, and says so plainly when it has not. Redoing earlier work keeps every choice you already settled (dates, one-way or return), and the record of an older turn now keeps your own words, so such a choice survives once the turn is summarized. Moxxy speaks of herself in one form in Polish ("sprawdziłam") in both the chat and Voice Mode, instead of switching between "sprawdziłam" and "sprawdziłem". The chat no longer shows "Context compacted" after nearly every reply: the routine record of a finished turn only moves the context meter, and a compaction the context forced is still announced. `Sleep` no longer invites waiting on an app or page the agent acted on, or retrying a lasting condition such as a Wayland session.

  `@moxxy/sdk` adds `AGENT_CONDUCT`, `SELF_REFERENCE_NOTE`, `withAgentConduct`, and an optional `routine` flag on `CompactionEvent`.

- 2f408fa: On Windows a settings change — such as turning a provider off — is no longer lost when another process happens to be reading the same file at that moment. The atomic file writer now waits briefly for the reader instead of failing.
- df14c3b: The chat shows a background `Bash` command as started, not as finished ("Started pnpm dev in the background"), and names the job a `Wait` or `StopJob` call is about ("Waiting for bg-1 to print ready", "Stopped bg-1") — in the desktop and in the terminal UI.
- 1fd6b7a: The desktop's chat with a Telegram or Discord bot now shows and runs the bot's own model — also right after `/model` in the messenger — and a model picked in that chat's header becomes the bot's model. Telegram's `/model` shows the providers first, then the chosen provider's models, with the current one in green and a way back.
- 294ee09: Desktop browser: you see the agent's own pointer glide to each element before it presses, with a ring where it pressed, and you can take the browser over at any time — press on the page, type into it, or use Take over in the Browser pane. While you have it the agent's actions are refused (it can still read the page) until you press Resume or send a new message; Stop also ends the running turn.
- 41cba8e: The agent's browser crops a capture to everything an element draws — padding and border too, and content that overflows an element with no size of its own (Canva's canvas in a narrow pane) — instead of a 0×0 picture; an element that draws nothing is an error that says so. A capture asked for a uid the page does not have says to leave the uid out for the whole viewport. A press no longer refuses a button as covered by what sat at its place before the page scrolled to it — the terminal's browser read the point as if the page had not scrolled, so a Google Form's "Prześlij" below the fold was "covered" by the textarea above it every time — nor when the page moved under it while it checked — a form field that grew as it was typed into pushed the button down, and the second look read the old place.
- 9ac8c77: The agent's browser no longer stops at a page that only mentions a CAPTCHA — Coolify's list of services includes one called "Cap Captcha", and the agent asked you to clear a CAPTCHA that was not there. A CAPTCHA now counts only as its widget. A run of steps also finds cards a page answers clicks on without calling them buttons, such as the service cards in Coolify's catalogue, by the text they show.
- 41cba8e: When the agent hands the desktop's browser to you — to sign in, enter a code or choose on a cookie banner — it waits the ten minutes the pane gives you. The call to the pane was cut at two and a half minutes like any other, so the agent read "browser bridge call timed out" while you were still signing in.
- fe2eb5a: A page that is still loading is no longer read as work in progress. Chromium marks the whole document busy until it loads, and some pages never finish (n8n's sign-in page), so the agent was told to wait on the page itself and went on working instead of reporting.
- efddcb4: Desktop browser, found by running the packaged app in its narrow Browser pane: a press goes to the middle of an element's largest line box, so a link that wraps onto two lines is pressed on its text, not between the lines. `browser_snapshot` with `full: true` always sends the whole tree, never "unchanged". A row the snapshot collapses past its depth cap keeps the text it holds, so prices deep in a product list reach the agent.
- 97c44bd: A click in the desktop's browser is no longer reported as "the tab is not on screen" when the press merely landed late. With the window behind another one, Chromium holds input for the next frame, so a press can take seconds to arrive; the check now waits from the moment the press was sent instead of from when it was armed.
- f44cf63: The browser costs far fewer tokens on large pages. A page read has a size limit and says what it left out; a list that empties reports one line instead of every row that went; `browser_find` looks words up on the page and returns only the matching rows (a matching label brings its field); a run of steps ends with a short read; and once a tab is read whole again, its earlier reads are sent as a one-line marker that `recall` can expand (a new `supersede` contract in `@moxxy/sdk` any tool result can use). `web_fetch` can wait for a service that was just deployed to come up (`untilUpMs`) instead of reporting it broken while it starts.
- 15a2c80: Moxxy Browser acts the way a person does and says what happened. A click brings the agent's tab to the front, scrolls to the element, refuses a disabled one or one something covers (naming what is in the way), moves the pointer there, checks the page felt the press, and waits for the page to settle; the result reports a navigation, a dialog or a tab the page opened. Typing replaces what a field held instead of appending, and `submit: true` presses Enter afterwards; Enter now submits forms. An `alert()` no longer takes the tab down — it is accepted and quoted — and a `confirm` or `prompt` waits for the new `browser_dialog`. New desktop tools pick from a native list (`browser_select`), scroll, hover and wait for text. Frames are read into the snapshot and can be acted on, from the same site and from others, and `target=_blank` links open as tabs in the pane rather than as a separate window. A footer link to a cookie policy, or a form with a password field among others, no longer stops the agent as if the page were asking the user for something. The terminal UI's headless browser keeps its tools as they were.
- b819adc: Desktop browser: with Jev on, `browser_run` is now the default way to act on a page, even for one click, and it no longer reads the page first when the agent already knows what is on it. An `expect` is checked against what the action reported and against what appeared and went away on the page, so an alert, a banner closing or a new tab now counts as seen. A step delivered whose `expect` Jev could not confirm is reported as unverified rather than failed, so the agent checks the page instead of doing the step again. Fields a step's kind does not use are dropped before the run. The browser skill now tells the agent to finish the task itself and to compare every item in a list before answering. The browser trial harness logs every press and key a page gets, so a take-over during a run can be traced to its cause.
- b46c70a: A run of browser steps types into the field you meant on forms whose labels are not tied to their fields, such as Coolify's service settings, where it had typed a domain into Description instead of Domains. A typed step is now checked on the field itself, only steps whose effect was seen are remembered for next time, and a button with no name is no longer picked blindly.
- e17a9f7: The Moxxy Browser skill now teaches the quick way: go straight to the page and guess a URL once, never reopen the page already open, read once and trust one clear signal, send the steps known together (as one `browser_run` when Jev is on), when to scroll, hover, wait or work from a picture, and to stop — not work around — when the user takes the browser over.
- b45cf4b: The Discord bot's app-message mirror, per-bot model, shared auto-approve, session actions, reply context and file reading moved into `@moxxy/channel-kit`, so every messenger bot reuses them; Discord behaves as before.
- af1fc35: Voice notes sent to a channel bot (Discord, Telegram, …) are transcribed again: sessions now pick their speech-to-text backend at start — `plugins.transcriber.default`, else Codex transcription when you are logged in with ChatGPT — instead of leaving none active, so the bot no longer answers "no speech-to-text backend is configured" while the desktop mic works.
- b7a38f7: Fix the channel setup wizard's "Start the bot" re-opening the same menu forever on a TTY (Discord, Telegram, WhatsApp, …): the wizard hand-off now marks itself so the channel starts instead of routing back into setup.
- 99d4424: Offer the current Claude models: Claude Fable 5.1 (`claude-fable-5-1`), Opus 5.5 (`claude-opus-5-5`), Sonnet 5.5 (`claude-sonnet-5-5`) and Haiku 4.5 (`claude-haiku-4-5`), for both the Anthropic API key and the Claude Pro/Max sign-in. Fable 5.1, Opus 5.5 and Sonnet 5.5 each have a 1M context window and 128K max output; Haiku 4.5 has 200K and 64K. Sonnet 5.5 is the new default, and Opus 5.5 is what `moxxy init` suggests for Anthropic. The previous generation is no longer listed, but a config can still pin it.
- aaee26d: Sign in to Claude Pro/Max (`claude-code`) straight from the desktop, with no terminal. The desktop's **Sign in** opens the browser, and the sign-in usually finishes on its own when you approve it. The sign-in dialog shows Claude's progress and the sign-in link, and if the browser shows a code instead, you can paste it there.
- a3cb59b: When the tab the agent names closed between turns, an address it opens goes to a new tab instead of replacing the page that is open, and a page read goes to the one open tab and says so — instead of failing and costing the agent another call. Clicks and typing still refuse there.
- f4b8c5f: A file the agent attaches to a Discord or Telegram message is checked and read through one open handle, so the size limit applies to the bytes actually sent, and a named pipe is refused at once. Computer Use and browser lessons name an app's file without a regular expression that slowed down on long runs of dashes. The plugin-seed fingerprints and the runtime downloads at build time read each file once, and a downloaded runtime is checked against its pinned hash before it is written.
- 6cdb56e: Collaborative mode can start on Windows: its coordinator, hub and peer sockets are named pipes there instead of `.sock` paths, which Windows cannot listen on. The desktop no longer says "Reconnecting" while it is starting for the first time — it says it is starting the agent runtime and that this can take a few minutes after an install or update.
- 352ce3a: The Computer Use cursor now travels to a list row before selecting it (System Settings and Finder sidebars) instead of staying where it was.
- 54d629a: A tool can be marked `alwaysLoaded` to stay in the request when the tool list is loaded lazily. Computer Use marks `computer_request_access` and `computer_run`, so a task no longer spends a model round on `load_tool`.
- 5ca8fbe: `MOXXY_JEV_TRACE=<file>` records every Computer Use request to Jev (the step, the window's size, the top answers, the time) for measuring where runs go wrong. Text a step types is kept as its length only, and the file is readable by its owner only.
- 03d14ba: The Computer Use plugin keeps its training cases in the repo and gains `learned:train`, which runs them on real apps and updates the lessons that ship with it.
- 569750e: The Computer Use live view on Windows shows a window that stands still: a viewer gets the first picture at once instead of waiting for the window to change, and a video encoder that holds a picture back is fed it again.
- cd2950d: Computer Use starts an app again when it is asked for right after the app quit. macOS keeps listing a quit app for a moment, longer on a busy Mac; the macOS helper took that entry for the running app and answered "has no open window" instead of launching it. A listed app whose process is gone no longer counts as running, and the helper starts a new instance in its place. The flaky durable workflow-approval test now waits for the request files instead of a fixed pause.
- a34b1d7: A run target that only says where the focus is ("keyboard focus", "the focused search field") is no longer remembered or recalled: such a lesson once typed an OLX search into Safari's address bar. Typing whose target names nothing but the focus goes to the focus. The macOS helper reports each window's number, so a key that opens a new window with the same title as the one before it (an empty start page) counts as done instead of stopping the run.
- a34b1d7: Computer Use runs wait less. The agent cursor no longer holds an accessibility action until its glide ends, and a press takes no picture before it. Pictures are taken only around steps that pixels judge (clicks, and keys that expect something such as select all) and at the end of a run, and consecutive steps that check nothing (keys, typing into the focus) go to the macOS helper as one batch. A target that is the whole name of exactly one element, or quotes it, is acted on without asking Jev where it is; anything less certain still goes to Jev. Each run reports how its time split between Jev, actions and looks, and `pnpm --filter @moxxy/plugin-computer-control trial:summarize <dir>` sums up a live trial. A request to Jev about a long page that changed no longer exceeds Jev's input limit (HTTP 400): the step's changes are capped and the window is sent once. Typing into a field that already holds exactly that text is skipped instead of doubling it ("https://www.olx.plhttps://www.olx.pl").
- 5ca8fbe: Computer Use runs no longer repeat what must happen once: a key step ignores a target the model wrote into it and is pressed once (a second `super+n` opened another window), and typing is not repeated once its text is in the field (it used to append the text twice). A key after which another window is in front counts as done instead of stopping the run, and the model is told to ask for full control of a browser before a run that types into it.
- f94511e: Computer Use no longer waits for a remembered effect that was only that time's content (a number on a calculator display), and ships default lessons for Calculator.
- 467542f: Computer Use: the control snapshot can now carry the agent cursor (its phase — idle, moving, executing, delivered or failed — and its place as a fraction of the target window) and the target the human sees (app and window title). The cursor disappears from the snapshot once Computer Use is stopped or its helper has failed. On macOS, observing an app shows Moxxy's own pointer in a click-through overlay ordered just above that app's window, kept out of screen sharing; the real mouse pointer does not move. The pointer glides along a short arc (it jumps under Reduce Motion), can mark a press and frame the element it is about to use. A window on another Space gets no overlay, but its cursor position is still reported.
- f23b22a: Computer Use: add the shared backend the new macOS and Windows helpers will run behind — one helper per session turn with the existing Stop/Pause controls, the Codex/Claude-style tools built from the shared contract, per-app access levels (browsers and trading apps read-only, terminals and IDEs click-only, everything else full, with `full_access` for apps the user approves), system and clipboard chords gated by their grants, and grants read back from the session log so every attached client sees the same access. Helper refusals now keep their error code. Nothing is wired to the running tools yet.
- d9cd948: Computer Use on macOS runs batches, full-screen screenshots and zoom in its native helper. A batch runs several steps on one app, each through its own safety checks, stops at the first step that does not go through (or when the user pauses) and returns the app's state once at the end. The full-screen screenshot shows only granted apps on the main display, without the menu bar, everything else black; zoom looks closer at a region of the latest app or full-screen screenshot at native resolution and refuses a region outside it or a window that moved since.
- 269c8de: Computer Use on macOS: shortcuts with modifiers (shift+a, command+z) now work in Blender and other apps that follow the modifier keys themselves, and the agent gets notes for Blender (commands by name through F3, shortcuts instead of small menus).
- c58ac4a: Computer Use screenshots on macOS now show a window exactly where clicks land. Apps whose window surface is larger than its frame (CapCut and other Qt apps) used to be captured about 1% off, so points read from the picture missed small targets such as a clip edge. A window the system briefly leaves out of its list is looked up again instead of failing the screenshot or the zoom.
- d916969: Computer Use: add the shared tool contract the new macOS and Windows backends will speak — input schemas for the Codex/Claude-style tools (app state, click, type, paste, keys, scroll, drag, mouse, hold key, batch, screenshot, zoom, access), an xdotool key-chord parser with system-combo and clipboard checks, the vision image budget and image-to-screen coordinate mapping, action outcomes with a next-step hint per error code, the indexed accessibility-tree text with diffs, and fencing of application text as untrusted data. Nothing is wired to the running tools yet.
- 2079504: Computer Use: Finder works from the bare desktop (keys reach it and the window an action opens is the returned state), and a remembered step that makes one more of something (a new tab) is no longer skipped because the window already looks like its result.
- 16154e9: Computer Use on macOS: a file in an open or save panel can be clicked, and apps that draw their own window (Blender) get clicks, shortcuts and typed text in the right place.
- 6b1c7c9: Computer Use on macOS: when an open or save panel shows, the agent is told to choose the file by its path (Go to folder) and then confirm, instead of searching in the panel.
- 40d310e: Computer Use on macOS: four failures found by repeated trials are fixed. A control that accepts an accessibility press and does nothing (Qt buttons, as in CapCut's export dialog) gets a real click when the model asks again. Finder's rename field, which sits outside the window, is now part of the app state, and typing into an element that takes no text is refused instead of being lost. A browser page is read only after its content has loaded, and the model is told when it has not. Looking at an app again between actions no longer trips the stuck-loop guard. The guidance tells the model to send several actions in one response.
- 0dd7273: Computer Use reaches an app whose window is full screen on another Space: when the accessibility request does not bring it forward, the workspace switches to it, so the window can be captured and Command shortcuts arrive. The browser notes now say to work in the user's own browser when they name it or the task needs its tabs, accounts or downloads. The live view runs as video at 30 pictures a second (single JPEG pictures stay at 2).
- 504cae7: Computer Use: the native-helper transport, JSON-lines protocol and helper artifact check now live in one platform-neutral module shared by every backend. The transport speaks a configured protocol version and accepts registered helper events (cursor moves, preview frames) alongside the built-in control state; an unregistered event still fails closed. The artifact check also recognises macOS Mach-O executables (thin or universal). Windows behaviour is unchanged.
- d421a44: Computer Use waits for a followed link's page: a click on a link to another page (or Return on one) waits up to 8 s until the page changes, and when it has not, the action says the page is still loading and a run stops instead of clicking the link again. A click that only lit an element up is no longer remembered as a step's element, and the skill tells the agent to answer "why did it fail" from what it sees, not a guess.
- ed9bbcd: Computer Use knows Linux as a platform: a helper under `bin/linux-x64` or `bin/linux-arm64` is verified as a 64-bit ELF, system key chords and app categories cover the common Linux desktops, and a Linux host without the helper says so through `computer_status`.
- 6e75d53: Computer Use on macOS: the wait after a key press or typed text is shorter (the helper hears the app's reaction from before the action), and the first look at a browser that already shows its page no longer waits a second.
- 808bbfd: Computer Use status reaches every attached client as it changes, and the user can take over. The runner pushes a `computer.changed` notification (protocol 23) instead of being polled, the desktop forwards it to the chat, and the control strip names the app and window under control, shows the state as text with an icon, and offers Stop, Take over and Resume from the keyboard. Take over pauses the agent, lets go of any held key or button and hides the agent cursor until the user resumes. SDK: `ComputerControlService.subscribe` and the `takeover` control command.
- 6319474: The live view of Computer Use shows the app again on a still screen: it stayed black because the first video frame arrived before its canvas existed. The live view and the control strip now use the app's own colours and type, with a lightly rounded frame and controls that appear on hover. The agent's cursor, on screen and in the live view, is a soft-cornered arrowhead.
- ec46d4e: Computer Use fixes found by running the benchmark tasks through Moxxy. A batch step now reads only the fields of its own action, so a model that fills every field no longer has the batch rejected. When a call names both an element and a real point, the point is the target, which lets a model click a spreadsheet cell or a canvas. Typing with an all-zero target goes to the focused element. `ArrowDown` and the other arrow names are accepted as keys. Stopping the live preview no longer lets one more frame through.
- b9445f8: Computer Use (macOS helper): list installed and running apps and resolve app names to bundle identifiers (by identifier, display name or bundle path), reporting ambiguous and unknown names. Reading an app's state launches it in the background when needed, waits for it to settle (about a second after a launch, longer while a spinner shows, never more than five seconds) and returns its focused window as indexed accessibility elements: layout-only containers are flattened, element indices stay the same for as long as the element exists, and password fields are marked secure without their value ever being read. The state also carries a JPEG of just that window within the vision image budget, with every element's frame in the image's pixels; when there is no image, the reason is given. A macOS platform profile connects the helper to the shared Computer Use backend.
- 3081336: Computer Use (macOS helper): act on an element by its index from the last app state. A plain click presses the element through accessibility (AXPress, or AXShowMenu for a right click), set_value writes text or a number into an editable element, and perform_secondary_action runs only an action the element itself lists. The agent cursor glides to the element, frames it, marks the press and reports moving, executing and delivered or failed. An index the helper never handed out is refused as stale, an action before any observation asks for one, an unknown accessibility error blocks the action instead of retrying it, and every answer carries the app's fresh state. Apps installed outside the standard folders now resolve by bundle identifier.
- a006a0c: Computer Use (macOS helper): the user stays in charge. Pressing Escape stops Computer Use like the Stop button, without taking Escape away from the user's apps. Pause holds the next action and fades the agent cursor; after Resume the action is not replayed and the model looks at the app again first. Real mouse input waits for a moment in which the user is not using the mouse or keyboard, and is refused if they keep going, so the agent never fights the user's hand.
- 875ba3e: Computer Use: add the macOS native helper skeleton — a universal (arm64 + x86_64) Swift executable built by `native/macos/build.sh` with a verified manifest. It speaks the shared JSON-lines protocol v5, reports Accessibility and Screen Recording readiness, opens the matching System Settings pane on request, handles pause/stop outside the request queue, and exits when its input closes or the process it serves dies. It is not used by the running tools yet.
- ce4e53d: Computer Use (macOS helper): computer_hold_key holds a key or chord for the requested time, in the background, and releases it early when the user stops Computer Use or the helper exits, so no key is ever left pressed. Command shortcuts and rich-text paste, which only an app in front can handle, now bring the app forward instead of being refused, never while the user is typing.
- 01d8bff: Computer Use (macOS helper): typing, keys, paste and text selection work while the app stays in the background. Text is inserted at the caret through accessibility (replacing a selection), or typed as key events sent only to the target app, stopping and reporting how much was typed if keyboard focus moves. Keys and chords are sent to the app alone, never to the app the user is working in; Command-A selects all through accessibility, while other Command shortcuts, which only an app in front handles, are refused with a hint instead of being lost. Plain text and Markdown paste without touching the clipboard; rich-text paste uses the clipboard and gives the user's clipboard back unless they copied something meanwhile. select_text finds text by content, asks for prefix or suffix when it repeats, and never reads password fields. The host now sends helpers chords already parsed from xdotool syntax.
- 2e9344c: Computer Use (macOS helper): click, scroll, drag and step-by-step mouse gestures by screenshot point, with safety checks before any real input. A point must lie inside the latest screenshot, the window must not have moved since, and the pixels around the point must still look as the model saw them; the app comes forward only when the user is not typing, and the point must land on that app, never on the desktop, the Dock, Moxxy itself or another app's window. A control under the point is pressed through accessibility in the background; typing and pasting at a point go to the text field there. Scrolling tries the element's page action and its scroll bar before the wheel. The user's pointer goes back where it was after every gesture, and a button the model left pressed is released when the helper stops.
- c58ac4a: The mobile channel now serves Computer Use status: `computer.snapshot` answers which app the agent is operating and in what state, and every change is pushed as `computer.changed`, the same state the desktop's control strip shows. Pause, resume and take over stay with the person at the computer; a phone stops a turn as before.
- af1308b: Computer Use: an action that leaves the app looking exactly the same is noticed. The first time the model is told nothing visible changed; the second time in a row the same action is reported as ineffective with a hint to switch method; a third identical try is refused before it reaches the app. On macOS an accessibility action an element declined three times is skipped for five seconds, so each step goes straight to the method that works.
- a34b1d7: Computer Use types on a web page one character per key event (Canva put the last character of each longer event astray) and types nothing when the page's keyboard focus is not a text field, since those keys are the page's shortcuts (Canva's "s" made a sticky note). A `computer_run` click whose control is named one way for accessibility and drawn another ("Title, Heading" over "Dodaj tytuł") is found by the text the screenshot shows (Vision text recognition, macOS) when names and Jev find nothing.
- ed74b61: Computer Use on macOS: the first look at Safari waits for the page instead of returning only the toolbar, and typing into a field of a page works while Safari stays in the background. `computer_run` tries another way when a target is blocked.
- db4f18b: Computer Use on macOS: a deep web page (a YouTube channel) no longer ends every call with "invalid get_app_state result". Element keys stay unique and inside the contract's limits, which count UTF-16 units. Typing into Chromium apps (the ChatGPT app) now arrives: text the field accepts and drops is sent as keys. The agent's cursor is drawn on its target for a window that touches the menu bar, instead of 24 points below it. An invalid helper result names the field that failed.
- 0ad9ec0: Computer Use on macOS guards save dialogs. Typing, pasting or setting a name in a save dialog, and pressing Save or Return in it, is refused when the file would land in a protected place: login items (LaunchAgents/LaunchDaemons), shell start-up files, SSH/GPG/cloud keys, git hooks and config, virtualenv `activate` scripts, or a file that runs when opened (`.command`, `.webloc`, `.mobileconfig`, …). Names are compared the way the file system sees them (case, look-alike and invisible characters, trailing dots and spaces), and the model is told to pick another name or folder or ask the user.
- 51399e9: The Computer Use live view no longer encodes a window in which nothing changed: on a still window the helper sends no video and uses about a third of the processor time it did.
- ad6de5d: Computer Use fixes found by running real tasks through Moxxy on macOS. A tool call is no longer rejected when the model fills the fields it does not use with `0`, an empty string or `null` (for example `x: 0, y: 0` next to an `element_index`). An app with no open window now takes key presses, so a shortcut such as Command-N can open one. A running app that the system shows under a translated name is found by the name of its bundle too.
- 00cf576: Computer Use on macOS no longer gives up on a browser page that a background window keeps from accessibility. The helper switches on the app's full accessibility tree when it first looks at it (and switches it back off when it leaves), and a page that still does not show gets its window brought forward once before the model is told the page is not readable. Safari's start page is read in under 2 s instead of 8.
- b56668f: Computer Use clicks controls on web pages with the pointer from the start, in the background, instead of an accessibility press that pages such as Canva accept without doing anything: a Canva side tab now switches on the first click (about 0.75 s instead of two tries). A followed link waits at most 3 s for its page instead of 8 s; a page that changes does so within half a second.
- 9c5e2f0: Computer Use on macOS reads web pages more cleanly: elements no longer carry an empty value and a "collapsed" state that mean nothing, and a custom action is listed by its name. A click or typed text aimed at a point now finds the control from the last observed state when the window is on another Space, so it still goes through accessibility.
- 9cb28d6: Pick up patched electron 43.7.7, undici, ip-address 10.7.1, brace-expansion, axios 1.20.0 and image-size 2.0.4 (with the metro patch that hands it a buffer). The dependency audit now keeps a reviewed list of advisories that have no upstream fix yet; it holds one entry, node-forge GHSA-86w9-cpqp-85rv, reached only through the Expo CLI's local iOS signing helper, and fails again as soon as a fix is published or the package appears anywhere else.
- c8acded: The desktop installer now carries Python and Node, so the agent can run the scripts it writes on a computer that has neither. Python comes with pip and the packages common tasks need (requests, numpy, pandas, matplotlib, openpyxl, python-docx, pypdf, pillow, beautifulsoup4, lxml, pyyaml); Node comes with npm and npx. Both are unpacked to `~/.moxxy/runtimes` on first launch, with no download, and the bundled Python is the one `python`, `python3` and `pip` mean inside Moxxy on Windows and macOS alike. The step that used to download Node during setup no longer appears.
- 90ee910: Discord: `/auto-approve` is in the "/" picker (the old `/yolo` still works when typed), and `/model` suggests the available models as you type instead of needing `provider::model` written by hand.
- c1351ca: The Discord bot's agent now drives the desktop's browser instead of an unseen one of its own (a bot started from the app inherits the browser bridge like every workspace runner), and Channels → Discord shows the same Terminal / Files / Diff / Browser workbench as a workspace chat, opening the browser when the bot's agent uses it. On Discord the agent knows you cannot see its browser or terminal: it asks in the chat when a page wants your choice (such as a cookie banner) instead of waiting for a click you cannot make.
- f9fa366: A Discord voice call no longer goes deaf when its voice connection gets stuck reconnecting: the bot rejoins the channel after 15 s, and if that does not help it ends the call and tells you in DMs so you can `/call` again. Connection changes are logged.
- 32c1243: Discord voice calls tell you what the agent is doing while it works: the agent says in a short sentence what it is about to check, the bot names a step the agent starts silently ("Przeglądam pliki.", "Sprawdzam, czy wszystko działa."), and says it is still working during a long step. The voice feedback scheduler and the step categories moved to `@moxxy/chat-model` so the desktop's Voice Mode and the bot share them.
- 8d300a1: Discord voice calls no longer go quiet for the rest of a turn after you (or noise on your microphone) talk over the bot: it skips only the rest of what it was saying, then still says the next step and the agent's result. A sentence the text-to-speech service could not voice is now logged with the reason instead of being skipped silently.
- f9fa366: Discord voice calls voice each sentence in its language, like the desktop's Voice Mode: with the local Piper voice a Polish question is answered in the Polish voice instead of the English one.
- f09441a: Discord voice calls start talking as soon as the agent has written its first sentence instead of after the whole reply, voicing the next sentences while one plays; talking over a reply drops the rest of it. The sentence splitter moved to `@moxxy/chat-model` so the desktop's Voice Mode and the bot share it.
- ebe1003: Discord: asked for a file ("send me the photo"), the bot attaches it with `discord_send_message` instead of replying with a `file://` link that cannot be opened in Discord — its turns now tell the model it is replying on Discord and how to send files there.
- da7f83a: A message you write in the desktop's chat with the Discord bot now shows in Discord too ("typed in moxxy: …") above its reply, and during a voice call the bot says that reply aloud. Channels share this through `TurnCoordinator.mirrorPrompt`, which skips machine prompts (schedules, webhooks, voice transcripts).
- 8e72604: `/new` from another client of a conversation — such as the Discord bot — now clears the desktop's chat too, instead of leaving the old conversation on screen. `RemoteSession.onReset` tells a client when the runner started a new conversation.
- b0f2616: Discord shows "typing…" again while the bot works on a message: the indicator called discord.js's `sendTyping` detached from its channel, so every ping failed silently.
- 950dbec: The browser in the terminal acts like the desktop's. `moxxy` outside the desktop now drives its headless browser through the same browser host as the desktop's pane, so `browser_type` replaces a field instead of appending, a press on a covered or disabled element is refused with the reason, a click reports the navigation, dialog or new tab it set off, and `browser_select`, `browser_scroll`, `browser_hover`, `browser_wait`, `browser_dialog`, `browser_point`, `browser_upload` and (with Jev) `browser_run` work there too. `browser_capture` and `browser_await_human`, which failed headless, now answer — the hand-off saying plainly that nobody can take over a browser with no window. Acting asks once per site (`browser_allow_site`) instead of before every click, as on the desktop.
- 7625088: Settings has a Jev section: paste the TypeSafe key, change it later, and switch Jev on or off without removing the key. The switch is a vault entry (`JEV_DISABLED`), so the desktop, the terminal and channel bots all read the same one, and with it off Computer Use works one action at a time as it does without a key. A run of steps also no longer clicks a control again when the click changed only the picture of the window: on a web page whose menu never reaches the accessibility tree, the second click closed the menu the first one opened, in a loop. The step now stops with the menu open and tells the model to continue by the screenshot.
- e825fa1: A conversation no longer gets stuck on `No tool call found for function call output` after a long-running tool finishes late. When a tool call was answered only after later turns had begun, the `segments` compactor could summarize the call while leaving its result behind, and every following request was rejected by the provider. The compactor now stops its window before such a call, and the projection drops a result whose call was summarized away (and answers a visible call whose result was), so sessions already in that state recover on their next message.
- a3d3207: Linux Computer Use: the live view of the window in use no longer goes dark for the rest of the session after one picture that could not be taken. A missed picture is tried again on the next tick and reported only when the window stays out of reach for a second, and an X error on another connection of the helper no longer fails a capture.
- 9dc64f5: A runner socket path too long for the system to bind — a deep `MOXXY_HOME`, a long user name, a long `MOXXY_RUNNER_SOCKET` — no longer gets cut short silently, which made every desktop session after the first fail with "moxxy serve exited before binding" and could connect one session to another's runner: it moves to a short name in the user's private runtime or temp folder, or the runner refuses with the reason. On a fresh home, "New session" in the Moxxy workspace works instead of failing with "unknown desk: moxxy", as do renaming it, bringing it to front and moving a session into it.
- e4ed084: OpenAI and ChatGPT sign-in (Codex) now list only the models OpenAI still serves — GPT-6 (Astra, Sol, Luna) and GPT-5.6 (Sol, Terra, Luna) — and add `gpt-6-sol` and `gpt-6-luna`. With an API key they have OpenAI's 1,050,000-token window; with ChatGPT sign-in every model uses the Codex backend's 272k window (less its 5% margin), so compaction starts in time. The API provider now defaults to `gpt-5.6-luna`, sends GPT-6 the right output-limit field, and sends Sol and Luna `reasoning_effort: "none"` when a turn has tools, which Chat Completions requires for them to call tools.
- e0732de: The browser agent acts on what a page says about its own task — an error, a required field, a change not applied yet — while a page still cannot add to or change the task; and a run that cannot find a control says the closest ones may be it under another name.
- c273722: Fix channel bots answering every message with "No active provider" right after pairing (Discord, Telegram, Slack, Signal, WhatsApp). The pair flow ran the bot on the setup probe session, which never activates a model; a successful pairing now stops that bot and starts the channel for real with the configured model (or hands back to `moxxy onboard` as before). Adds `finishPairing` to `@moxxy/sdk` for channel pair flows.
- a34b1d7: Skills that plugins ship are loaded. A plugin's `package.json#moxxy.plugin.skills` folder (or its `skillsDir`) was declared but never read, so Computer Use's `computer-control` skill (with its per-app notes), the OAuth skills and `dispatch-agents` never reached the agent, the chat's @ menu or an @ mention. They now load at startup between the builtin skills and the user's own, and `reload_skills` keeps them.
- 97c44bd: The agent no longer reports on work that has not finished. A browser read lists what the page itself marks as still working (`aria-busy`, a progress bar with no amount) and an action says when the page was still changing as it returned; any tool result can say so through the new `Progress` contract in `@moxxy/sdk`. The default mode then asks the agent once, at the end of its turn, to wait and look again before it reports. Turn-end checkpoints can declare `applies` to be skipped without a trace on turns they do not concern.
- 97c44bd: A `browser_run` report quotes what a step typed whole (up to 200 characters, a longer text marked as cut with its length) instead of silently cutting it at 60 — an address cut before its port read as the port not taken, and the agent typed it again and again. A field that does not hold what was typed is quoted the same way.
- 8a10b7d: Auto-approve belongs to the conversation: switching it from Discord (`/auto-approve`) shows in the desktop's chat with the bot, and switching it in the desktop applies to the bot's own turns. The switch is recorded in the session log (runner protocol v21 adds `session.setAutoApprove`; `SessionInfo.autoApprove` reports it). A new conversation starts with it off.
- a34b1d7: `@skill-name` in a chat prompt calls that skill for the request, on every surface (desktop, terminal UI, channel bots, mobile): the skill rides on the prompt as an attachment, so every client and every replay sees it, and a prompt a trigger wrote calls nothing. Skills gain `aliases:` (other names to mention them by; `_` reads as `-`) and `disallowed-tools:` (tools withheld from a request that mentions the skill, and from the sub-agents it starts). `@computer_use` calls Computer Use and keeps Moxxy's in-window Browser out of that request; the browser skill no longer tells the agent to use the in-window Browser when the user names another browser such as Arc. The SDK exports `mentionedSkills`, `skillAttachment`, `withoutTools` and `toolPatternMatches`. In the desktop, typing `@` in the composer opens a menu of the tools a prompt can call (Computer Use and Moxxy Browser first, labelled by the skills' new `label:` field), narrowed as you type; arrows, Enter/Tab and Escape drive it (Escape closes it for that @ word only), and `@moxxy_browser` keeps Computer Use out of its request. The SDK also exports `mentionQueryAt`, `mentionOptions` and `insertMention`, `SessionInfo.skills` carries each skill's description, label and aliases, and `@moxxy/client-core` has `useMentionPicker` for any composer.
- 1e5cb75: A skill that lists `allowed-tools` is no longer offered to the model when none of those tools exists in the session (an MCP server that is not connected, a plugin that was replaced). `load_skill` by name still loads it. SDK: new export `skillsWithinReach`.

  Computer Use on macOS sends the model a shorter state for web pages: the context menu every page element offers, empty groups and nodes that only repeat their parent's name are left out. A YouTube channel page went from 55,000 to 22,000 characters.

- bf368a0: The desktop shows Stop while another client of a conversation runs a turn — such as the Discord bot's agent working on a Discord request in Channels → Discord — and stopping it there stops the bot's turn. A runner now lists every running turn in `SessionInfo.runningTurns`, including turns a channel bot runs inside it, and `abort` reaches them (runner protocol v22). Browser tabs in the workbench stay open when you collapse the workbench or switch to another pane, until you close them.
- 1fd6b7a: Telegram: `/voice` now really turns spoken replies on and off (a voice message no longer always gets a voice reply), and every spoken bot reply is read with a voice for its language, so Polish is no longer read with an English voice.
- 41cba8e: The browser the agent uses in the terminal can be signed in to sites. It keeps a profile in `~/.moxxy/browser/profile`, so a sign-in lasts from run to run: `moxxy browser login <site>` opens a window to sign in and keeps what the site stored once you close it, `moxxy browser logout <site>` forgets one site (`--all` forgets every sign-in), and `moxxy browser sites` lists them. The same actions are `/browser` in the TUI. One browser uses the profile at a time; a second run starts signed out and says so.
- c2db57d: The `terminal` tool returns as soon as its command ends in a zsh that sets the window title (Oh My Zsh and similar). The title sequence the shell prints right before each command's output hid the end-of-command marker, so every call — even `echo` — waited out its full 30 s timeout. The tool's result is now plain text, without color codes or title sequences.
- 90fe2ce: Tests no longer reach the developer's real `~/.moxxy` or OS keychain: the shared test setup points the home directory at a throwaway one on every platform (Windows resolves it from `USERPROFILE`, which the tests never moved), and `MOXXY_NO_KEYCHAIN=1` keeps the vault off the keychain. Desktop resource preparation now also runs under a native `pnpm.exe`.
- fe2eb5a: A tool can name the modes it is for (`modes` on `defineTool`); other modes do not offer it to the model. Goal mode's goal*complete/goal_abandon and the collaboration's collab*\* tools are now offered only there — in a plain browser task the model took goal_abandon and gave the task up. New `toolsForMode` in the SDK. The browser skill says plainly that allowing a site is a step the agent takes, never a reason to stop.
- 8d6a7ca: A button with no name is read with what its markup says (`button (no name; markup: @click="modalOpen=false")`), so the agent no longer takes a close button for the action beside it. The browser skill says a change the page reports as not applied yet is not done: the agent uses the control that does it under another name (a restart that reloads the settings) when it touches only what the task set up, and asks first otherwise.
- a34b1d7: Commands the agent runs get a UTF-8 character type when the environment sets none, so `pbcopy` keeps Polish letters instead of writing mojibake ("pamińôńá" for "pamięć"); the SDK exports `utf8Locale`. The shared terminal sources a long or multi-line command from a private temporary file instead of typing it in, so a heredoc script no longer leaves the shell at `heredoc>`, and a shell still waiting for the rest of a command when the timeout comes gets Ctrl-C and says so.
- 7e92362: On Windows the agent's shell commands work again: Bash runs in Git Bash, or in Windows PowerShell where Git is not installed, instead of failing with `spawn /bin/sh ENOENT`. Long commands can now run in the background there, and the agent continues the moment one finishes (Wait) instead of pausing for a fixed time. Stopping a background job ends every process it started, so a stopped dev server no longer keeps running.
- 604fe0a: Five faults the test suite found the first time it ran on Windows: a one-level isolation path rule (`dir/*`) also matched files in subfolders, `Glob` found nothing for a pattern with a folder in it (`src/**/*.ts`), the desktop showed an empty diff for a new file, `moxxy mobile` could neither start nor stop Expo, and a component update failed for anyone with a linked plugin. The whole suite now runs on Windows in CI.
- Updated dependencies [1bde2f6]
- Updated dependencies [ac81f33]
- Updated dependencies [2f408fa]
- Updated dependencies [f44cf63]
- Updated dependencies [54d629a]
- Updated dependencies [ca9a67f]
- Updated dependencies [467542f]
- Updated dependencies [808bbfd]
- Updated dependencies [c329313]
- Updated dependencies [9cb28d6]
- Updated dependencies [bd8473c]
- Updated dependencies [40b40f4]
- Updated dependencies [194abc6]
- Updated dependencies [e825fa1]
- Updated dependencies [40d310e]
- Updated dependencies [5ca8fbe]
- Updated dependencies [c273722]
- Updated dependencies [5a18a15]
- Updated dependencies [97c44bd]
- Updated dependencies [8a10b7d]
- Updated dependencies [a34b1d7]
- Updated dependencies [1e5cb75]
- Updated dependencies [bf368a0]
- Updated dependencies [fe2eb5a]
- Updated dependencies [a34b1d7]
  - @moxxy/sdk@0.42.0

## 0.41.3

### Patch Changes

- 8735a7f: claude-code provider: moxxy tools now work in the default text transport. They are described to Claude in the prompt and its call blocks become real tool calls that go through moxxy's permission flow, instead of the model printing a fake tool call as plain text. Internal CLI `tool_use` stop reasons no longer abort the stream.
- 72e182b: Bump @napi-rs/keyring to 2.1.0. Vault keys already stored in the OS keychain stay readable; keychain errors now surface instead of reading as empty, and the vault still falls back to the on-disk key.
- 6fefc59: Pick up patched undici (GHSA-3wwx-pv8p-q78v) and ip-address (GHSA-rpw4-54j3-4h4q, GHSA-2vr4-cq9g-pvrc).
- Updated dependencies [6fefc59]
  - @moxxy/sdk@0.41.3

## 0.41.2

### Patch Changes

- d5324c4: Update non-major dependencies (Anthropic SDK, MCP SDK, grammy, esbuild, tar-stream and others).
  - @moxxy/sdk@0.41.2

## 0.41.1

### Patch Changes

- @moxxy/sdk@0.41.1

## 0.41.0

### Minor Changes

- 46136ab: Add an independent Windows x64 Computer Use helper with explicit window and observation targets, bounded UI Automation, capture metadata, input cancellation and desktop ownership. Preserve existing macOS operations and clean screenshot files after conversion failures.

  Preserve unchanged window identities, reject changed control values, explicitly restore minimized windows, support verified background EDIT value changes, and wait locally for focus without replaying interrupted input. Native protocol v2 separates active execution deadlines from human waiting and supports explicit pause/resume. An independent guardian retains the injected-input ledger across worker termination.

  Move accessible pause/resume/stop controls into a non-activating native guardian panel. Add an installed-application catalog and explicit reuse/new-instance launching with correlated window results instead of command-text interpolation.

  Expose session/turn-owned Computer Use state and human controls through an optional SDK service, runner protocol v12 and validated workspace-specific desktop IPC. Preserve stopped-turn tombstones and ordinary chat compatibility when the service is absent.

  Add filtered, observation-scoped accessibility reads and Windows-specific request guidance. Offer a consent-based offline Computer Use upgrade from full Windows installers with private dependencies, hash checks, backups, npm ledger alignment, isolated runtime verification and interrupted-update recovery; leave other extensions and user credentials untouched.

  Add semantic UIA action receipts with modal-safe execution, bounded accessible text reading and literal selection, and explicit window typing that rejects protected focus. Distinguish native-panel Stop from a process failure and present exact-turn human controls in the desktop chat surface.

### Patch Changes

- c6ee82d: Preserve screenshot images and other attachments returned by tools in ChatGPT OAuth and OpenAI API requests, alongside their original call IDs and capture metadata, without interrupting parallel Chat Completions tool replies.
- 01c926c: Keep Windows dialog controls bound to their actual window, expose modal ownership, and return a blocking dialog instead of waiting for focus on its disabled parent. Version the native helper contract together with the extension.
- 9039517: Preserve model-facing schema bounds and null alternatives, ship Windows Computer Use schemas with the extension, and distinguish invalid observation references from focus changes. Add installed-tool and real Notepad typing regression coverage.
- c6ee82d: Update bundled OpenAI connections transactionally with private dependencies, consent for local changes, and rollback; preserve workflow cancellation distinctly in execution results, persisted history, cron and desktop instead of reporting Stop as a failure.
- b01809e: Record optional provider-call stage timings on response events to distinguish context preparation, hooks, local stream handling and adapter/network/provider waiting without changing model requests or tool execution.
- ba2fd8f: Add GPT-6 Astra to the static OpenAI and ChatGPT OAuth model catalogs without changing selected models or provider transports. Use separate API and conservative OAuth context budgets.
- 942df0d: Prevent Windows Computer Use from terminating when an observed control contains more than 512 UTF-16 code units. Preserve bounded Unicode text through an owning Windows Runtime string and cover truncation with native and installed-fixture regression tests.
- bbd22ac: Repair legacy workflow schedule creation times and preserve schedule identity, run history and user pauses during synchronization. Distinguish native Computer Use panel Stop from a helper crash.
- f13cda7: Add confirmed workflow deletion with schedule tombstones and prefer the bundled CLI over stale writable copies.
- ba473d9: Persist workflow-scoped approvals and expose decisions/revocation in the desktop. Gate direct workflow tool steps with the shared dispatcher and cancel work before shutdown disposers. Coordinate permission-window focus without replaying input (native Computer Use protocol 4, runner protocol 13).
- Updated dependencies [9039517]
- Updated dependencies [c6ee82d]
- Updated dependencies [b01809e]
- Updated dependencies [46136ab]
- Updated dependencies [f13cda7]
- Updated dependencies [ba473d9]
  - @moxxy/sdk@0.41.0

## 0.40.0

### Minor Changes

- 7e47604: Raise the supported Node floor from 20.10 to 20.19. Node 20.10 through 20.18 are no longer supported; upgrade to Node 20.19 or newer (22.x and 24.x remain supported). The floor moved so the toolchain can take security-patched dependencies that require `node:util.styleText`, which landed in Node 20.12.

### Patch Changes

- Updated dependencies [7e47604]
  - @moxxy/sdk@0.40.0

## 0.39.0

### Minor Changes

- 1d983d9: Fix Windows desktop packaging, shell-free command launchers across supported Node versions, first-launch plugin readiness, optional Local Piper installation without Git with accurate progress and automatic recovery, OAuth browser handoff, reliable provider activation, and live local-model discovery with persistent exact model selection and Ollama runtime context-window accounting.

### Patch Changes

- Updated dependencies [1d983d9]
  - @moxxy/sdk@0.39.0

## 0.38.0

### Minor Changes

- 971fd32: Browser: accessibility-first perception, named tabs, and a much cheaper live view.

  The agent now reads pages as an accessibility tree where every interactive
  element carries a `[uid]` it can act on, instead of choosing between a wall of
  `innerText` and a screenshot — neither of which it could click, which is why it
  had to guess CSS selectors. New tools: `browser_snapshot`, `browser_click`,
  `browser_type`, `browser_navigate`, `browser_tabs`. `browser_session` remains
  as the escape hatch for CSS selectors and in-page `eval`.

  Every snapshot carries the open-tab list (so the agent never has to ask which
  page it is on), frames page content as untrusted data, and redacts
  credential-shaped field values before they reach the model.

  Acting on a `uid` from before a navigation now fails with a clear "take a fresh
  snapshot" rather than clicking whatever occupies that position now.

  The live preview no longer streams while nobody is watching, skips frames
  identical to the last one, and renders at CSS scale rather than 2x — the same
  view at roughly a quarter of the pixels.

  Desktop: the browser pane now hosts pages in real Chromium views the window
  composites (Electron `<webview>`s main hardens at attach time), instead of
  receiving a JPEG several times a second. Tabs stay mounted so a background page
  keeps its state, and the agent drives those same views over CDP through a
  private, token-authenticated socket — so the human and the agent look at one
  document, which is what makes watching the agent work, and taking over from it,
  possible at all. Outside the desktop (CLI, headless, a remote runner) the tools
  fall back to the Playwright sidecar unchanged.

  `browser_capture` restores region capture on top of CDP: pass a uid and it crops
  to that element rather than shipping a whole viewport.

  The agent can now stop and hand the browser to you. `browser_await_human` puts a
  banner on the pane saying what it needs — a sign-in, a one-time code, a consent
  screen — and blocks until you click Done or Skip. While it is pending the agent
  is not reading the page, so nothing you type during a hand-off is snapshotted,
  logged, or sent to the model, and every uid from before the pause is invalidated
  afterwards. Tab changes the agent makes are pushed to the pane, so the tab strip
  can no longer disagree with the page in front of you. `browser_history` gives
  back/forward/reload the same treatment.

- 16b0fe3: Reading a page costs what changed, and a sequence of actions costs one read.

  The whole accessibility tree on every read is what a heavy page cost: ~25,300
  tokens for a Wikipedia article, ~9,700 for Canva's home page, almost all of it
  identical to the read before because the agent had clicked one thing. One Canva
  task came to 2.2 million tokens, nearly all of it re-sending a page that had
  barely moved.

  Two things were in the way, and both are now gone.

  **uids meant a position, so nothing could be called unchanged.** They were handed
  out by a counter in document order, so inserting one element renumbered
  everything below it — measured on a Wikipedia article, one added element left 1%
  of the rendered lines matching. Chromium's own accessibility node ids do not
  move: after that same insertion, all 17,644 nodes carrying a DOM node kept
  theirs and none changed. uids are now short labels minted against those and
  remembered for the life of the document, so a uid means the same element read
  after read. They survive the tree being handed back for being idle — measured
  too: after `Accessibility.disable`, a detach and a re-attach, 1,636 nodes kept
  their ids — and they are dropped when the page actually navigates, including a
  navigation the person started by clicking a link.

  **Every read sent the whole page.** After the first read of a tab, a read now
  carries only what was removed, added or changed, keyed by uid so a row that
  merely shifted down is not reported as a change. The comparison runs over the
  rendered text, so it is exactly what would have been sent, with no second
  implementation of the pruning rules to drift. `full: true` asks for the whole
  tree when the changes alone are not enough. Measured: a Wikipedia article after
  one element appears, 25,345 tokens down to 1,136.

  **And `browser_batch`**, because the other half of the cost is one read per
  action. It runs a sequence — click, type, press, navigate, go back — and reads
  the page once at the end. Steps stop at the first failure and the error names
  which step it was, so a sequence never carries on against a page that did not do
  what was expected. One approval covers the whole thing and shows every step,
  which is more informative than four prompts answered in a row.

  Measured end to end: opening Canva and creating an Instagram post project went
  from about 1.4 million tokens to 501 thousand.

- 87e3e10: The agent can press keys, and the browser skill knows about the tools it has.

  There was no way to send a key at all. An agent that needed Cmd+A to replace what
  a field already held had nothing to reach for — and, watched live on Canva, it
  went looking for a different browser rather than report that it could not press a
  key. `browser_key` closes that: `Enter` to submit, `Escape` to dismiss, `Tab` to
  move on, `Meta+a` then `Backspace` to empty a field. Modifiers combine with `+`.
  The sidecar backend has had this since the beginning; only the desktop was
  missing it, so a task's outcome depended on where it ran.

  `Input.insertText` looked like the shorter road for a single character and is not
  one: on its own, after the click that focused the field, it does nothing at all.
  A key event carrying its `text` is what actually types, which is what this sends.

  Getting a key to land took two more things, both found by watching it fail in the
  app rather than in a test. A key only reaches the page when the `<webview>`
  ELEMENT has focus in the window's DOM — and answering the approval prompt takes
  that away, because answering means clicking in the app. `webContents.focus()`
  from main does not fix it: the guest is a child of the embedder, so main now asks
  the pane to focus the element and waits for it to say it has. And a hidden view
  cannot take focus at all, so the pane brings the agent's tab forward first —
  which is the honest thing anyway, since the agent is about to act there and this
  browser exists so the user can watch that happen.

  The cost is one deliberate side effect: pressing a key moves keyboard focus off
  the composer and brings the agent's tab to the front. There is no way around it —
  Chromium will not deliver a key to a page that is hidden and unfocused — so it is
  scoped to `browser_key` alone. Reading and clicking leave focus where it is, and
  a test says so.

  The browser skill had drifted badly. It still described driving pages by CSS
  selector and its `allowed-tools` listed only `browser_session`, so an agent that
  loaded it was told to use none of the perception tools built since. It now
  describes reading a page as an accessibility tree, acting by uid, and handing
  over when a page needs a person — with `browser_session` named as the escape
  hatch below that, which is where it belongs.

  Nothing failed while the skill was stale, which is the point: a skill naming a
  tool that does not exist is silently dropped, and one omitting a tool that does
  exist just quietly withholds it. Two tests now tie the skill's `allowed-tools` to
  what the plugin actually ships, in both directions.

  Known limit, found and not yet chased: on canva.com the agent correctly stops at
  the cookie banner and hands over, but the banner is pinned to the bottom of the
  page viewport and that sits below the visible edge of the pane — so the person
  has nothing to click and the hand-off repeats. Whether the `<webview>` is taller
  than its container or the window was simply too short is unmeasured. Any page
  with something fixed to the bottom is affected, not just Canva.

- 396319f: The browser searches with Google, and says when a page has stopped being
  readable and started asking for a person.

  Some pages are not pages any more: a cookie banner, a CAPTCHA, a sign-in form.
  The agent must not clear any of them — the consent belongs to the user, the
  CAPTCHA is theirs to solve, the password is theirs to type — and an agent that
  presses "Accept all" on someone's behalf has made a decision nobody asked it to
  make. Every acting tool is already permission-gated, so this is not the only
  guard; it is the one that arrives before the model has to work out what it is
  looking at from a pile of buttons. The snapshot now carries a `### Needs you`
  section naming the wall and telling the agent to call `browser_await_human`
  instead of clicking through it.

  Detection reads the accessibility tree, not the prose: the words have to sit on
  something pressable, so an article about cookies is still an article. Where a
  page is several walls at once, the most blocking one is named — a sign-in behind
  a CAPTCHA needs the CAPTCHA cleared first. The credential vocabulary is now
  shared with the redactor rather than copied, because a security regex with two
  copies is a security regex with two behaviours.

  A new tab and a typed phrase now go to Google rather than DuckDuckGo. On a
  profile that has never been there Google answers with the EU consent wall, which
  is exactly the case above: the agent hands over, the user answers once, and the
  persistent partition remembers it.

### Patch Changes

- 971fd32: The agent's browser tools all drive the page you are looking at.

  `browser_session` built its own call bound straight to the Playwright child,
  skipping the backend switch every other browser tool goes through. Inside the
  desktop that launched a SECOND Chromium — none of the signed-in profile,
  invisible to everyone — and the agent worked in that one while the person
  watched the real page sit still. Asked to play a YouTube video, the agent
  reported that it had, and was telling the truth about a browser nobody could
  see. It now routes through the same switch as the rest of the plugin, and the
  Playwright child is only reached for when it is the backend answering.

  The desktop bridge grew the verbs that switch then delivers: `click` and `fill`
  by CSS selector, `text`, `html`, `eval` and `screenshot`. Selector lookup
  retries while the page settles rather than failing on the first miss, and `fill`
  selects what a field already held so the insert replaces instead of appending —
  by selection, not by assigning `.value`, which is the only form a
  framework-controlled input sees. The sidecar's `close` is a no-op here: that
  browser is the user's, on screen, holding their logins.

  The pane's active tab and the tab the agent is working on are now separate. They
  were the same value, so a person clicking a tab mid-task silently re-aimed the
  agent's next un-targeted command at the page they had just opened. The agent's
  aim moves only when the agent names a tab or opens one, and is forgotten when
  that tab closes.

- 94ff81b: A page only counts as waiting on a person when there is something real to press —
  and the person is shown it before they are asked.

  The wall detector reads the accessibility tree, which is enough to spot a
  consent button or a password field and not enough to know either is drawn. A
  control can sit in the tree without being on screen — hidden by opacity, moved
  away by a transform, inside a collapsed container, or simply left behind after
  the banner it belonged to was dismissed. Reported as a wall, one of those traps
  the agent in a hand-off nobody can answer: the person is told to press something
  they cannot see, presses Done because there is nothing to do, and the next read
  says exactly the same thing.

  Seen live on canva.com, where the agent asked three times running for a cookie
  choice the user could not find. The banner had been real earlier in the session
  and was gone by the time they looked.

  `detectWall` now names the node it matched, and the callers — which do have
  geometry — check something is actually laid out for it before believing it. Both
  backends do this: the desktop through `DOM.getBoxModel`, the sidecar through the
  point lookup it already uses to decide whether a uid can be clicked.
  `formatSnapshot` no longer decides for itself; it renders what it is told,
  because telling a wall from a control that merely exists needs more than the tree
  it is given.

  A box is layout, not visibility — an element far down the page has a perfectly
  good one — and that is on purpose: a consent banner below the fold is still a
  real wall. Being _shown_ it is a separate job, and it belongs to the hand-off.
  Raising one now brings its tab to the front, scrolls to the control, and asks the
  page whether the element actually landed in view. When it did not, the banner
  says so and tells the person to go looking, rather than asking them to press
  something that is not on their screen — which is precisely how a hand-off turns
  into a loop: press Done, nothing changed, asked again.

  Also settled while chasing this: the pane's `<webview>` is not taller than its
  container. A capture of the guest viewport matches what the pane shows — so the
  suspicion recorded in the previous commit was wrong, and pages with something
  fixed to the bottom are fine.

  The pattern that decides what a consent control looks like was too loose. It
  matched bare stems — `akceptuj`, `więcej opcji` — and Canva's account menu is
  called "Więcej opcji konta i zespołu", so every snapshot of a logged-in Canva
  reported a consent wall that was not there. The agent, trusting the section,
  asked the user to answer a cookie banner that did not exist; pressing Done
  changed nothing, so it asked again. Three times, over an hour, before the
  hand-off banner started naming the control it had found — at which point the
  account menu identified itself in one screenshot.

  A control now counts as consent if its label mentions cookies, or uses a phrase
  that appears nowhere but a consent banner. Over-matching here is not a small
  cost: it sends the person looking for something that is not there.

  The hand-off banner names the control from now on. It is the difference between
  "I cannot see it" and "I am looking at the wrong thing", and it turned an hour of
  guessing into one screenshot.

- Updated dependencies [971fd32]
  - @moxxy/sdk@0.38.0

## 0.37.2

### Patch Changes

- e18e120: Return stable HTTP error bodies without exposing parser or request-stream internals.
- 84dd2c5: Harden network caches, browser launching, managed configuration, HTTP errors, and client view state against unsafe input.
- 62042eb: Reconcile chat and Focus activity with live foreground turns after runner restarts.
- Updated dependencies [84dd2c5]
  - @moxxy/sdk@0.37.2

## 0.37.1

### Patch Changes

- 4d89d64: Harden temporary files and remove filesystem race windows from runtime reads.
- 945202d: Redesign the TUI transcript, compact boot mark, multiline composer, resilient clickable links, reading column, quiet mode/managed-profile/model/context footer, semantic live activity, tool details, mode switching, and slash-command discovery for a calmer developer-alpha experience; add a built-in read-only `plan` mode with revisable plans and deliberate handoff to `default` or `goal`; consolidate collaboration controls behind one `/collab` entry point, repair stale desktop seed manifests before extension installs, and load discovered extensions in dependency order.
- e80b9d6: Replace vulnerable regular-expression parsers with bounded linear-time input scanners.
- abd9482: Harden HTML, URL, command argument, and frontmatter sanitization across user-facing runtimes.
- 5e4ca9f: Patch vulnerable dependencies, enable continuous security scanning, and harden Metro image parsing.
- Updated dependencies [e80b9d6]
- Updated dependencies [abd9482]
- Updated dependencies [5e4ca9f]
  - @moxxy/sdk@0.37.1

## 0.37.0

### Minor Changes

- 78938f8: Introduce the developer-alpha product contract and personal golden path, redesign the TUI around a one-time workspace welcome, contextual work status, consequence-first approvals, responsive Runs, Models, and product-facing Extensions, progressively disclose CLI and TUI commands by capability, auto-allow real-path-safe reads inside the workspace, and add bounded data-only client chrome slots for extensions.

### Patch Changes

- Updated dependencies [78938f8]
  - @moxxy/sdk@0.37.0

## 0.36.1

### Patch Changes

- 9d343c0: Trim the Anthropic API catalog to the four current Claude models

  The picker still offered `claude-opus-4-7`, `claude-opus-4-6` and `claude-sonnet-4-6`,
  listed Haiku under its dated id, and pinned the default at `claude-sonnet-4-6`. The
  catalog is now `claude-fable-5`, `claude-opus-5`, `claude-sonnet-5` and
  `claude-haiku-4-5`, which matches the Claude Code catalog and the ids Anthropic
  documents today. `claude-sonnet-5` becomes the default (direct successor of the
  previous one) and gets its real 128k output ceiling instead of 64k; key validation
  and the `config_init` template move to current ids as well. Older generations are
  still served by the API and can still be pinned in config, they are just no longer
  offered in the picker.

  - @moxxy/sdk@0.36.1

## 0.36.0

### Minor Changes

- bc7844e: Bound a session's context by policy instead of by how long it has been running, and give the desktop a real keymap.

  A new default compactor (`segments`) records every finished turn as one dense sub-session record (Asked / Did / Outcome / Facts / Open) that replaces the turn's raw events in context. Once the index of records passes its cap the oldest fold into a chapter, so the index is bounded too. Nothing is lost: the event log keeps every original event, the new `session_recall` tool searches the records, and `recall({ turnId })` restores one sub-session verbatim. `summarize-old-turns` stays registered as the protected floor and is selectable via `plugins.compactor.default`.

  SDK: compaction ranges now supersede any earlier range they fully contain (`activeCompactionRanges`), which is what lets a compactor re-compact its own summaries; projection and the token estimate share that one decision. `summarizeWithProvider` is extracted so compactors don't each re-implement the summarize-or-degrade-but-never-on-abort contract.

  Desktop: one registry-backed keymap with a single window dispatcher: ⌘K palette, ⌘L composer, ⌘F search, ⌘. interrupt, ⌘N session, ⌘⌥↑/↓ session switching, ⌘B sidebar, ⌘J workbench, ⌘1-5 destinations, ⌘, settings, ⌘/ for the shortcut sheet, which renders from the live registry so it cannot drift from what is bound.

  Also fixes a pre-existing name drift: the CLI's compactor floor and built-in default referred to `summarize`, but the def is named `summarize-old-turns`, so neither ever matched.

### Patch Changes

- Updated dependencies [bc7844e]
  - @moxxy/sdk@0.36.0

## 0.35.4

### Patch Changes

- 051f405: Trim the Claude Code subscription catalog to the four current models

  The picker still offered `claude-sonnet-4-6`, `claude-opus-4-7` and `claude-opus-4-6`,
  and pinned the default at `claude-sonnet-4-6`. The catalog is now `claude-fable-5`,
  `claude-opus-5`, `claude-sonnet-5` and `claude-haiku-4-5`, with `claude-sonnet-5` as
  the default (direct successor of the previous one). Haiku moves from the dated
  `claude-haiku-4-5-20251001` id to the alias, and `claude-sonnet-5` gets its real
  128k output ceiling instead of 64k.

  - @moxxy/sdk@0.35.4

## 0.35.3

### Patch Changes

- @moxxy/sdk@0.35.3

## 0.35.2

### Patch Changes

- @moxxy/sdk@0.35.2

## 0.35.1

### Patch Changes

- @moxxy/sdk@0.35.1

## 0.35.0

### Patch Changes

- 148812c: Fix the workflows `fileChanged`-across-two-runners test, which was still failing after being declared fixed.

  The earlier attempt treated it as a timing budget and raised the timeout. It is not a timing problem: `fs.watch(dir, { recursive: true })` is FSEvents on macOS and is not delivering yet when the call returns, so the single write issued right after boot fell into that gap and was dropped outright. No amount of waiting rescues a dropped event, which is why the bigger budget changed nothing.

  The test now writes in a bounded retry loop and stops at the first observed run. Retrying cannot weaken the at-most-once assertion it exists for, because duplicates collapse twice over: the 600ms debounce coalesces events per watch key, and the `wf-file:` fire lock (3s TTL) coalesces fires per key across both runners.

  No production code changed.

- Updated dependencies [57f0810]
  - @moxxy/sdk@0.35.0

## 0.34.0

### Minor Changes

- ae16897: Ship the audit trail to a central collector: `moxxy security audit-export`, plus a built-in OTLP exporter.

  The local trail answered "what happened on this machine". A fleet needs one place to ask, and a chain head the workstation cannot rewrite. Configure `audit.export.endpoint` and run the command from cron; it exits 1 when it could not drain, so a collector unreachable for a week is visible rather than silently logging "sent 0".

  An exporter is a READER of the already-written trail, driven by a checkpoint, not a second write path. That is what makes shipping survivable: a network sink has to decide mid-turn whether to block, drop, or buffer when the collector is down, while an exporter just retries from the checkpoint. The local hash-chained file stays the system of record, and configuring an export does not weaken it.

  The checkpoint advances only after a batch is durably accepted, so a crash or failure re-sends rather than skips, and each record carries its chain hash to deduplicate on. A 200 carrying `partialSuccess.rejectedLogRecords` counts as a failure: checkpointing past records the collector discarded is the invisible gap this exists to prevent.

  Records map to OTLP logs rather than traces, spoken over plain `fetch` with no `@opentelemetry/*` dependency, which would have added megabytes to a CLI whose bundle budget is enforced at build time. `auditExporter` is a new registry kind, so another destination is a plugin; like audit sinks, a discovered exporter never activates on its own.

  Exporting needs no model provider and boots no session, so a machine with an expired API key still exports.

  `moxxy doctor` gains an `audit-export` row so a scheduled export that silently stopped (broken cron, expired token, moved collector) is visible: the local trail keeps being written either way, so nothing else would look wrong. The backlog excludes the diagnostic's own session, since booting one to ask the question writes a record and a check that always warns teaches people to ignore it.

- d9ae119: Add an audit trail: a tamper-evident record of what was done and for whom.

  `audit log` previously appeared in this codebase only in comments. What existed was the event log: the conversation, complete and local, with no retention, no export, no tamper evidence, and full of payloads nobody wants forwarded to a SIEM.

  `AuditSink` is a new swappable block, registered like every other, with a protected hash-chained local floor writing owner-only JSONL under `~/.moxxy/audit/`. Each record commits to its predecessor's hash, so removing or editing one breaks every hash after it. `moxxy security audit-log` verifies the chains and exits 1 on a break, so a scheduled compliance check can gate on it. Chaining is tamper-EVIDENT, not tamper-proof: it catches silent selective deletion, which is the realistic threat.

  Records are bounded and redacted at the projection boundary, so a single line is safe to forward. Prompt text is recorded only when `audit.includePromptText` is set; the SHA-256 always is, so a given prompt stays provable without the trail disclosing it. Tool inputs are redacted alongside a hash of the original.

  Off unless `audit.enabled` is set. A discovered plugin's sink is registered but never auto-activated: a sink's whole purpose is to send recorded actions elsewhere, so silent adoption would be an exfiltration path.

  Also new in `@moxxy/sdk`: `redactSecrets` / `redactSecretText`, which mask by value SHAPE as well as by field name, so a bearer token inside a Bash `command` is caught.

- 950c1bb: Add a system config scope, lockable settings, and consent for executable project configs.

  There was no layer above the user's own config, so an organisation could not state "security.enabled is true and you may not turn it off". A system scope (`/etc/moxxy/config.yaml`, `%PROGRAMDATA%\moxxy\config.yaml`, or `$MOXXY_SYSTEM_CONFIG`) now loads first, and its `locked: [...]` dot-paths are stripped from the user, project, and explicit layers before merging. It is YAML only: an executable file there would run as whoever starts moxxy.

  `moxxy.config.ts` is code, executed with your full privileges before the permission engine, the vault, or any isolator exists, and the project search walks upward, so entering a cloned repository ran its config silently. Moxxy now asks first and records approval against the file's content, so an edit asks again. Non-interactive runs skip an unapproved file rather than executing unreviewed code; `moxxy config trust` pre-approves one for daemons and container images, and a system config can set `config.allowExecutable: false` to forbid them outright.

  New commands: `moxxy config trust [file]`, `moxxy config trust --list`, `moxxy config untrust <file>`.

  **Behaviour change:** a project `moxxy.config.ts` that used to load silently now requires one-time approval. YAML configs are unaffected.

- 6d8fdcd: Support outbound HTTP proxies, so moxxy runs on networks that require one.

  Node's global `fetch` ignores `HTTPS_PROXY`, and every provider call goes through it, so on a proxied corporate network the first request failed with an opaque error and no setting fixed it. A global dispatcher is now installed at startup from `http_proxy` / `https_proxy` / `no_proxy`, with full `NO_PROXY` semantics (`*`, domain suffixes, port qualifiers, IPv6). `undici` is imported only when a proxy is actually configured.

  A new `network` config block can override the environment: `proxy: 'off'` forces direct connections, and a URL pins a proxy the user cannot route around by clearing their shell profile. `network.noProxy` merges with the environment's rules rather than replacing them.

  `moxxy doctor` reports the effective proxy (credentials masked) and warns when a proxy is in use without `NODE_EXTRA_CA_CERTS`, which is the usual cause of `UNABLE_TO_VERIFY_LEAF_SIGNATURE` behind a TLS-terminating proxy.

- 220673e: Authenticate to an internal plugin registry.

  The install-policy work let an operator point at an internal mirror, but gave no way to authenticate to it, so a mirror behind SSO was unreachable. `hostCredentialName()` derives a canonical secret name from a host (`registry.example.internal` becomes `MOXXY_CREDENTIAL_REGISTRY_EXAMPLE_INTERNAL`), and the registry fetch sends it as a bearer token on both the index and its signature.

  The credential is resolved through whatever `SecretProvider` the machine has active, which is why there is no separate credential registry: a host credential is a named secret plus a convention, so the store an organisation already plugged in serves these too.

  Authentication decides only whether the index is reachable. The Ed25519 verification is unchanged and still decides whether the bytes are trusted, so an authenticated mirror serving an unsigned index is refused exactly like an anonymous one.

  `Session.resolveSecret` exposes the same resolver tool handlers get, so host-side callers go through the active provider instead of reaching past it to the local vault.

- 57d157c: Add an install policy and a config-pinned plugin registry.

  `moxxy plugins install` ran `npm install` against whatever spec it was given: a bare name, `name@version`, a git URL, or a filesystem path. On a personal machine that is the point. On a managed fleet it meant the supply chain had no boundary, and an organisation had no way to draw one.

  `plugins.installPolicy` takes `open` (the default, unchanged behaviour), `registry-only` (accept only packages the signed Ed25519 index vouches for, which also pins an exact version), or `denied` (nothing installs at runtime, for an image built once and shipped).

  It is enforced inside the install function rather than at the CLI surface, because the `install_plugin` model tool reaches the same path. A policy the agent could route around by asking itself would not be a policy.

  `plugins.registryUrl` moves the index location into config so the system scope can pin an internal mirror. It was previously reachable only through `MOXXY_REGISTRY_URL`, a variable a user can unset, which makes it useless as a control. Whatever the URL serves must still verify against the key baked into the CLI, so this is a source decision, not a trust decision.

  The enterprise profile now sets `registry-only` and locks it.

- 3b7d350: Apply config permission rules, and add anchored path matchers.

  `permissions.allow` and `permissions.deny` were declared in the config schema but never applied: only `permissions.policyPath` was read. The config surface was dead, so there was no way for an operator to push a permission rule at all.

  They now form an immutable layer above `~/.moxxy/permissions.json`: checked first, never written back, and not removable by editing that file, by answering "allow always", or by deleting it. From the system scope with `permissions` in `locked:`, that is a rule a user cannot get rid of. Decision order is managed deny, file deny, managed allow, file allow.

  Two anchored matchers join the existing unanchored `inputMatches`, whose semantics are unchanged. `inputPathPrefix` compares path segments, so `/srv/app` covers `/srv/app/x` but not `/srv/apple`, and `..` is normalised away before comparison. `inputGlob` anchors the whole value, with `*` staying inside a path segment and `**` crossing. An organisation's policy should prefer them: `{ Read: { path: '/etc' } }` as a regex means "contains /etc anywhere", which over-blocks as a deny and over-grants as an allow.

- b25850c: Harden local state and the plugin install path.

  Plugin installs now run npm with `--ignore-scripts`, so a package's (or a transitive dependency's) install hooks no longer execute with the user's privileges before its declared capabilities are ever read. `moxxy plugins install --allow-scripts` opts one install back in for native modules that compile or fetch a binding; the `install_plugin` model tool deliberately cannot reach that flag.

  `~/.moxxy` is now created `0700`, and session transcripts, their sidecars, and `permissions.json` are written `0600`. Files left world-readable by an earlier version are tightened in place the next time they are used. A boot-time janitor removes atomic-write temp files abandoned by a killed process.

  New in `@moxxy/sdk/server`: `ensurePrivateDir`, `ensurePrivateFile`, `pruneStaleTempFiles`, `PRIVATE_DIR_MODE`, `PRIVATE_FILE_MODE`.

- 63b1df5: Attribute the event log to a `Principal`, so a transcript records who acted.

  Until now events carried `source` (a category: user, model, tool, …) but no subject, which meant a transcript proved a machine did something rather than that a person did. Audit, role-based policy, and cost attribution all need the subject, and retrofitting it later is far more expensive than adding it now.

  `EventBase.actor` is a new optional field stamped on every appended event, and `AppContext.actor` exposes the same identity to lifecycle hooks so a policy or audit hook can answer "who is asking". The CLI attributes sessions to the local OS account (`os` issuer, worth exactly as much as local account separation); a channel that authenticates its users overrides it with `session.setPrincipal`.

  Runner protocol v11: `attach` carries an optional `principal`, so a thin client's work is attributed on the runner's authoritative log. Additive, so older clients keep working and their events stay unattributed. `moxxy doctor` reports the identity in force.

  The field is optional on purpose: the event log is append-only and persisted, so sessions recorded before this replay unattributed and must keep doing so. Treat absent as unattributed, never as an error.

- 5a977cc: Add `moxxy profile` and `moxxy sync`: install a baseline, then keep a fleet on it.

  `moxxy profile enterprise` prints a system-scope config with the security controls already set and locked: isolation enforced through a real process boundary, undeclared third-party tools denied, executable project configs refused, audit on. It only prints, and its site-specific entries (proxy URL, audit sink) ship commented out. The file belongs in a root-owned location and a profile that guessed a proxy would be wrong everywhere, so the operator reviews and places it.

  `moxxy sync` reconciles installed plugins against the merged `plugins.packages` manifest, which makes that map the reproducible, reviewable description of what a workstation runs. `--check` reports drift and exits 1 without changing anything, so it gates a provisioning pipeline. Sync installs what is missing and reports what is extra; it never removes a package a user chose to install.

  Extras are identified from the plugin host's own bundled-versus-discovered flag rather than from package names, so the bundled kernel is never reported as drift.

- 3dfc2f3: Make the secret store a swappable block.

  The built-in vault (AES-256-GCM, OS-keychain unlocked) is a good design for one machine and unusable for a fleet: no central issuance, no rotation, no way to revoke a single workstation. Every organisation already runs something that does those three things.

  `SecretProvider` is a new registry-backed block. The vault is registered by the host as the protected floor, so an external store (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, 1Password) sits above it and resolution falls back to the vault for anything the provider does not hold. That makes adoption incremental: point `plugins.secretProvider.default` at a store and move secrets over one at a time.

  A provider that throws is not treated as a miss. An unreachable store or an expired token surfaces as a failure, because silently falling through to the local vault would mean a machine running on credentials the operator believes they revoked.

  Deliberately one block, not two: a host-scoped credential is a named secret with a naming convention on top, so a separate `CredentialProvider` registry would be a second overlapping abstraction to keep in sync.

  Known limitation: `${vault:KEY}` placeholders in config still resolve against the local vault, because config is loaded before plugins register. Tool-facing `ctx.getSecret(name)` goes through the active provider.

- e52e2ed: Add signed policy bundles and `moxxy policy`.

  Permission rules could already be pushed from the system config, which works on one machine. Across a fleet every rule change became a file change on every host, and a host that missed one looked exactly like a host that got it. A bundle is a signed document published once and subscribed to by `policy.bundles`, carrying a revision that lands in the audit trail, so `moxxy receipt` proves which revision any past run executed under.

  A bundle carries permission rules and nothing else. Not `registryUrl`, not a key, not a proxy, not `security.enabled`, and one carrying any of them is rejected rather than quietly stripped. It arrives over the network, so the worst case for whoever controls that host stays "they can deny things and break the fleet" instead of "they can loosen us".

  Loading fails closed: a configured bundle that cannot be verified stops the session rather than running without the rules the machine is supposed to enforce. The last verified copy is cached and carries a session through an outage, re-verified against the pinned key on every read. A bad signature is never treated as unavailable, or anyone answering for the URL could pin a fleet to an old revision by serving garbage.

  `moxxy policy` shows the rules in force with each rule's origin; `--check` exits 1 when a host is serving off a stale cache. The Ed25519 verifier moved to `@moxxy/sdk` as `verifyEd25519`, since policy has to bind on a machine with no plugins installed and a control you can disable by uninstalling something is not a control.

- e52e2ed: Add `moxxy receipt <turnId>`: a verified account of one run assembled from the audit trail.

  The trail already recorded what happened, but answering "who ran this, what set it off, which rules were in force, and what did it cost" meant reading raw JSONL. A receipt is a projection over those records, so asking for one writes nothing.

  Two records were missing for this to be answerable, and both are now emitted when `audit.enabled` is set: a `policy` record at session start carrying a fingerprint over the settings that decide what the agent may do (counts and effective values only, no secrets or paths), and a `usage` record per provider response carrying token counts. The request and the reply stay in the event log where they belong.

  The enclosing chain is verified before a receipt prints. A broken chain marks the receipt and exits 1, so a receipt from a trail with a deleted record cannot look complete.

- 06e81f8: Add `ToolDef.icon` and `tui.density`.

  **Tool icons.** A surface could only guess a tool's icon from its NAME, via a heuristic that recognised the handful of built-ins it was written against, so every plugin-contributed tool drew the same wrench with no way for its author to say otherwise. Tools now declare `icon`, the session snapshot carries it, and the desktop renders the declared choice with the old heuristic kept as a fallback.

  The vocabulary is closed (`ToolIcon`) rather than a free string: surfaces render wildly differently, and a name no surface owns would fall back everywhere, making the field decorative. A fixed set means each surface maps it exhaustively, and the desktop's map is typed as a total `Record` so adding a member fails to compile instead of silently drawing a wrench. That fired during development, when `copy` was rejected and `clipboard` was added deliberately.

  The desktop reads the map from one `session.info` fetch held in context, because a transcript can hold hundreds of tool rows and a fetching hook per row would mean hundreds of identical IPC calls per screen.

  **Transcript density.** `tui.density: comfortable | compact` sits next to `tui.theme` and `tui.hints`, and is togglable from `/settings`. `compact` drops the blank line between transcript entries, which is what a short split pane needs: on 24 rows, half the screen is otherwise separator. Default is unchanged. All 18 separators across the chat components route through one helper, with a test that fails naming any component that hardcodes one again, since a single stray separator would make compact look half-broken rather than absent.

  Also hardens `useActionCatalog`: `api()` throws synchronously when no transport is configured, which the hook's promise `.catch` could not see. Unguarded that escaped the effect and took down whatever rendered the consumer, so a component that merely enriched its output made a configured transport a hard requirement for rendering. It now degrades to the `loaded: false` state it already models.

- 220673e: Stop demanding a vault passphrase on first run.

  The master key was resolved from `MOXXY_VAULT_PASSPHRASE`, then the OS keychain, then a cached key at `~/.moxxy/vault.key`, and finally an interactive passphrase prompt. On macOS the keychain means nobody is ever asked, but on a host without one, a container, a headless Linux box, CI, that prompt was the last resort and a hard stop on a non-TTY.

  A randomly generated 256-bit key now sits between the disk cache and the prompt. It gives the same protection against what this vault is actually for, which is a key leaking through config committed to git, a transcript, or a log. It does not protect against someone who can already read a `0600` file in the user's home; an OS keychain or a passphrase does raise that bar, and `moxxy doctor` now says so when a generated or file-backed key is in use.

  Generation only happens when the key can be **persisted**. A generated key that could not be stored is unrecoverable, so every secret written under it would be lost on the next run; there the prompt is better precisely because the user can reproduce it from memory.

  `vault.requirePassphrase: true` restores the old behaviour, and an operator can lock it from the system scope.

### Patch Changes

- 8c41d00: Cut two vendor SDKs out of the published binary: 5.81 MB to 3.93 MB (-32%).

  Neither was imported on purpose. Reading the string helper `providerApiKeyName` from `@moxxy/plugin-provider-admin` also loaded its factory and with it the ~1 MB `openai` SDK; reading `~/.moxxy/mcp.json` through `@moxxy/plugin-mcp`'s barrel loaded `@modelcontextprotocol/sdk` and its `ajv` dependency. Together that was 1.9 MB, a third of the binary, for two config helpers.

  Both helpers already lived in clean leaf modules, so they are now exported as subpaths (`@moxxy/plugin-provider-admin/key-name`, `@moxxy/plugin-mcp/config-io`) and the CLI and TUI import those instead of the package barrels.

  The build now fails if either SDK reappears. That check lives in the tsup config rather than in dependency-cruiser: cross-package imports in this workspace resolve to `dist/`, which the dep-cruiser config excludes, so a rule there would silently pass forever.

- 5763f92: Add the three documents a security review asks for.

  Everything the enterprise work added was invisible to a buyer: `docs/` had no deployment guide, no threat model, and no statement of what leaves the machine.

  `docs/threat-model.md` names the adversaries considered and, deliberately, the ones that are not, then states what each control is actually worth. It has a section for the places where a name promises more than the mechanism delivers: the audit trail is tamper-evident and not tamper-proof, the vault protects against leakage and not local access, in-process isolation is best-effort by construction, and `inputMatches` patterns are unanchored.

  `docs/data-flow.md` lists every outbound request by host and trigger. There is no telemetry, and the single unattended request is the TUI's version check against `registry.npmjs.org`, which is named rather than glossed over.

  `docs/deployment.md` goes from `moxxy profile enterprise` to a verified workstation, including the step that confirms a locked key actually resists a user override, because a misspelled lock looks exactly like a working one.

  Also corrects `SECURITY.md`, which still described a passphrase fallback the vault no longer demands.

- ff64a0e: Load commands on dispatch: `moxxy --version` goes from 301 ms to 83 ms.

  `bin.ts` statically imported all 24 command modules plus the session bootstrap, so any invocation evaluated the module graph of the entire program. A `--cpu-prof` run confirmed `react/index.js` really did execute just to print a version string, because the TUI channel is reachable from that graph.

  Commands are now dispatched through lazy loaders, so a command pays only for itself. The boot art and tagline moved to a new `@moxxy/plugin-cli/logo-data` subpath, which is a pure data module, so `--help` no longer reaches the Ink runtime either. A test walks the eager import graph from `bin.ts` and fails if the TUI runtime or the session bootstrap becomes statically reachable again.

  The binary grows by about 90 KB (3.94 to 4.03 MB) from esbuild's lazy-initialiser wrappers. That is the trade: a slightly larger artifact for a startup that no longer scales with the number of commands.

- 9e35a56: Surface the swappable blocks during onboarding, and make the audit sink swappable.

  Everything in moxxy is a swappable block: the loop, the compactor, the cache strategy, the isolator, the event store, the audit sink. `moxxy plugins defaults` has always exposed that, but onboarding never mentioned it, so a user could finish setup without learning the central idea and would then reach for config files to change something the swap axis already owns.

  Onboarding now shows what each block resolves to, and offers a swap only for categories that genuinely have an alternative. On a fresh install most hold exactly one registration, and asking "which compactor?" when there is one compactor teaches the user that the wizard wastes their time.

  The `auditSink` registry added with the audit trail was missing from the category-swap surface, so the one block introduced as swappable was the one block you could not swap. It now appears in `moxxy plugins defaults` alongside the rest.

- 779f644: TUI polish: stop leaking bearer tokens into scrollback, drop the banner from piped output, degrade the status line on narrow terminals.

  The permission dialog redacted by field NAME only, so a Bash call's `command` printed `curl -H "Authorization: Bearer sk-ant-…"` verbatim. That is the exact string the dialog exists to show a human, on a terminal that may be recorded or screen-shared. It now uses the SDK redactor, which also masks secret-shaped values inside ordinary fields, so the TUI and the audit trail mask the same things.

  `--help` and `--version` no longer print the 31-row mascot when stdout is not a TTY, or when `NO_COLOR` is set. It stays on an interactive terminal, where it is the product's face rather than noise ahead of the answer.

  The status line now drops segments by terminal width instead of wrapping, which in an Ink flex row reads as broken rather than degraded. Order of loss is version chip, MCP count, model id, context meter, keeping what changes most often. Width is tracked live, so a resize re-tiers instead of freezing the layout at mount.

  The enterprise profile now pins the mobile channel to loopback. It binds `0.0.0.0` by default so a physical phone works out of the box, which on a corporate laptop puts a token-gated listener on the office network.

- 5763f92: Two more tests that measured the machine rather than the behaviour.

  The HTTP channel's auth-disabled test guessed a port in 50000-60000 and copied it onto a second channel with `Object.assign`, which is exactly the `EADDRINUSE` flake the file's own helper exists to avoid. It failed CI on a docs-only PR. It now uses the same `port: 0` plus `boundPort` pattern as every other test in that file.

  The MCP parallel-boot test slept 50 ms per server and required the whole boot under 90 ms. Two parallel 50 ms sleeps routinely exceed that on a loaded suite. It now asserts the property directly by observing how many `listTools` calls are in flight at once, which cannot be wrong because the box is busy.

- dfb644a: Make three load-sensitive tests deterministic.

  Each asserted wall-clock timing rather than behaviour, so a local `pnpm test` could not distinguish a regression from a busy machine.

  `CrossProcessFireLock` used a 15 ms TTL with a real sleep: any scheduling pause between claiming the fresh marker and sweeping expired it too. It now sets file mtimes and passes the already-injectable clock, with no sleep at all.

  The workflows "fires once across two concurrent runners" test raised its `vi.waitFor` budget to 20 s while vitest's default test timeout stayed 10 s, so the generous budget was dead code and the test died first. It now declares its own timeout.

  `isolator-subprocess`'s cooperative-abort test asserted that the production 150 ms grace was enough for a child to be scheduled and flush. `abortGraceMs` is now injectable and the test passes a generous value, so it asserts the mechanism while the production default is unchanged.

  A repo-wide scan found no other test whose internal wait budget exceeds its own timeout.

- acfe644: Resolve `${vault:KEY}` the same way everywhere.

  A placeholder in config was always resolved against the local vault, because config loads before any plugin registers. Meanwhile `ctx.getSecret(name)` inside a tool went through whatever `SecretProvider` the machine had active. The same syntax meant two different things, so an organisation that plugged in an external store found it served tools but not config.

  The placeholder resolver now takes a lookup function rather than a `VaultStore`, and the session re-resolves config through `session.resolveSecret` once plugins have registered. On a machine with no external provider the result is identical and the extra pass is a no-op walk. Existing callers that pass the vault object keep working.

- Updated dependencies [ae16897]
- Updated dependencies [d9ae119]
- Updated dependencies [6d8fdcd]
- Updated dependencies [220673e]
- Updated dependencies [b25850c]
- Updated dependencies [63b1df5]
- Updated dependencies [3dfc2f3]
- Updated dependencies [e52e2ed]
- Updated dependencies [e52e2ed]
- Updated dependencies [06e81f8]
  - @moxxy/sdk@0.34.0

## 0.33.0

### Minor Changes

- b7d2f10: Add a desktop-only Voice Mode with bilingual streaming Local Piper playback, pause-safe voice activity detection, barge-in, resilient offline-voice onboarding, uninterrupted call handoff between chat and Focus Mode, and privacy-safe microphone mute/resume that keeps the hidden audio owner realtime without reacquiring the active stream. Refresh Focus Mode with the animated Moxxy persona, current-task and timed-reply bubbles, and a compact latest-turn mini chat with attachments, Markdown, multiline input, and visible queued turns.

### Patch Changes

- 651449e: Allow scheduler tool calls to omit optional values with blank provider placeholders.
- b241085: Keep text-only Claude turns honest and render clear, settled tool and skill activity in the TUI.
- Updated dependencies [b241085]
  - @moxxy/sdk@0.33.0

## 0.32.0

### Minor Changes

- 3b0c14a: Add provider-hosted web search capabilities with automatic Codex/Claude execution and an automatically installed, pluggable local browser fallback.
- 80823f7: Redesign tool and skill activity as compact expandable traces with live shimmer feedback.

### Patch Changes

- Updated dependencies [3b0c14a]
  - @moxxy/sdk@0.32.0

## 0.31.0

### Patch Changes

- 8bb26b1: Stream Claude subscription turns through the installed Claude CLI instead of constructing the Anthropic API provider directly.
- 43926ab: Move provider credential resolution and onboarding metadata to provider-owned contracts and manifests. Unbundled configured providers are installed automatically on first use, while diagnostics now share activation credential semantics and verify both audio capture and transcription readiness.
- f4ae185: Add an opt-in native-tools mode for Claude Code subscription tasks, including workspace, permission-mode, and allowed-tool forwarding without duplicate moxxy tool dispatch.
- a85866c: Advertise Claude Code subscription models independently, persist the pinned default during provisioning, and make rejected model selections actionable.
- bba28c1: Document and verify the installed Claude CLI subscription flow end to end, including opt-in live text/native-tool smoke coverage and clear desktop sign-in outcomes without handling subscription credentials.
- Updated dependencies [8bb26b1]
- Updated dependencies [43926ab]
  - @moxxy/sdk@0.31.0

## 0.30.0

### Minor Changes

- c124a15: `moxxy init`: let OAuth providers with a device-code flow (openai-codex) offer a browser vs. no-browser choice during the wizard, so a headless/remote box can sign in by pasting a URL + code instead of relying on a loopback browser that can't open. Providers advertise the capability via `ProviderAuthDescriptor.supportsHeadless`; `ProviderSetupView.loginOAuth` now accepts an optional `{ headless }`.

### Patch Changes

- Updated dependencies [c124a15]
  - @moxxy/sdk@0.30.0

## 0.29.0

### Minor Changes

- d99087f: New iMessage channel (`moxxy imessage`): drive moxxy from iMessage via a
  localhost BlueBubbles server (macOS only). v1 sends text with the stock
  apple-script method and receives via the BlueBubbles socket.io `new-message`
  feed; 1:1 text chats only. Trust is a vault-stored server URL + password plus a
  JSON handle allow-list, with your own self-chat allowed via a separate owner-handle
  list; unknown senders are dropped silently and the channel's own echoes are
  filtered. Runs on a dedicated isolated runner with `sessionSource: 'imessage'`.
  Subcommands: `setup` (interactive wizard), `status`, `unpair`. Wires
  `'imessage'` into SDK `SESSION_SOURCES`, the plugins-admin install catalog, and
  the desktop channel catalog.

### Patch Changes

- Updated dependencies [d99087f]
- Updated dependencies [f360bf6]
  - @moxxy/sdk@0.29.0

## 0.28.1

### Patch Changes

- 6c0af71: Tech-debt backlog cleanup pass.

  - CLI: new `moxxy channels rotate-token <name>` verb wrapping the SDK-only `rotateChannelToken` (SECURITY.md's hardening checklist recommended rotation but nothing exposed it).
  - CLI: standalone `moxxy mobile` now stamps `MOXXY_SESSION_SOURCE=mobile` (via a declared `sessionSource` on the channel def) so the empty pre-first-prompt session is no longer mis-stamped `tui` and dropped from the mobile list.
  - SDK: `resolveModelContext` no longer SILENTLY falls back to the first model descriptor on an unrecognized model id — it emits a one-shot `console.warn` (deduped per provider/requested-id/fallback-id) so a wrong context-window calibration is observable.
  - Desktop: compile-time partition of the app-bridge method sets (`RENDERER_DISPATCHED_METHODS` vs the host `BridgeServices` map) so a mis-/un-classified method is now a `tsc` error rather than a runtime-test-only check.
  - Desktop: the keyless `local` provider no longer prompts for a non-existent API key in the Configure sheet.
  - Desktop: stop Vite emitting a ~21 MB orphan ONNX-Runtime wasm into `dist/assets/` on every bundle (the runtime loads ORT from `/ort/`; the emitted copy was dead); the real anonymizer wasm is untouched.
  - Desktop: added a drift guard that fails if the hand-mirrored channel catalog diverges from each plugin's `ChannelDef.config`.

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1

## 0.28.0

### Minor Changes

- 3e4b2b4: Goal mode refactor: deliver the outcome, then get out of the way. Goal runs are now guardrail-free — no iteration cap, no token budget, and a stuck-loop trip steers the model with a nudge instead of killing the run (the only terminals are goal_complete, goal_abandon, an idle stall, user abort, or a genuinely fatal error). Goal mode is also one-shot (`ModeDef.transient`): it arms per objective, hands the session back to the previous mode when the goal concludes, is never persisted as the boot/category default, and channels no longer flip session-wide yolo/auto-approve (the run auto-approves via its own scoped resolver). Also fixes the shared ReAct loop's checkpoint injection budget to be per idle-episode, so long autonomous runs no longer die on their Nth spread-out idle round. SDK additions: `emitRequestsAndNudgeOnStuck`, `stuck.action: 'nudge'` on `runReactLoop`, `StuckLoopDetector.reset()`, `ModeDef.transient`, `ModeContext.previousModeName`.

### Patch Changes

- e4e2941: Extract the shared ReAct loop core into the SDK (`runReactLoop`) with a turn-end checkpoint gate, and refactor the existing modes onto it.

  - New SDK exports: `runReactLoop`, `TurnCheckpoint`/`CheckpointContext`/`CheckpointResult`, loop hooks (`onIterationStart`, `onProviderSuccess`, `onToolBatchEnd`, `onMaxIterations`), and the retry test seam. A mode can now gate the moment the model claims it is done — run lints, spawn a reviewer subagent and await its verdict — and feed the result back into the same turn (persistent checkpoint-origin `user_prompt`, or a volatile nudge).
  - `mode-default`, `mode-goal`, and the collaborative agent loop now share one hardened copy of the loop plumbing (bounded retry back-off, reactive compaction on overflow, elision, stuck detection, abort handling) instead of three divergent ones. Unified semantics: an un-compactable context overflow is now fatal everywhere (goal mode's rule), the collab agent gained the bounded exponential back-off it lacked, and empty truncated completions warn in every mode.
  - Guardrails: per-turn injection budget, per-checkpoint timeout with fail-open, empty/oversized-feedback guards, checkpoint disarm in subagent sessions (`ModeContext.isSubagent`) as a recursion backstop.
  - `TriggerOrigin` gains `kind: 'checkpoint'`; chat-model treats mid-turn checkpoint prompts as in-turn blocks (not turn boundaries) and the desktop renders them as a compact chip.

- 3bf5b52: feat(memory): persistent user model — always-injected `~/.moxxy/memory/user-model.md` + update tool

  A first-class user model (Identity / Preferences / Workflows / Context) is now
  ALWAYS injected into the system prompt as a delimited `<user-model>` block
  (capped at 4000 chars, idempotent per request, error-swallowing). It is updated
  only through the deliberate, permission-prompted `memory_update_user_model` tool
  — never silently written by the loop. The default reflector now steers durable
  user-trait proposals toward this tool, and `moxxy memory user-model` prints the
  current file.

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0

## 0.27.0

### Minor Changes

- f783303: New `moxxy config show|get|set|path` command: read the merged config, print
  a value at a dot-path, and set values (JSON-parsed, schema-validated,
  comment-preserving — the same shared writer the `/settings` panel and the
  `config_set` tool use) from the command line. `--scope user|project` picks
  the target file for `set` (default: user).
- e791484: New Discord channel (`moxxy discord`): a discord.js gateway bot on a dedicated, isolated runner, built on @moxxy/channel-kit. DM code pairing (bot DMs a one-time code, pasted into the terminal wizard), a paired-principal + per-guild-channel allow-list (vault-persisted, managed via local /allow and /deny), edit-throttled streamed replies (≥1200ms, Discord's ~5 edits/5s limit) with 2000-char splitting, button-based permission/approval prompts, session commands published as Discord slash commands, and voice-message transcription. SDK gains the 'discord' SessionSource; the CLI gains the install-on-first-use hint and session-source stamping for it.
- 49b1d73: Install-time capability consent + third-party requireDeclaration ratchet.
  Installing a plugin now surfaces the package's combined capability surface
  (fs globs, net mode/hosts, env, exec commands, time/memory budgets) in
  human-readable rows shared across every surface. Third-party packages
  (outside the `@moxxy/` scope) require explicit consent to stay enabled:
  the TUI opens a fail-closed post-install picker (ESC = decline = disabled),
  `moxxy plugins install` asks a default-NO confirm on a TTY and headless runs
  need `--yes` (otherwise the package is left installed but disabled), and the
  permission-gated `install_plugin` model tool keeps returning the report
  non-interactively. Undeclared tools are called out loudly — their surface is
  unknown, not empty. New `security.thirdPartyRequireDeclaration: off|warn|enforce`
  ('warn' by default while security is enabled) logs a once-per-tool structured
  warning — or denies with 'enforce' — when a third-party tool has no isolation
  declaration; unattributed tools (e.g. runtime-attached MCP tools) are exempt.
  `moxxy security status` prints the new mode.
- 6460cc6: The slim wave's last unbundle: `@moxxy/plugin-memory` moves out of the CLI
  binary as ONE merged plugin (long-term store + memory tools + the tfidf
  embedder + memory_consolidate and its nudge hooks — the two-plugins-in-one-
  package blocker is gone). The store's embedder now resolves lazily from the
  new core-published `embedders` service instead of a bootstrap closure.
  Installs on demand / rides the desktop seed; without it, `moxxy doctor`
  reports a warn ("memory plugin not installed") instead of failing and
  recall degrades exactly as before. The `@moxxy/memory-consolidate` ledger
  key is gone (clean-slate) — enable/disable the one package instead.
- 3b27404: `moxxy onboard` — one guided command from a fresh install to a paired, always-on agent: provider wizard (skipped when configured) → messenger pick from the install catalog → version-pinned install + `moxxy.setup` fields → the channel's own pairing in a new pair-then-return mode (`EXIT_AFTER_PAIR_FLAG` in the SDK, honored by all five pair flows) → a `moxxy serve --all` background unit. Also: channel install hints are now derived from catalog `provides` (telegram/slack/web/http entries gained theirs), Telegram + Slack declare `moxxy.setup` token steps, the `service` catalog's serve unit actually starts channels (`--all`, matching its description), and service units survive Electron-as-node installs (`ELECTRON_RUN_AS_NODE=1` exported into the unit).
- 0b6f40e: Plugin-declared init hooks: plugins can now ship a declarative setup step at
  `package.json#moxxy.setup` (title, required flag, typed fields:
  secret/string/boolean/select). `moxxy init` walks every installed plugin's
  step — secrets go to the VAULT with a `${vault:NAME}` ref written to the
  plugin's `options.<key>` (resolved at boot, never plaintext), other kinds
  persist through the shared schema-validated writer; skipping a
  `required: true` setup leaves the package DISABLED until configured; re-runs
  prefill ("enter to keep"). Installing such a plugin (tool or /plugins picker)
  surfaces `needsSetup` so the user is pointed at the configuration
  immediately. Proof: the HTTP channel declares its bearer token as a required
  secret field.
- 2cff46b: Post-install setup resolves IN the TUI: installing a plugin that declares a
  `moxxy.setup` step now opens a configuration dialog on the spot (masked
  secrets, y/n booleans, select lists) instead of pointing at `moxxy init` —
  values persist through the same shared writer (secrets → vault +
  `${vault:NAME}` option refs). New `/setup [package]` command (re)configures
  any installed plugin and re-enables one left disabled by a skipped required
  setup. New `PluginsAdminView.setupSpec`/`applySetup` seams; the init wizard
  now shares the exact same `applySetupValues` write path.
- 2cef8e1: feat(reflector): swappable `reflector` registry category + `@moxxy/reflector-default` learning loop.

  A new single-active registry category — the learning-loop block that watches a finished turn and _proposes_ memory/skill improvements without ever writing silently. Mirrors the `eventStore` category across all 7 layers (config `plugins.reflector.default`, SDK `ReflectorDef`/`ReflectContext`/`ReflectionProposal` contract + plugin slot, core `ReflectorRegistry`, host registry-kind wiring, session field + `services('reflectors')`, CLI apply/category-swap, catalog), but NULLABLE: core seeds no floor, so reflection is opt-in (like transcriber/synthesizer).

  `@moxxy/reflector-default` (discovery-loaded) ships the default `ReflectorDef` `'default'` AND the driver in one plugin. The driver's `onTurnEnd` runs a cheap gate (≥5 tool results OR ≥1 error OR ≥8 mode iterations) under a one-reflection-per-session budget, then fires the reflection FIRE-AND-FORGET so it never blocks or throws into the turn. The reflector does one cheap side-channel LLM pass over a turn digest and returns 0-2 proposals; those are delivered as a ONE-TIME nudge on the next `onBeforeProviderCall`, phrased so the model MAY call `memory_save` / `synthesize_skill` — which still hit their own permission prompts. No silent writes. Graceful no-provider / provider-error skips; `memory_save` and `synthesize_skill` are declared as optional requirements. User-model injection of proposals is deferred to a follow-up PR.

- 98f545c: Package-level capability aggregation: `moxxy security audit --package <name>` shows one package's tools plus their COMBINED capability surface (widest-wins union via the new `aggregateCapabilitySpecs` in the SDK), `--by-package` prints a declared/total rollup per plugin, and `install_plugin` now reports the just-installed package's capability surface (declared/total + undeclared tool names) next to the registration diff. Tool→plugin attribution comes from the plugin host's loaded records (`PluginHost.ownerOfTool`), which also makes the previously-dormant `security.perPlugin` isolator overrides actually route.
- ee2967d: `/settings` (alias `/config`): a curated in-TUI config panel — reasoning,
  prompt caching, elision, lazy tools, loop guard, plugin security, TUI theme
  and footer hints toggle/cycle in place, persist to the user config through
  the ONE schema-validated comment-preserving writer (new `setConfigValue`,
  which the `config_set` tool now also delegates to), and live-apply via the
  new optional `SessionLike.configAdmin` seam (RemoteSession degrades to
  "applies on restart"). New `tui:` config section (`theme: default|mono`,
  `hints`, `keys` Ctrl-letter overrides for force-send/drop-queued/
  expand-tools) projected onto the TUI's env conventions at launch.
- 67a3387: Signal messenger channel via a signal-cli JSON-RPC sidecar (`@moxxy/plugin-channel-signal`).

  - New installable `@moxxy/plugin-channel-signal`: moxxy joins your Signal
    account as a LINKED DEVICE (like Signal Desktop) through a `signal-cli`
    daemon the plugin fully owns — spawned on `start()` (JSON-RPC over a UNIX
    socket), health-checked (`version` round-trip), and killed on stop with a
    SIGTERM→SIGKILL grace. `isAvailable` gates on the binary with a pure PATH
    scan (no JVM spawn) and returns a `brew install signal-cli` hint instead of
    ever crashing discovery.
  - Pairing is the linked-device flow: `moxxy channels signal pair` runs
    `signal-cli link -n moxxy`, renders the `sgnl://linkdevice…` URI as a
    terminal QR, and stores the account on completion; the desktop Channels
    panel drives the same window via channel-status (`requestUrl` carries the
    QR payload, `connected` flips when linked).
  - Every session-reaching path is gated on a sender allow-list (E.164/uuid,
    vault key `signal_allowed_senders`); the owner's own "Note to Self" is
    allowed by default after linking. Sync echoes of the bot's own sends are
    dropped by sent-timestamp (loop protection), the owner's outbound
    conversations are never reacted to, and every envelope is zod-validated +
    size-capped before touching the session. Voice notes transcribe through the
    session's active Transcriber (20MB cap, install guidance when absent).
  - Replies stream as buffered paragraph-aligned chunk sends plus a typing
    indicator instead of FramePump edits — a Signal edit re-delivers the whole
    body E2E to every device per frame, which burst-rate edits would turn into
    notification spam and rate-limit bait.
  - Runs on its own dedicated, isolated runner (like Slack) — a linked device
    sees all the owner's messages. `SessionSource` gains `'signal'`.

- fa3922e: Slim wave, batches 3+4: `@moxxy/plugin-browser`, `@moxxy/plugin-terminal`
  and `@moxxy/plugin-channel-web` move out of the CLI binary and install on
  demand (all three are in the desktop plugins-seed, so desktop surfaces keep
  working offline). The CLI's `dist/` drops the Playwright `sidecar.js` entry
  and the copied web frontend — a standalone browser install resolves its own
  `dist/sidecar.js`, and the web channel serves its own `dist/public` next to
  its module. `node-pty` moves from the CLI's optionalDependencies into
  plugin-terminal's own (piped-shell fallback without it).
  `@moxxy/plugin-tunnel-proxy` + `@moxxy/e2e` flip public as web's dependency
  closure; `@moxxy/e2e` joins the fixed changeset group so pinned installs
  resolve from their first release.
- 502acf0: Slim wave, final batches: the whisper STT pair, the Telegram + Slack
  channels, provider-admin and mcp move out of the CLI binary — all seeded
  into the desktop (voice, Settings panels and Apps→Channels keep working
  offline) and installable on demand everywhere else. `moxxy telegram` /
  `moxxy channels start slack` on a slim install print the exact install
  command instead of "unknown command". `@moxxy/config` flips public as the
  channels' dependency closure. The kernel is now the plan's target set: the
  TUI, built-in tools, default mode, context floors, vault, plugins-admin,
  commands, memory, the two OAuth providers, and the dormant daemons.
- be28d55: Add a WhatsApp channel via Baileys (`@moxxy/plugin-channel-whatsapp`): QR device-link pairing, a mandatory typed consent gate for the unofficial-API/ban risk, JID allow-list (owner Note-to-Self allowed by default), fromMe-echo loop protection, voice-note transcription, and send-then-edit streaming over a swappable auth-state backend. Runs on its own dedicated isolated runner (`sessionSource: 'whatsapp'`, added to the SDK `SessionSource` union).

### Patch Changes

- e5ea7e6: The LAST config store outside the unified tree is gone: runtime-registered
  (OpenAI-compatible) vendors now persist at `plugins.provider.items.<name>`
  in `~/.moxxy/config.yaml` (`config` carries the vendor payload, `model` the
  default) instead of `~/.moxxy/providers.json`. The provider-admin API is
  unchanged — the tools, the runner's `provider.configure`, and the desktop
  settings sheet all moved with it; the desktop reads the tree directly (yaml
  parse, no @moxxy/config in the Electron main). `provider_remove` refuses to
  touch a built-in provider's item (picker-written model/enabled prefs
  survive). Clean-slate per repo convention: re-add custom vendors via
  `provider_add` or the desktop sheet — no migration shim.
- 720c955: Dead-code cleanup: remove the deprecated `resolveSafe` alias from tools-builtin (no callers remained — use `resolvePath`), and retire/re-point stale archived backlog entries (the CDP screencast sidecar handlers were already deleted in #212; the piped-shell fallback and terminal-sizing constraint notes now point at `packages/plugin-terminal` / `TerminalPane.tsx` where that code actually lives).
- 2a35357: refactor(sdk): surface the shared abort-backoff primitives (`sleepWithAbort`, `nextBackoffMs`) directly on the barrel (they were already exported, but buried in the mode-helpers block) and migrate the ad-hoc retry sleeps onto them: the runner's initial-connect retry + SIGTERM grace waits and the desktop supervisor's restart wait / socket poll / kill grace. All schedules and abort semantics preserved — no behavior change.
- 6f0e6fb: Signed plugin-registry v1, client side: Ed25519-verified `index.json` fetch with a re-verified 1h cache at `~/.moxxy/registry-cache.json` and hardcoded-catalog fallback on any failure (never throws into the install path). Catalog installs that resolve through a signed entry install the signature-covered exact version (pin precedence: user `--version` > signed index > cliVersion lockstep > latest), and `install_plugin` warns when the registered capability surface is wider than the signed manifest. Dormant until a maintainer key is baked into `REGISTRY_PUBLIC_KEY` (empty = disabled, exactly like the desktop update key).
- b2a5fba: Aggregate skill usage into `~/.moxxy/skills/.meta/usage.json` and surface it.

  A new best-effort store in `@moxxy/core` (`skill-usage.ts`) records per-skill-name
  `invocations` counts plus first-`createdAt` / latest-`lastInvokedAt` timestamps.
  `@moxxy/plugin-usage-stats` folds this run's `skill_invoked` / `skill_created`
  events past the same resume/`/new` seq boundary it already uses for token usage
  and merges the delta on shutdown (token behavior unchanged). `moxxy skills list`
  gains a dim `used` column and the `/skills` TUI panel shows a right-aligned `×N`
  badge.

  Known limitation: `skill_invoked` is only emitted by the `load_skill` tool today
  (reason `load_skill_tool`), so counts reflect explicit `load_skill` calls only.
  When trigger-match / classifier emission lands later, the same file simply starts
  counting more — no format change.

- 4c605fc: Validate event-log lines on read instead of casting: session JSONL reads (restore, history paging, index hydration) now pass every parsed line through a shallow structural guard (`isMoxxyEventShape`) and skip wrong-shape lines with the same never-throw semantics as corrupt JSON, instead of trusting them as `MoxxyEvent`s that could crash replay (e.g. a compaction line missing `replacedRange` threw mid-projection).
- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [be28d55]
  - @moxxy/sdk@0.27.0

## 0.26.0

### Minor Changes

- 8c70f3c: Connect a provider without leaving the TUI: picking an unconnected provider
  in `/model` now opens an inline connect dialog that installs the provider if
  needed (pinned npm install), collects + validates an API key (stored in the
  vault, never persisted plaintext), or drives the provider's OAuth sign-in —
  then completes the exact model switch that was picked. Previously the picker
  told you to quit and run `moxxy init` / `moxxy login` and restart.

  New optional `SessionLike.providerSetup` (`ProviderSetupView`) seam; the init
  wizard delegates to the same implementation so wizard and dialog semantics
  cannot drift (a provider without `validateKey` now accepts the key instead of
  pseudo-rejecting it). RemoteSession keeps the old guidance notice.

- ce56ef6: The `/plugins` Installable tab now actually installs: selecting a catalog
  plugin npm-installs it into `~/.moxxy/plugins`, persists the enable,
  hot-reloads the plugin host, and reports which contributions registered —
  instead of printing a CLI command to run elsewhere. New optional
  `PluginsAdminView.install` seam (RemoteSession degrades to the printed
  command).

  On-demand installs are now version-pinned: bare `@moxxy/*` specs resolve at
  the CLI's own version across every install path (`install_plugin` tool,
  `moxxy plugins install`, init's provider/extras steps, the TUI picker), with
  a 404→latest retry for pins an older CLI can't satisfy. The changeset fixed
  group widens to all `@moxxy/plugin-*` + `@moxxy/mode-*` so future releases
  co-version. New `installPluginPackagePinned` / `pinFirstPartySpec` exports.

- 386e526: Slim wave, batch 1: seven plugins move out of the CLI binary and install on
  demand from npm — `@moxxy/mode-goal`, `@moxxy/mode-deep-research` (now
  npm-depends on `@moxxy/plugin-subagents` so one install brings both),
  `@moxxy/plugin-subagents`, `@moxxy/plugin-oauth`,
  `@moxxy/plugin-computer-control`, `@moxxy/plugin-channel-http`,
  `@moxxy/plugin-usage-stats`. All are in the installable catalog (the
  `/plugins` picker installs them one-keystroke; `/goal`, `/collab` and `/mode`
  offer the install at point of use), and `moxxy init` installs a picked
  non-bundled default mode during setup so the written config never floors
  back on first boot. New `scripts/e2e-slim-install.mjs` fresh-install smoke.
- 386e526: Slim wave, batch 2: `@moxxy/plugin-view`, `@moxxy/plugin-self-update` and
  `@moxxy/plugin-voice-admin` (plugin renamed from `@moxxy/voice-admin` to
  match its package) move out of the CLI binary and install on demand.
  `@moxxy/plugin-provider-admin` + `@moxxy/plugin-mcp` (entry alias
  `@moxxy/plugin-mcp-admin` dropped — the plugin now registers under its
  package name) flip publishable as prep but stay bundled until the desktop
  seed pack lands: the desktop Settings panels reach them through the
  `providerAdmin`/`mcpAdmin` session services on the spawned runner.
  self-update's staged-update finalizer stays inlined in the binary (bin.ts
  imports it statically); only the registered plugin instance moves out.

### Patch Changes

- 8c70f3c: Install-on-first-use: asking for a capability whose package isn't installed
  now offers to install it at the point of use instead of failing. `/goal` and
  `/collab` without their mode installed open an install-confirm picker and,
  after the install lands, re-run the original command; the `/mode` picker
  lists catalog-provided modes badged "installs on first use"; `set_default`
  naming an uninstalled contribution throws a typed `PLUGIN_NOT_INSTALLED`
  error carrying the providing package (so the model tool gets an actionable
  hint too). Catalog entries gain a `provides` mapping (category + contribution
  name) that powers the lookup.
- 04738aa: Stop shipping the 16 MB `bin.js.map` sourcemap in the published npm tarball
  (unpacked size drops ~65%; local builds keep sourcemaps). Fix the TUI footer
  hint that advertised `^B toggle skills` — Ctrl+B drops the first queued
  message; the hint row now shows `^O tool detail` instead.
- Updated dependencies [8c70f3c]
- Updated dependencies [8c70f3c]
- Updated dependencies [ce56ef6]
  - @moxxy/sdk@0.26.0

## 0.25.0

### Minor Changes

- f346b38: Make collaboration a fully separate feature that never touches your chats or their sessions.

  Previously `/collab` (and the desktop Collaborate tab) ran the coordinator **inside the active chat session** — it flipped that session's mode to `collaborative` and streamed the whole team's activity into the chat's own event log, so a collaboration polluted the chat thread and its transcript.

  Now the coordinator runs on its **own dedicated runner** — a new internal `moxxy collab` command that boots its own headless Session + runner socket, hosts the collab hub, and spawns the architect/implementer team exactly as before.

  - **Desktop:** the Collaborate panel supervises that coordinator (`CollabSupervisor`) and drives it over a dedicated `collab.*` IPC surface + `collab.event` / `collab.approval` broadcasts (a private `useCollab` hook, not `useChat`). The roster-approval checkpoint is answered inline in the panel.
  - **TUI:** `/collab <goal>` re-points the terminal onto the coordinator's own session (via the same in-place switch `/sessions` uses) and auto-submits the goal there — the roster approval and the live `◆ collab` block render as usual, but on the coordinator's session, not your chat. Bare `/collab` attaches to a running collaboration to view it; `/sessions` returns you to chat while the collaboration keeps running.

  Either way, a collaboration is entirely decoupled from every chat session — no mode-switch, no events in a chat's thread. The roster-approval checkpoint (the one human-in-the-loop gate) is preserved because the attaching UI drives the goal turn, so the coordinator's approval is forwarded to it. The single-flight lock now also records the coordinator's runner socket so a UI can discover and attach to a running coordinator (including one started elsewhere).

### Patch Changes

- dc343bd: Fix Codex `gpt-5.5` / `gpt-5.4` advertising a 1,000,000-token context window when the ChatGPT-plan Codex backend only serves ~400k for these gpt-5-family models. The inflated window pushed the proactive compactor's `estimatedTokens > 0.75 * contextWindow` gate out to ~750k — unreachable before the backend rejected the request — so long sessions always fell through to the reactive compact-on-overflow retry ("context window exceeded — compacted older turns, retrying") instead of compacting cleanly ahead of the limit. Set both to `400_000`, matching the rest of the Codex catalog, so the proactive compactor trips before overflow.
- eb04333: Hydrate resumed session metadata from JSONL history so workspace titles do not fall back to New session.
  - @moxxy/sdk@0.25.0

## 0.24.1

### Patch Changes

- 8df816a: Fix: the Telegram connect step in the desktop Channels panel could stay stuck on "Connecting…" and never show the QR. The dedicated channel runner could be wedged before it published its status file in three independent ways, now all closed:

  - A desktop-spawned channel runner now opts out of the co-attached web surface (`MOXXY_NO_WEB_SURFACE`, mirroring `moxxy serve`). Without it a remote channel (Telegram) opened a proxy tunnel during startup — _before_ the status write — so a slow/unreachable relay blocked it indefinitely; it also raced the fixed web port (4040) with `serve` and other channel runners.
  - The dedicated runner writes its status file _before_ the optional web-surface co-attach, so its readiness/connect value is published independently of that tunnel.
  - The up-front `getMe` (which resolves the `t.me` link) is now bounded by a timeout, so a slow/unreachable Telegram can't wedge `start()` — the channel comes up (and pairing still works) even when the link can't be resolved.
  - @moxxy/sdk@0.24.1

## 0.24.0

### Minor Changes

- f71c8bd: Telegram chat pairing now works from the desktop, via a single QR mechanism used everywhere.

  Previously, starting Telegram from the desktop Channels panel errored with "No Telegram chat is paired yet" — the channel refused to start unpaired and the only pairing path was the TTY-only paste-a-code flow. Now, when unpaired, Telegram opens a host-issued pairing window: it mints a one-time code, publishes a `t.me/<bot>?start=<code>` deep link as its connect value, and the panel renders it as a QR. The user scans → taps **START** in Telegram (or sends the 6 digits) and the chat pairs — zero typing — after which the panel shows "✓ Connected".

  This is the **single** pairing mechanism everywhere: `moxxy channels telegram pair` now renders the same QR in the terminal (and waits for the scan) instead of the old bot-DMs-a-code / paste-in-the-terminal flow, which is removed.

  New SDK surface: `Channel.connected` and `ChannelHandle.onConnectChange`, plus a `connected` field on the channel status file, so a dedicated-runner host can swap the QR for "Connected" live.

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0

## 0.22.0

### Minor Changes

- 1dc1697: Slack bot channel on a dedicated, isolated runner.

  - New built-in `@moxxy/plugin-channel-slack`: a Slack bot that ingests the Slack
    Events API over the self-hosted proxy relay, verifies each request's HMAC
    signature (Slack `v0` scheme + 5-minute replay window over the raw body), acks
    within Slack's 3-second window and then drives the agent in the background,
    dedupes Slack's at-least-once retries, and streams threaded replies via
    `chat.update`. Permissions use an autonomous allow-list
    (`channels.slack.allowedTools`; `['*']` = every tool, `[]` = read-only) — no
    human in the loop — so the bot can act independently. Configure with
    `moxxy slack setup` / `moxxy channels slack pair|status|unpair`; secrets live
    in the vault (`slack_bot_token`, `slack_signing_secret`).
  - Channels can now run on their OWN dedicated runner — an isolated runner socket
    plus a sticky session, separate from the runner serving your desktop/TUI — so a
    channel acts as an independent agent thread that does work separately from
    yours. `slack` is dedicated by default; any channel can opt in with
    `--dedicated` (or `MOXXY_DEDICATED_RUNNER=1`). No runner-protocol change: one
    dedicated runner is still one Session.
  - `SessionSource` gains `'slack'`, so a Slack runner's session is tagged
    distinctly and stays out of the desktop workspace sidebar.

- 069cd0e: Run & control channels (Slack / Telegram) directly from the TUI and the CLI.

  - **`/channels` TUI panel**: a control panel inside the interactive TUI — list the
    configurable channels with live status (running · pid · uptime, plus the Slack
    Request URL once its tunnel opens), enter each channel's secrets into the vault,
    and Start / Stop it without leaving the chat. A channel started here runs
    **detached on its own dedicated runner**, so it keeps serving after you quit the
    TUI and is discovered/stopped from anywhere.
  - **`moxxy channels start|stop|status`**: headless lifecycle verbs for the same
    detached runners — `start <name>` validates the channel is configured (via its
    own availability gate) then spawns it, `status [name]` lists what's running
    (status-file read; instant, no session boot), `stop <name>` SIGTERMs it.
    `moxxy <channel>` (and `moxxy channels <name>`) still run in the foreground.
  - A channel now **self-describes its config** on its `ChannelDef`
    (`config: { fields: [{ label, vaultKey, secret, … }], hasRequestUrl, runHint }`),
    so any control surface renders the setup form + "configured" check from the
    registry instead of a hardcoded table. Slack and Telegram declare theirs.
  - New `@moxxy/sdk/server` runtime helpers power all of the above, keyed entirely
    off the per-channel status file (process-independent): `spawnDedicatedChannel`,
    `liveChannelStatus`, `listLiveChannelStatuses`, `stopDedicatedChannel`,
    `isPidAlive` — stale files (a crashed runner's dead pid) self-heal on read.
  - Fix: the Telegram channel now honors the `MOXXY_TELEGRAM_TOKEN` env override at
    start (precedence: explicit option → env → vault), matching its own
    `isAvailable` gate and error message + Slack's behavior. Previously a headless
    start with only the env var set passed the availability check but then failed to
    boot ("token not found").

### Patch Changes

- 48542df: Make "runs on a dedicated runner" a property a channel declares, and give
  Telegram the same dedicated-runner treatment as Slack.

  - `ChannelDef` gains optional `dedicatedRunner?: boolean` and
    `sessionSource?: SessionSource`. A channel now declares for itself that it
    should run on its own isolated runner (a distinct runner socket plus a sticky
    session, separate from the runner serving your desktop/TUI). The CLI reads
    this generically — there's no longer a hardcoded `name === 'slack'` check.
    `--dedicated` / `MOXXY_DEDICATED_RUNNER=1` remain runtime opt-ins, and a
    caller that already pinned the socket/session id/source (e.g. a supervisor)
    still wins.
  - `@moxxy/plugin-telegram` now declares `dedicatedRunner: true` +
    `sessionSource: 'telegram'`, so the Telegram bot runs on its own dedicated,
    isolated runner with persistent history (`moxxy-channel-telegram`), matching
    Slack. Telegram long-polls, so this needs no tunnel/webhook.
  - `@moxxy/plugin-channel-slack` now declares its dedicated-runner behavior
    explicitly (previously implicit in the CLI). No behavior change.
  - `SessionSource` gains `'telegram'`. `DeskSession.source` in
    `@moxxy/desktop-ipc-contract` now references the single `SessionSource` source
    of truth in `@moxxy/sdk` instead of a hand-copied union.

- f980349: Run Slack & Telegram channels from the desktop, each on its own dedicated runner.

  - **Apps → Channels** (new sub-tab): per channel, enter its secrets (stored in
    the vault), Start/Stop its dedicated-runner subprocess, and — for Slack — copy
    the public Request URL to paste into the Slack app once its proxy tunnel opens.
    The channel runs as a separate isolated session, so its conversation is
    intentionally not shown in the workspace sidebar; the panel manages the runner.
  - New IPC: `channels.list` / `channels.saveConfig` / `channels.start` /
    `channels.stop` + a `channels.status` event (host-only — NOT remote-reachable).
    A `ChannelSupervisor` in `@moxxy/desktop-host` spawns `moxxy <channel>` with
    `MOXXY_DEDICATED_RUNNER=1`, supervises it, and reads the channel's status file
    for the Request URL. Secrets are written to the same in-process vault the runner
    reads, keyed by the names each channel plugin uses (a small static catalog).
  - A dedicated channel runner now publishes a tiny status file
    (`~/.moxxy/channel-<name>.status.json`) with its pid + public ingest URL while
    running, removed on shutdown — so a supervisor can observe it without the runner
    protocol. New `@moxxy/sdk/server` helpers (`writeChannelStatus` /
    `readChannelStatus` / `clearChannelStatus`) + an optional `Channel.requestUrl`
    getter back this.

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0

## 0.21.1

### Patch Changes

- 1a7e4c3: fix(init): persist the setup wizard into `~/.moxxy/config.yaml` + unblock provider publishing

  **`moxxy init` saved nothing usable.** The wizard wrote a legacy-shaped
  `provider:`/`mode:`/`embeddings:` file into the _project cwd_, but the clean-slate
  config schema only reads the unified `plugins:` tree and silently strips those
  top-level keys. A freshly-`init`'d install therefore booted with no active
  provider — the TUI's `No working provider credentials. Tried: .` (empty list).
  init now persists the selections into `~/.moxxy/config.yaml` as
  `plugins.provider.default` (+ `items.<name>.model`, `fallbacks`),
  `plugins.mode.default`, `plugins.embedder.default` and `security.enabled`, via a
  comment-preserving doc merge that keeps the package ledger `ensureProvider` /
  `installPlugins` already wrote — the same store `moxxy provision` and the runtime
  quick-switches use. Like `provision`, the API key stays in the vault under its
  canonical name (no `${vault:...}` ref written).

  **Release publishing.** The new `@moxxy/plugin-provider-*` packages were missing
  `repository.url`, so npm provenance rejected them with E422; and `claude-code` /
  `openai-codex` depended on the still-private `@moxxy/plugin-oauth` (→
  `@moxxy/plugin-vault`). Added the publish metadata to all six providers and made
  `@moxxy/plugin-oauth` + `@moxxy/plugin-vault` public so on-demand provider install
  from npm resolves.

- 2cf7695: fix(tui): hide special modes from Shift+Tab + load history on session switch

  - **Secret modes leaked into Shift+Tab.** The Shift+Tab mode cycle used the raw
    mode registry, so special modes (e.g. `collaborative`, entered via `/collab`)
    showed up in the cycle. It now filters with `isSelectableMode`, matching the
    `/mode` picker. The Telegram `/mode` picker and its by-name callback are
    hardened the same way (special modes are never offered or name-switched).
  - **Session switch didn't load history.** Switching sessions in the TUI (and
    `--resume`) changed the active session but rendered an empty chat body —
    `bootSession` seeds the new `EventLog` directly, which doesn't fire
    subscribers, so `useEventStream` (which only listened for future appends)
    showed nothing while the status-line token count was correct. It now seeds the
    renderer from the history the log already holds.
  - @moxxy/sdk@0.21.1

## 0.21.0

### Minor Changes

- 05df794: `/plugins` now distinguishes **built-in** (bundled) from **installed** (on-demand from `~/.moxxy/plugins`) packages instead of showing everything as "on": the plugin host reports `installed` (manifest present = discovered) and the Packages tab badges core / installed / built-in. The Installable catalog is also populated with the six unbundled API-key providers (anthropic, openai, google, xai, zai, local) so they can be installed from the picker (and the init optional-plugins step).
- e7b6853: Add the headless provisioner foundation for Pillar 3 (slim-core / on-demand setup): a shared `provision()` engine + a `moxxy provision` command + a first-party provider catalog.

  `provision({ provider, model, key, basics })` resolves the provider from the catalog, installs its package (skipping it when it's already registered — i.e. bundled — so it never duplicate-registers), installs accepted basics, stores the key in the vault, and writes the unified `plugins:` config — config last, so a mid-flight failure leaves no half-state. `moxxy provision` drives it headlessly via flags (`--provider anthropic --key … --model …`) or a JSON spec on stdin (`--spec -`) — the same engine the interactive `init` wizard + the desktop first-run will use.

  Safe + additive: providers stay bundled, `init` is unchanged. Includes `pinFirstPartySpec` (pins first-party installs to the CLI version, scoped to provision so it can't break the generic `install_plugin` path) and the `PROVIDER_CATALOG` (slug → package + auth + default model). Rewiring `init` + the actual unbundling/publishing are the gated follow-ups.

- 5c943a3: Slim the bundle + rework init around on-demand providers. The six API-key providers (anthropic, openai, google, xai, zai, local) are no longer bundled into the CLI — they install on demand from npm into `~/.moxxy/plugins` and are discovered by the plugin host, keeping the kernel slim (no eager provider onInit / tool bloat at boot). The two OAuth/subscription providers (openai-codex, claude-code) stay bundled as the out-of-box "sign in" default (and the CLI's credential resolver links their token helpers).

  `init` is reworked: it offers the full provider catalog (loaded + installable), and an `ensureProvider` step installs + enables a not-yet-bundled provider before collecting its key/OAuth. A new optional wizard step lets you install extra plugins. The shared `provision()` engine + `moxxy provision` (flags or `--spec -`) drive the same install→vault→config flow headlessly.

  Also: the six private provider packages are flipped publishable + added to a fixed changeset group (co-version with cli/sdk/core), and a latent bug is fixed — plugin discovery now honors `MOXXY_HOME` (matching where installs land), so an installed provider is reliably discovered + activated.

### Patch Changes

- 074f845: Make the stuck-loop guard more tolerant + configurable. The detector was tripping turns too eagerly — its exact-repeat threshold was 3 (the same tool+input 3× in a window of 8), which legitimately-repeated work (re-reading a file, re-running `git status` across steps) could hit. Raised the defaults to exact=8 / near=10 / window=12, since `maxIterations` (500 in default mode) is the real runaway backstop and the guard only needs to catch a _tight_ same-call loop.

  It's now tunable via `context.loopGuard` in config: `enabled` (set `false` to disable the guard entirely and rely on `maxIterations`), `windowSize`, `repeatThreshold`, `nearWindowSize`, `nearThreshold`. Threaded through the session → ModeContext → every loop strategy (default, goal, collaborative + subagents), and live-reloadable.

- 3a4b604: Add a generic "special mode" mechanism. `ModeDef.special` (a `ModeSpecial` descriptor, optionally `{ invokedBy }`) marks a mode that is entered only via its own invocation — never offered in a mode list and never name-switched from `/mode`. Special modes are filtered uniformly via the new `isSelectableMode` predicate across every surface: `SessionInfo.modes` (mobile/desktop), the TUI `/mode` picker + by-name switch (which now points the user at `/<invokedBy>`), and the `/plugins` swap axis. The collaborative modes (`collaborative`, `collab-architect`, `collab-peer`) opt in — they're a separate system launched by `/collab` (TUI) or the desktop CollaboratePanel, not a pickable mode. Extensible: future special modes set the same flag.
- d924a73: TUI: multi-session switcher (`/sessions`).

  - New `/sessions` slash command (alias `/switch`) opens a `ListPicker` overlay
    listing your saved conversations — first-prompt title, last-active time, event
    count and active model — sourced from the same `~/.moxxy/sessions` index the
    desktop sidebar and `moxxy resume` already read. The session you're in is
    marked, and a leading **+ New session** entry starts a fresh conversation.
  - Picking an entry re-points the TUI onto that session in place: the live session
    is torn down (firing its `onShutdown` hooks and releasing the runner socket),
    the chosen session is booted (resuming its persisted history, or a fresh one),
    and the chat view re-mounts onto it. Your previous conversation stays saved, so
    you can switch back and forth.
  - Works when the TUI hosts the session (the default self-host / `--standalone`
    modes). When attached to an external `moxxy serve` (whose runner owns a single
    fixed session) the switcher degrades to a notice pointing at `moxxy resume`.

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0

## 0.16.0

### Minor Changes

- 2ccd62e: EventStore registry — make the session event-log storage backend swappable (Pillar 2).

  The JSONL persistence behind a session's event log is now a registry kind (`eventStore`) like any other swappable block, behind a new `EventStoreDef` contract (`open(scope)` for the write path; `restore`/`readPage` for resume + history paging). Core seeds the built-in JSONL store (`~/.moxxy/sessions/<id>.jsonl` + meta sidecar) as the **protected floor** — a thin adapter over the existing `SessionPersistence`, so behaviour is byte-identical.

  A plugin can contribute an alternative store (SQLite, remote, encrypted, in-memory). Because the kind uses throw-on-duplicate `register` (not override) and the floor auto-adopts first, a discovered store is registered but never silently activates — the user opts in by name via `plugins.eventStore.default`. Since the store sees every event (prompts, tool I/O), that explicit opt-in is the trust boundary. The floor can be swapped but never removed, and a boot assertion guarantees a session always has an active store.

  `SessionMeta`/`SessionSource`/`EventPage` moved to `@moxxy/sdk` (the contract's data shapes) and are re-exported from `@moxxy/core` — no importer churn.

- 2ccd62e: Unified `plugins:` manifest + critical floor (Pillar 1).

  Replace the three overlapping config stores (the flat `provider`/`mode`/`compactor`/`workflowExecutor` keys, the package-keyed `plugins:` map, and `~/.moxxy/preferences.json`) with a single category-grouped `plugins:` tree in `~/.moxxy/config.yaml`:

  - **`plugins.packages.<pkg>`** — the install/enable ledger (one entry per npm package).
  - **`plugins.<category>.{default, items}`** — the swap axis, one slot per registry kind, keyed by contribution name (e.g. `plugins.provider.default: anthropic`).

  A **critical floor** makes the platform unbreakable: core default modules can be _swapped_ to another registered implementation but never _disabled_ — a missing/typo'd default reverts to a protected built-in floor, kernel packages refuse to be disabled (`PLUGIN_PROTECTED`), and a boot assertion guarantees every non-nullable slot is filled.

  New swap surfaces: the `set_default`/`list_defaults` model tools, `moxxy plugins set-default`/`defaults`, the TUI `/plugins` **Defaults** tab, and a `PluginsAdminView.categories()`/`setCategoryDefault()` view contract.

  `preferences.json` is retired: the persisted provider/mode/model/disabled-set now live in the same tree, written through `@moxxy/config` (`setCategoryDefault`/`setProviderModel`/`setProviderEnabled`). **Breaking (pre-1.0, no back-compat):** existing `~/.moxxy/config.yaml` files using the old keys must be rewritten; `moxxy init`'s output and `config_init`'s template emit the new shape.

### Patch Changes

- 9bff8a1: Make the stuck-loop guard more tolerant + configurable. The detector was tripping turns too eagerly — its exact-repeat threshold was 3 (the same tool+input 3× in a window of 8), which legitimately-repeated work (re-reading a file, re-running `git status` across steps) could hit. Raised the defaults to exact=8 / near=10 / window=12, since `maxIterations` (500 in default mode) is the real runaway backstop and the guard only needs to catch a _tight_ same-call loop.

  It's now tunable via `context.loopGuard` in config: `enabled` (set `false` to disable the guard entirely and rely on `maxIterations`), `windowSize`, `repeatThreshold`, `nearWindowSize`, `nearThreshold`. Threaded through the session → ModeContext → every loop strategy (default, goal, collaborative + subagents), and live-reloadable.

- 497e9a1: Make `@moxxy/plugin-mcp` discovery-loadable — the second "stash a session capability" plugin. `Session.mcpAdmin` is now a getter over a published `'mcpAdmin'` service, core publishes its `'skills'` registry, and the vault plugin additionally publishes a `'resolveSecrets'` accessor (a `${vault:NAME}`-placeholder resolver) so mcp can resolve secrets without depending on `@moxxy/plugin-vault`. The plugin's default export (`mcpAdminPlugin`) resolves `'tools'` + `'skills'` + `'resolveSecrets'` from `ctx.services` in `onInit` (via lazy `Proxy`s), then publishes its runtime control api as `'mcpAdmin'` — replacing the host stash + `{ toolRegistry, skillRegistry, secretResolver }` closure. `userSkillsDir` defaults to `~/.moxxy/skills`. The runner's mcp handlers + the desktop read `session.mcpAdmin` exactly as before.
- 08e9eb2: Convert `@moxxy/memory-consolidate` to a discovery-loadable default export (`memoryConsolidatePlugin`). The memory plugin now publishes its long-term store on the inter-plugin service registry (`services.register('memory', store)`), and memory-consolidate resolves both that store and the active provider (via the published `'providers'` registry) from `ctx.services` in `onInit` — typed against a minimal inline interface so it needs no `@moxxy/core` import — instead of the `(store, getProvider)` closure. The `buildMemoryConsolidatePlugin` factory is kept for direct injection; `builtin-entries` uses the default export.
- bddaa83: Inter-plugin service registry (`AppContext.services`) — plugins publish a named service in `onInit` and consume siblings' services in theirs, requirements-ordered so the provider runs first. This decouples cross-plugin dependencies from the host's `build*({ deps })` constructor wiring, letting a plugin be discovery-loaded (default-exported) instead of hand-built by the orchestrator.

  The vault plugin now publishes its secret store (`services.register('vault', vault)`), and `@moxxy/plugin-oauth` is the first consumer to go discovery-loadable: the default-exported `oauthPlugin` resolves the vault from `ctx.services.require('vault')` in `onInit` (declaring `@moxxy/plugin-vault` as a requirement for ordering), so it no longer needs the `{ vault }` closure. `buildOauthPlugin` is kept for direct injection.

  Since plugin `onInit` already runs with full in-process privileges (the security isolation wraps tool execution, not plugin code), this doesn't widen the effective trust surface.

- e3491a9: Make `@moxxy/plugin-provider-admin` discovery-loadable — the first of the "stash a session capability" plugins. `Session.providerAdmin` is now a getter over a published `'providerAdmin'` service (RemoteSession keeps its own field for thin clients), and core publishes a stable `'resolveCredentials'` accessor. The plugin's default export (`providerAdminPlugin`) resolves the `'providers'` registry + `'resolveCredentials'` from `ctx.services` in `onInit` (via a lazy `Proxy` so its tools + stored-provider re-registration run unchanged) and publishes its admin api as `'providerAdmin'` — replacing the host stash + `{ providerRegistry, resolveActiveConfig }` closure. The runner + desktop read `session.providerAdmin` exactly as before.
- 5c1c334: The host now publishes its core registries on the inter-plugin service registry under well-known names (`agents`, `tools`, `providers`, `viewRenderers`, `synthesizers`), and the SDK exposes a minimal `NamedRegistry<T>` view (`get`/`list`/`has`) so a discovery-loaded plugin can resolve one in `onInit` without importing `@moxxy/core`'s concrete registry types.

  Two more closure-injected plugins go discovery-loadable on this seam: `@moxxy/plugin-subagents` (`subagentsPlugin` — resolves the `agents` + `tools` registries for `dispatch_agent`'s kind lookup + parent-tool snapshot) and `@moxxy/plugin-voice-admin` (`voiceAdminPlugin` — resolves the `synthesizers` registry for `list_voices`/`set_voice`). Both read the registries lazily at tool-call time and keep their `build*` factories for direct injection. `builtin-entries` uses the default exports.

- 238e434: Make the last two closure-injected plugins discovery-loadable, completing the onInit refactor wave (all 11 done).

  - **self-update** (`selfUpdatePlugin`): core publishes `'pluginHost'` (reload/unload/listSkipped), a live `'registrySnapshot'`, and a writable `'appendEvent'` (the counterpart to the read-only `ctx.log`); the host publishes a `'getPluginOptions'` config accessor. The plugin resolves them in `onInit`. The Tier-2 core-update tools are gated at build on `MOXXY_NO_CORE_UPDATE` (the env the desktop sets to hide them); `allowCoreUpdate`/`repoUrl` prefs resolve at run.
  - **web** (`webChannelPlugin`): core publishes `'tunnelProviders'`; the host publishes the shared `'webControls'` ref + `'webDefaultTunnel'`. The plugin resolves those + the existing `'viewSurface'` ref in `onInit` via a lazy `tunnels` object (keeping its tools + boot tunnel-apply hook present). web writes `viewSurface`; the view plugin reads it.

- 15299d8: Convert the telegram + Codex-OAuth Whisper transcriber plugins to discovery-loadable default exports (`telegramPlugin`, `whisperCodexPlugin`) that resolve the vault from the inter-plugin service registry in `onInit` instead of a `build*({ vault })` closure, declaring `@moxxy/plugin-vault` as a requirement for ordering. The `build*` factories are kept for direct injection. Same pattern as `@moxxy/plugin-oauth` — extending the onInit refactor wave across the channel + transcriber plugin kinds.
- d643573: Convert `@moxxy/plugin-view` to a discovery-loadable default export (`viewPlugin`). The host publishes the shared web-surface ref as the `'viewSurface'` service (the same mutable ref the web channel writes via `publishSurface`), and `viewPlugin` resolves `'viewRenderers'` (active renderer) + `'viewSurface'` from `ctx.services` in `onInit` — typed against minimal inline interfaces so it needs no `@moxxy/core` import — instead of the `{ getRenderer, getSurface }` closure. `present_view` reads both lazily at call time and degrades gracefully when absent. `buildViewPlugin` is kept for direct injection.
- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.15.1

### Patch Changes

- 08f927a: feat: pick which session ambient triggers run in + a compact trigger marker

  Ambient triggers (webhooks, schedules, workflows) used to fire on whichever
  session **created** them, and the synthesized prompt — often a large block
  carrying an untrusted webhook payload — rendered as a giant user bubble. Two
  changes:

  **Pick the target session.** Each trigger can now be pinned to a chosen session
  (where its run executes _and_ displays), decoupled from who created it:

  - `webhook_create` / `schedule_create` take an optional `targetSessionId`
    (defaulting to the creating session), and `webhook_update` /
    `schedule_set_target` reassign it. These map onto the existing
    `ownerSessionId` routing key, so the webhook queue/drain and the scheduler
    owner-gate already deliver to the right runner — no routing change.
  - Workflows gained a top-level `targetSessionId`. Scheduled workflows stamp it
    onto their scheduler mirror row (reusing the owner-gate); `fileChanged` is
    watched only by the target runner; a cross-session `afterWorkflow` dependent
    is skipped with a warning (the completion event is in-process to the parent's
    runner). The visual builder preserves the field across a round-trip.
  - Desktop: the Webhooks / Schedules / Workflows panels and the workflow builder
    gain a session picker (new `*.setTargetSession` IPC commands), and each
    summary surfaces the resolved target-session name.

  **Compact trigger marker.** A fired trigger now renders as a one-line,
  expandable chip ("Webhook received · github-issues", "Schedule fired · daily",
  "Workflow ran · digest") instead of the raw prompt — click to reveal the full
  payload. The prompt still lives in the model's context (security fences intact);
  only the display changes (new optional `origin` on the `user_prompt` event,
  threaded from the fired turn via `RunTurnOptions.origin`).

  Unset everywhere preserves today's behavior; single-process CLI/TUI is
  unaffected.

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0

## 0.15.0

### Minor Changes

- e4fe785: Make scheduled prompts and workflow triggers multi-tenant across concurrent runner processes.

  The desktop runs one `moxxy serve` per workspace, and every runner ran its own scheduler poller / workflow-trigger wiring over the SAME shared stores. A due schedule (and any workflow it fires) therefore ran once **per runner** — N times for N open workspaces — and skill/workflow-mirrored schedules had no notion of which runner should own them.

  Now:

  - Schedules carry an optional `ownerSessionId`. `schedule_create` stamps it with the creating runner's `MOXXY_SESSION_ID`, so a schedule created in a workspace's chat fires only on **that** runner (its result lands where it was asked for), not whichever poller happens to tick first.
  - Owner-less schedules (skill- and workflow-mirrored rows, or a single-process CLI with no session id) fire **exactly once across all runners** via a new cross-process "fire exactly once" lock (`CrossProcessFireLock`, exported from `@moxxy/sdk/server`) keyed on the entry's exact fire instant.
  - Workflow `fileChanged` triggers are likewise guarded by the cross-process lock in the multi-runner case, so one edit runs the workflow once instead of once per watching runner.

  Single-process CLI/TUI behavior is unchanged (no `MOXXY_SESSION_ID` → owner-less, fires as before).

- e62b6f5: Make webhook deliveries multi-tenant across concurrent runner processes, and auto-restore the proxy tunnel on boot.

  The webhook listener binds a single shared port, so with several runners (the desktop runs one `moxxy serve` per workspace) ONE runner received every delivery and fired it on **its own** session — a webhook created in workspace A's chat would fire in whatever workspace happened to win the port, or not reach A at all. And the proxy tunnel only ever lived in memory, so after a restart the saved public URL pointed at nothing (GitHub showed "We couldn't deliver this payload: timed out").

  Now:

  - Webhook triggers carry an optional `ownerSessionId`; `webhook_create` stamps it with the creating runner's `MOXXY_SESSION_ID`.
  - The runner that owns the listener routes each verified, filtered delivery: a trigger owned by **another** runner is handed off via a shared on-disk queue (`~/.moxxy/webhooks/queue/`); owner-less or own triggers fire in-process as before.
  - Every runner runs a drain poller that fires the queued deliveries addressed to **its** session — so the digest lands in the workspace that created the webhook. Deliveries for an offline workspace wait durably until it returns (with a 7-day stale sweep).
  - The runner that wins the listener bind **re-opens the proxy tunnel on boot** when the saved public URL came from the proxy, so "the app is running" once again means "the webhook URL is reachable." Only that one runner restores it, so the N runners don't collide on the single keypair-derived relay subdomain.

  Single-process CLI/TUI behavior is unchanged (no `MOXXY_SESSION_ID` → every delivery fires in-process, no queue/drain).

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0

## 0.14.14

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0

## 0.14.13

### Patch Changes

- 3862cb2: Unify sessions into a single source of truth across TUI / desktop / mobile.

  A session now lives in exactly ONE place — its per-session file
  `~/.moxxy/sessions/<id>.json` (the conversation stays in the append-only
  `<id>.jsonl`). `~/.moxxy/desktop/desks.json` is reduced to a thin workspace
  overlay (desk definitions + active pointers); the per-desk session list is
  DERIVED from the session files at read time and grouped by an explicit `groupId`
  (falling back to cwd for CLI/TUI sessions). Deleting a session = erasing its file,
  so a removed session/workspace can never resurrect — which removes the whole class
  of "deleted workspace comes back after restart" bugs and deletes ~300 lines of
  copy/reconciliation code (`syncSessionIndexIntoRegistry`, `registerSessionFromMeta`,
  partial-resume detection, legacy name hydration, the `withSessionTitles` pass).

  - `@moxxy/core`: the session metadata file (`<id>.json`, versioned) gains
    `source` (originating channel), `groupId` (workspace membership) and `title`
    (user rename). New helpers: `listSessionMetas` (cheap, mtime-cached, single
    `readdir`), `seedSessionMeta`, `setSessionTitle`, `setSessionGroup`. The runner
    adopts a file's stable identity (`startedAt`/`source`) and PRESERVES the
    UI-owned `title`/`groupId` across its writes, so a live runner never clobbers a
    rename/move. `deleteSession` is the single deletion mechanism.
  - `@moxxy/workspace-registry`: derives the desk/session view from the session
    files with an mtime-parse cache; `moveSession` re-homes a session by `groupId`.
  - `@moxxy/desktop-host`: a sessions-dir watcher pushes a debounced (and
    projection-diffed) `desks.changed` so a title/first-prompt/new-session/deletion
    syncs live to desktop + mobile; the desk-removal flow tears runners down before
    erasing files.
  - No migration: pre-existing sessions may be dropped; old desk _definitions_ are
    read in place (their embedded session arrays are ignored).

## 0.14.12

### Patch Changes

- 648c966: Keep collaborative peers on the selected model and keep mobile overlays interactive while turns stream.
- 648c966: Prevent foreign session events from polluting shared workspace session lists and transcripts.
- 648c966: Keep the standalone mobile gateway pinned to its live session after registry hydration, so paired mobile clients stay connected and chat sends reach the active runner.
- 648c966: Start the full `apps/mobile` Expo app automatically when running `moxxy mobile`, wire it to the working WebSocket bridge/client-core flow proven by the PoC, keep Metro on a single React instance, and make Expo SDK 54's Worklets Babel plugin resolvable under pnpm's strict dependency layout.
- 648c966: Make `moxxy mobile` phone-friendly by default: bind the mobile gateway on LAN, advertise the reachable Wi-Fi/hotspot IP in the QR, and keep loopback pairing as an explicit simulator/local-only opt-in.
- 648c966: Start the mobile app disconnected by default and clear any previously stored pairing URL/token on boot, preventing stale QR state from leaving the UI stuck in "Paired / connecting".
- 648c966: Make the full mobile plugin app use the working mobile bridge end to end: Expo web origins are allowed by `moxxy mobile`, QR pairing is WS-only via `ws(s)://...?t=token`, `@moxxy/client-transport-ws` exposes a closeable `makeWsApiHandle`, the standalone bridge exposes desktop-style desks/sessions, Expo Web NativeWind styles now render correctly, and the app now shows/selects real bridge sessions before chatting with the agent.

  Share the workspace/session registry across TUI, Desktop, and Mobile: sessions created outside a known workspace now land in the stable global `Moxxy` workspace, CLI/TUI persistence syncs session metadata into the registry, Desktop reads the same registry, and remote mobile clients can list/switch desks through the safe WS IPC allow-list.

  Harden the shared registry sync so tests and empty probe sessions do not leak into a real user profile: session persistence now honors `MOXXY_HOME`, `readIndex()` backfills missing first prompts from the JSONL log, CLI/TUI waits for a real user prompt before registering a session, stale session cwd values fall back safely, and desktop runner spawn errors no longer crash the main process.

  Keep legacy desktop sessions readable from Mobile by falling back to the desktop chat mirror when a registry session id has no matching core session log.

  Allow the shared chat store to retry loading a session transcript when an earlier read returned an empty page, so switching back to a persisted Desktop/Mobile session can recover history once the host is ready.

  Make session history recovery use the core session JSONL as the canonical source whenever it exists, repairing missing, empty, or partial desktop chat mirrors so older multi-session conversations open with their full transcript on Desktop and Mobile.

- 648c966: Allow mobile clients to continue the selected registry session instead of treating non-live sessions as read-only history.
- 648c966: Fix mobile session switching, archived-session read-only UX, and chat history scroll anchoring.
- 648c966: Sync desktop/mobile session state, auto-approve, and OpenAI cached-token usage for context meters.
- 648c966: Restore sticky session provider and model when desktop/mobile resumes a session.
- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1

## 0.14.11

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0

## 0.14.10

### Patch Changes

- 92fecb8: Close the cross-package hardening items deferred from the repo-wide sweep, with
  regression tests:

  - **Bugs:** `countNodes()` recursion → iterative (no RangeError on a deep AST);
    subagent `spawnAll` now settles all children (one child's setup failure no
    longer orphans its siblings); the runner socket path honors `$MOXXY_HOME`; the
    computer-control screenshot tool result is projected as a provider image block
    so the model can actually see screenshots; `MoxxyRequirement.version` narrowed
    to the plugin kind; `CompactorDef.compact` signature aligned; `isFileDiffDisplay`
    validation tightened.
  - **DRY:** `sleepWithAbort` / `nextBackoffMs` extracted into `@moxxy/sdk` (shared by
    the default and goal modes); the isolator shim + broker-op concurrency limiter
    single-sourced in `@moxxy/plugin-security` and applied to both isolators; desktop
    loopback ports hoisted to one module; a shared collab-store helper extracted.
  - **Accessibility / contract:** a global `prefers-reduced-motion` rule for inline
    transitions; real ARIA roles + roving focus + Escape + focus-restore on the
    anonymizer filter dropdown; zod schemas for the collab IPC channels.

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2

## 0.14.9

### Patch Changes

- e762d40: Repo-wide worst-case hardening (audit-driven). A pessimistic re-audit of every
  package/app scored security, performance, code-quality, extensibility (+a11y on
  UI surfaces) and cataloged 757 findings; this resolves the high+medium+clear-low
  set with regression tests for the failure paths. Highlights:

  - **Security:** email-detector ReDoS made linear (bounded local-part + label
    count + windowed scan); IPv4-mapped-IPv6 SSRF bypass closed; `memory_*` and
    workflow `runId` path-traversal sanitized; cross-host redirects no longer
    replay `Authorization`/body; webhook filter-regex ReDoS bounded; capability
    isolation now also covers tools registered after `onInit`; recursive subagent
    fan-out capped.
  - **Robustness (no happy-path assumptions):** unbounded child/stdout/socket/grep
    buffers bounded (OOM); missing `'error'` listeners + per-call timeouts + abort
    wiring added across the WS transport, runner JSON-RPC, isolators, browser
    sidecar, MCP boot, and provider streams; stale-name/out-of-order resolves,
    malformed-JSON tool input, and corrupt on-disk caches now degrade instead of
    crashing.
  - **Accessibility:** real focus traps + focus restoration + ARIA/`aria-modal` +
    keyboard navigation + Escape across desktop modals/sheets, the shared
    `desktop-ui` Modal, the workflow canvas, and the TUI.
  - **Quality:** dead code removed (incl. the committed `apps/docs/.astro` cache),
    per-workflow schedule-sync isolation, scheduler invalid-timezone resilience,
    and worst-case regression tests throughout.

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1

## 0.14.8

### Patch Changes

- 0daee68: feat(collaborative): git-first execution with a parallel lock-coordinated fallback (invisible)

  The non-git path ran agents ONE AT A TIME (sequential) — slow, and it's why "the
  team doesn't respond" when a user runs in a plain folder (only one agent is ever
  live). Now the engine is git-first and always parallel, and picks the safest
  mechanism underneath without any user-facing jargon:

  - **Already a git repo** → worktrees + a clean, conflict-aware merge (unchanged).
  - **Plain folder** → we quietly `git init` + snapshot it, so it STILL gets full
    worktree isolation + merge. Most "plain folder" runs now go fully parallel.
  - **Git genuinely unavailable** (not installed, or init/commit throws) → agents
    run in PARALLEL in the shared workspace, coordinated by the file-lock board
    (claim-before-edit). ownedPaths are pre-seeded as locks; an overlap is surfaced.
  - **`concurrency: 'sequential'`** remains as the explicit one-at-a-time fallback.

  Safety (from adversarial review): the shared-workspace prompt is hardened —
  claim before EVERY edit, narrowest paths, claim both old+new on rename, one owner
  for shared/aggregator files, only rely on a teammate's released work; the
  architect is required to hand out DISJOINT ownedPaths. peer-read on the shared
  tree reuses the path-traversal guard.

  Tests: auto-init → git-parallel; forced no-git → cwd-parallel (not sequential, no
  git repo); explicit sequential; cwd-parallel pre-seed + overlap surfacing.

## 0.14.7

### Patch Changes

- d71bf6f: feat(collaborative): brief is a SUMMARY, not the transcript — with on-demand recall

  The brief dumped up to ~6KB of the raw conversation into BRIEF.md, and every one
  of the N spawned agents was told to read it — so each peer re-ingested the whole
  dialogue. Now:

  - **BRIEF.md is a concise summary** — the goal + key requirements/constraints/
    decisions — produced by a single coordinator-side LLM call (`summarize.ts`,
    a direct off-log `provider.stream`, mirroring the summarize-compactor) with a
    deterministic **heuristic fallback** when no provider is available, so a brief
    never sinks the run.
  - **The full conversation goes to `.moxxy-collab/CONVERSATION.md`** for ON-DEMAND
    recall — never auto-loaded into any agent's context. The prompts tell agents to
    read or grep it only when they need a detail the summary omits.

  Net: peers get the intent cheaply instead of paying for the transcript N times.
  Adds summarizer (provider/model guard, error/empty → null), brief, and prompt
  tests; the e2e run now asserts CONVERSATION.md is written.

## 0.14.6

### Patch Changes

- b226696: feat(collaborative): dynamic, cross-functional roles (not a pool of identical implementers)

  The roster could only ever be `architect | implementer`, and `readRoster`
  force-overwrote every proposed role to `'implementer'` — so the architect's
  team was always a flat pool of clones, the opposite of the "a PM, a designer,
  some developers, a QA, a writer" vision.

  - `AgentRole` is now open (`'architect'` stays reserved for the coordinator's
    planner; any other label is a free-form team function).
  - `readRoster` carries the architect's proposed `role` (sanitised; a proposed
    `'architect'` is coerced to `'implementer'` since that's reserved) instead of
    hardcoding `'implementer'`.
  - The architect prompt now tells it to assemble the RIGHT team for the
    deliverable (developer/designer/pm/qa/writer/researcher/editor/…), not to
    default everyone to "implementer". The peer prompt + seeded turn now lead with
    the agent's role so a writer writes, a designer designs, a QA reviews.

  Roles flow straight into the existing roster/archive/UI, which already render
  `role`. Adds tests that proposed roles are carried and the reserved role coerced.

## 0.14.5

### Patch Changes

- 8bc25e7: feat(collaborative): give every agent the whole goal + the conversation, not just its subtask

  Spawned agents booted fresh sessions seeded with only their one-line subtask, so
  they never saw the overall goal or the dialogue that produced it — and the
  `MOXXY_COLLAB_PARENT_TASK` env the coordinator already set was read nowhere.

  - The coordinator now distils the user's conversation into a compact, token-
    capped **`.moxxy-collab/BRIEF.md`** (goal + recent intent) and writes it into
    the scaffold before the architect runs, so it's committed into every worktree
    (parallel) or present in the shared dir (sequential) — the whole team inherits
    the real intent.
  - `moxxy agent` now reads `MOXXY_COLLAB_PARENT_TASK` and seeds each implementer's
    first turn with the overall goal + its sub-task + a pointer to the brief and
    contracts (the architect, whose sub-task already is the goal, just gets the
    pointer).
  - The shared agent prompt now tells every agent to read the brief first and to
    `recall()` prior knowledge + `memory_save` durable facts — so the team builds
    memory/recall for the larger work.

  The brief is a pure, unit-tested digest (most-recent turns, clipped, total-
  capped) so a long conversation still yields a small file.

## 0.14.4

### Patch Changes

- a2cb758: fix(collaborative): stop the 30-minute hang, the spawn crash, and worktree leaks

  Agentic-collaborative mode could freeze for the full wall-clock (30 min) or take
  down the whole runner. Three root causes, fixed:

  - **30-minute hang.** A spawned agent only reported a terminal hub status when it
    called `collab_done`. Every other way a turn can end (provider error, iteration
    cap, idle, stuck-loop) left the process idling as `connected`, so the
    coordinator polled the full wall-clock before giving up. Peers now report a new
    terminal `failed` status when their turn ends without `collab_done`, and the
    coordinator adds a short **boot deadline** plus reacts to an observed child
    exit — so failures surface in seconds, not after 30 minutes.
  - **Coordinator crash on a bad spawn.** The peer `spawn()` had no `'error'`
    listener, so a failed spawn became an uncaught exception. It is now captured as
    a normal exit + diagnostic.
  - **Leaks.** Worktrees and the run's socket dir are now cleaned up on every exit
    path (abort, 0-done, conflict), not just integrate()'s happy path. The
    sequential fallback now awaits a peer's real exit before starting the next, so
    two agents never edit the shared workspace at once.

  A `failed` agent also releases its file locks (like a crash), and agents now
  self-report `working` while a turn is in flight. Adds a deterministic
  fail-fast coordinator test and a real-process integration test that spawns the
  actual `moxxy agent` binary and asserts it registers and reports a terminal
  status (no LLM required).

## 0.14.3

### Patch Changes

- 0870222: feat(runner): paged `session.loadHistory` + complete authoritative log

  Add the runner-side foundation for retiring the desktop's dual chat history (the
  renderer will later read transcript history from the runner instead of its own
  NDJSON store).

  - New runner protocol method `session.loadHistory` ({ before, limit } →
    { events, prevCursor }) — newest-first paging over the runner's authoritative
    event history. Bumps `RUNNER_PROTOCOL_VERSION` to 10; the change is purely
    additive, so `MIN_COMPATIBLE_PROTOCOL_VERSION` stays at 1 and an older client
    still attaches. `RemoteSession.loadHistory` gates the call on the server
    reporting v10+ and throws a clear, actionable "update the CLI" error against
    an older runner — which the desktop catches to fall back to its existing
    NDJSON path, so no transcript ever goes blank. The desktop FLOOR is
    intentionally NOT raised (the fallback keeps an older runner working); the
    release-build lockstep guard now allows the floor to lag an additive,
    version-gated runner bump.
  - `@moxxy/core` gains a PAGED JSONL reader (`readSessionEventPage` + the pure
    `pageEvents` helper) that reads one `(before, limit)` page WITHOUT
    re-materializing the whole log, so `loadHistory` works even when the log isn't
    all in memory. Read-only — it preserves persistence's atomic-write + mutex
    invariants (it never mutates the file).
  - Log completeness: when a turn streams assistant text but the provider never
    seals it with an `assistant_message` (e.g. an error/abort mid-stream — the
    case the renderer used to paper over by synthesizing a message that lived in
    no runner log), the runner now persists a REAL `assistant_message` on turn
    completion so its log is the complete authoritative history. Behavior-
    preserving for the normal sealed path.

## 0.14.2

### Patch Changes

- cbf115b: refactor(channel): close the runner/thin-client dispatch typing seam

  Add a single, audited `startChannelWith(channel, { session, ...overrides })`
  helper to `@moxxy/sdk` that owns the one structural erasure at the
  channel-dispatch boundary (`ChannelDef`/`Channel` are intentionally non-generic
  over their start-options type, so `start` takes `unknown`). The helper's
  signature now type-checks that every caller passes a real `ClientSession`, so a
  bare `RemoteSession` (the thin-client proxy) is proven assignable end-to-end
  even though the final hand-off to `start()` stays erased.

  Retarget the four CLI dispatch sites (`serve`, `web-surface`, and both the
  RemoteSession and in-process-Session paths in `start-registered-channel`) to
  call it, removing their inline `as never` casts, and add a compile-time
  conformance lock so a future regression that narrows `RemoteSession` or the
  concrete `Session` below `ClientSession`/`SessionLike` becomes a type error.
  No wire-shape or runner-protocol change.

- cbf115b: fix(cli): drain persistence + close the session on one-shot command exit

  One-shot commands (`moxxy -p`, `moxxy schedule run`, `doctor`, `login`, `init`)
  booted a full session and returned without closing it, so the process relied on
  the event loop draining — open webhook/scheduler/timer handles delayed (or hung)
  exit, and the last appended event could still be in flight when the process
  ended. Add a shared `closeSession(session, persistence?)` helper that drains the
  index write (`flush`) + the append queue (`settleWrites`) so the LAST event is
  durably on disk, then fires `onShutdown` hooks / stops the boot daemons via
  `Session.close()`. Each command now calls it in a `finally` (preserving its exit
  code), so the process exits promptly without dropping the final event.

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0

## 0.14.1

### Patch Changes

- 43d3874: Security + correctness audit of the newly-merged features (collab / anonymizer / mini-apps)

  Applied the quality sweep to the features that landed during it. Real bugs fixed,
  each with a regression test:

  - **mode-collaborative (security, high):** path-traversal / arbitrary-file-read in
    the peer-read confinement — a `startsWith(dir)` prefix check let a peer agent
    read sibling-dir files outside its worktree. Replaced with segment-aware
    containment (`resolve`+`relative`). Also fixed abort-listener leaks in the poll
    loops.
  - **plugin-collab (security/correctness):** `boardRelease`/`boardClaim` by public
    id skipped the owner check (lock-stealing + ownership-hijack across peers), and
    a crashed agent's file locks were never freed (deadlock). Ownership now enforced
    on the id path; crashed/killed agents release their claims.
  - **anonymizer (security/perf):** NER span aggregation mislocated short entities
    (a **PII-leak** — redacted the wrong region, left real PII), the worker leaked
    in-flight promises on teardown/error, and overlap resolution was O(n²). Fixed.
  - **app installer (security):** the asset download had no source allow-list (SSRF)
    and no size cap (disk-fill DoS); both added. The `moxxy-app://` protocol handler
    was audited and confirmed escape-proof.
  - mini-apps framework + collaborate UI: worker-leak fix, IPC boundary Zod test
    coverage, and extracted/tested pure render helpers.

## 0.14.0

### Minor Changes

- 2673fa0: Wire the desktop Providers reasoning-effort selector live: it now maps onto the runner's `config.context.reasoning` instead of dead-ending in localStorage. Adds a `session.setReasoning` runner protocol method (v9) + a `settings.setReasoning` IPC command, surfaces `supportsReasoning` on `ProviderEntry` (derived from the runner's model catalog) so the selector only renders where it's honored, and removes the unchecked `(p as { supportsReasoning? })` cast.

### Patch Changes

- 2673fa0: Quality sweep: close the last deferred audit items

  - **`RequirementChecker.targetInfo`** is now table-driven (`TARGET_DESCRIPTORS`
    record, byte-identical to the old per-kind switch, with compile-time
    exhaustiveness). Closes the types-generics-5 table-drive item.
  - **Voice-admin** is extracted into a first-class `@moxxy/plugin-voice-admin`
    package (tools moved verbatim, registered via the cli builtin entries like the
    other plugins). Closes u28-3.
  - **Reasoning-effort** is now wired end to end: the desktop Providers selector
    flows through a typed IPC command to the runner's `config.context.reasoning`
    (runner protocol bumped to v9 in lockstep with the desktop floor), instead of
    persisting to local state and silently doing nothing. Closes the long-standing
    reasoning TODO (audit c15 / R1).

## 0.13.2

### Patch Changes

- 50a5b38: Quality sweep — single-source the `MOXXY_PCM16_24KHZ_MIME` wire constant (`u35-2`)

  Behavior-preserving (same string `audio/x-moxxy-pcm16-24khz`). The cross-package
  PCM16 MIME protocol tag was independently redeclared as a literal in three
  consumers; they now import the SDK's hoisted source of truth instead:

  - New dependency-free `@moxxy/sdk/transcriber` subpath export (mirrors
    `./tool-display`) so the browser/RN `@moxxy/client-platform-web` package can
    value-import the constant without dragging `node:*` builtins from the main
    barrel. `transcriber.ts` is pure (consts + interfaces, zero imports), so the
    subpath stays browser-safe.
  - `@moxxy/client-platform-web` (`src/pcm16.ts`) re-exports the constant from
    `@moxxy/sdk/transcriber`; gains `@moxxy/sdk` as a dependency.
  - `@moxxy/plugin-stt-whisper` (`src/audio.ts`) imports + re-exports from
    `@moxxy/sdk`, keeping its existing public surface stable.
  - `@moxxy/plugin-cli` (`src/session/use-voice-input.ts`) imports from
    `@moxxy/sdk`, dropping the inline literal.

  No protocol bump; no cycles (`check:deps` clean); SDK keeps zero internal deps.

- 50a5b38: Quality sweep — additive `@moxxy/sdk` surface + context-fold dedup

  Three purely-additive SDK changes (no removals, zero new internal deps):

  - `MOXXY_PCM16_24KHZ_MIME` (u35-2): hoisted the cross-package PCM16/24 kHz wire
    MIME tag — previously redeclared as a bare literal in client-platform-web,
    plugin-stt-whisper, and plugin-cli — onto the SDK's typed transcriber surface
    as the single source of truth, with a lock test pinning the exact bytes.

  - `runManualCompaction` (u80-2): a thin, log-first manual-compaction helper
    (compactor + log + provider/model + window → `{ compacted, tokensSaved,
eventsCompacted }`) so `/compact` can share the SDK's compaction flow instead
    of hand-rolling it. `runCompactionIfNeeded`'s signature/behavior is unchanged.

  - `computeElisionState` memo + threaded elision state (complexity-hotspots-7 /
    u122-2): the pure fold is now memoized on the input snapshot's identity, and
    `runElisionIfNeeded`/`runCompactionIfNeeded` derive one `ElisionState` per
    iteration and thread it into `estimateContextTokens` (and, opt-in, into
    `projectMessages`) — collapsing the ~3x-per-iteration re-fold to one.
    Byte-identical: the golden elision/projection tests still pass, plus a new
    memo-correctness test (same snapshot → cached state; any new array →
    recompute, never stale).

- 50a5b38: Quality sweep — split Node-only `@moxxy/sdk` helpers behind a `./server` subpath (browser/RN boundary)

  Purely structural, behavior-preserving (`t2-sdk-server-subpath`, retires archived backlog #13):

  - New `@moxxy/sdk/server` subpath export. The Node-runtime VALUE helpers that
    statically reach `node:*` builtins — `spawnCliTunnel`/`isCliTunnelAvailable`
    (`node:child_process`), `writeFileAtomic`/`writeFileAtomicSync`/`moxxyHome`/
    `moxxyPath` (`node:fs`/`os`), `readRequestBody`/`bearerTokenMatches`
    (`node:http`/`crypto`), and the channel-auth helpers (`resolveChannelToken`/
    `rotateChannelToken`/`bearerGuard`/`encodeWsBearerProtocol`/
    `tokenFromWsProtocolHeader`/`MOXXY_WS_SUBPROTOCOL`/
    `MOXXY_WS_BEARER_PROTOCOL_PREFIX`) — now live on `@moxxy/sdk/server` and are
    dropped from the main barrel. The corresponding pure TYPE exports
    (`TunnelHandle`, `WriteFileAtomicOptions`, `ChannelTokenOptions`, …) stay on
    the main barrel (erased at build time). The main barrel + `./tool-display`
    subpath are now provably free of Node builtins, so a browser/React-Native
    bundle can value-import from them safely.

  - Every Node-side consumer re-pointed from `@moxxy/sdk` to `@moxxy/sdk/server`
    for those symbols (cli, core, desktop-host, channel/oauth/webhooks/mcp/
    workflows/scheduler/vault/memory plugins, ipc-server-ws, config, testing,
    apps/desktop/electron).

- 50a5b38: Quality sweep — workflow retry contract + DAG concurrency claim (plugin-workflows)

  - **`onError: 'retry'` is now behaviorally distinct (u117-3):** the DAG executor
    gates retries on the three-valued `onError` contract — `'retry'` runs
    `1 + retries` attempts, while `'fail'` and `'continue'` run **exactly one**
    attempt regardless of `retries`. Previously retries fired whenever
    `retries > 0` independent of `onError`, so `onError: 'fail' + retries: 3`
    silently retried (a latent trap). Schema/draft docs note the gate; new
    regression tests pin the attempt count for each mode.

  - **DAG wave-concurrency claim corrected (u117-1):** the executor description and
    scheduler comment now plainly describe the strictly-sequential within-wave
    execution (`concurrency` caps the batch drained per pass, not wall-clock
    latency) instead of implying parallelism is merely "deferred". Concurrent
    execution of even the pure steps cannot preserve the observable contract
    (atomic per-step event pairs in wave order, hard-failure-stops-the-rest-of-the-
    wave error semantics, wave-ordered `vars` merges), so the behavior is left
    sequential by design. No runtime behavior change for this item.

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5

## 0.13.1

### Patch Changes

- 897a1fc: Quality sweep, wave 7 (review long-tail triage — final cluster)

  Triaged the audit's low-severity review long-tail: fixed the genuine
  correctness/robustness items (each behavior-preserving + a regression test) and
  consciously declined the subjective/stale nitpicks with a recorded rationale.

  Representative fixes: OAuth `countTokens` now refreshes a near-expiry token
  (was silently degrading to the estimate); desktop `ConnectionScreen` handles a
  rejected (not just `{ok:false}`) update promise and names the real cause;
  `BrowserPane` `preventDefault`s the keys it forwards; `useStepFlow` pins the
  cursor to the shown step id so a late-applying step can't bounce the user; plus
  assorted small robustness fixes across core/cli/plugins. Also replaced bare
  `Function`-typed test casts with proper signatures (net lint improvement).

  This is the last audit cluster — every finding in
  `.claude/audits/quality-sweep-findings.json` is now either fixed or consciously
  resolved with a rationale.

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

## 0.13.0

### Minor Changes

- 27bfaf6: feat(collaborative): agentic collaborative mode — a team of separate agents working in parallel

  A new selectable `collaborative` mode runs a _team_ of full, **separate** agent
  runner processes on one task (instead of in-process subagents). An **architect**
  agent designs the plan + shared **contracts** and proposes the roster (you
  approve/adjust); **implementer** agents then build in parallel, each in its own
  git **worktree**, coordinating over a new cross-process **collaboration hub**:

  - **`@moxxy/plugin-collab`** — the hub: a unix-socket message bus, a task board
    that doubles as an exclusive **file-lock** arbiter, a **contract registry**
    (publish → propose-change → ack → commit), **peer-read** (one agent reads
    another's in-progress files), crash detection, and **human step-in**
    (pause / resume / directive) — plus the peer `collab_*` tools and the
    `/collab_say` `/collab_direct` `/collab_pause` `/collab_resume` commands.
  - **`@moxxy/mode-collaborative`** — the coordinator (`collaborative`) + the
    internal `collab-architect` / `collab-peer` modes, the peer-process supervisor,
    the git worktree + **staged, ownership-resolved merge** engine (the user's
    branch is only advanced on a clean, atomic promote; conflicts never leave
    markers), and a user-configurable `CollabConfig`. Falls back to a **sequential
    single-workspace** run when git is unavailable (e.g. desktop users without git).
  - **`moxxy agent`** — an internal headless peer-runner subcommand.
  - **UI** — a folded `CollaborationBlock` in `@moxxy/chat-model`; an inline
    team-summary card in chat; and a dedicated **Collaborate** desktop workspace
    (agents · tasks · contracts rail, a `# All` / `@agent` channel selector, and a
    step-in composer) plus a compact TUI `collab` view.

  No runner-protocol bump (the hub has its own versioned protocol; collaboration
  events ride the existing `plugin_event` stream).

## 0.12.8

### Patch Changes

- 5f20dab: Quality sweep, wave 6 (god-file decomposition — atomic modules)

  Behavior-preserving structural refactor: the largest god-files are split into
  focused, single-responsibility sibling modules and re-exported from their
  original paths, so every existing import and the public API are byte-identical
  (verified by typecheck + check:deps + the existing test suites).

  - runner: `RemoteSession` (1145→789 LOC) → per-surface `client-views/*`;
    `RunnerServer` (781→509 LOC) → per-domain `handlers/*`. Wire protocol unchanged.
  - `@moxxy/sdk`: `mode-helpers.ts` (797 LOC) → `mode/{project-messages,collect-stream,single-shot,stuck-loop,stable-hash}.ts`, barrel exports byte-identical.
  - plugin-workflows DAG executor, plugin-webhooks tools, plugin-self-update
    core-tools split into per-concern/per-tool modules.
  - desktop: electron `main/index.ts`, `WorkflowCanvas.tsx` (→ `canvas-graph` +
    camera/drag hooks), `Composer.tsx` decomposed; pure helpers now unit-tested.
  - `desktop-ipc-contract` barrel split into per-domain files (re-exported).
  - cli `setup/builtins.ts` + `setup/workflows.ts` decomposed into composables.
  - core `PluginHost` registration/unregistration is now driven by one
    `REGISTRY_KINDS` table (was 2 parallel hardcoded 16-entry lists); shared
    `PluginHostOptions` extracted to a leaf to keep the host/table dependency
    one-directional (no import cycle).

  Cross-package moves (e.g. relocating voice tools to a new package) were
  deferred — they change package boundaries and belong in their own PRs.

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.12.7

### Patch Changes

- ff73468: Quality sweep, wave 5 (safe longtail — coverage + mechanical consistency/perf)

  The additive/mechanical slice of the audit's low-severity long-tail; subjective
  nitpicks and anything behavior-risky were deferred (tracked in `archived backlog`).
  Behavior-preserving except the small fixes noted, each covered by a test.

  - **Coverage:** focused unit tests for previously-untested pure logic —
    command-palette parsers, chat suggestions, prompt reducer + escape-sequence
    matcher, slash-command matcher, config appliers, provider-admin `configure`,
    url-safety scheme table, vault placeholder resolution, and more.
  - **Mechanical consistency/perf:** resolve vault object properties concurrently
    (key-order preserved), hoist per-row `stdout.columns`/`descWidth` reads out of
    the TUI tool list, drop a no-op identity `useMemo`, and a few small bounded
    fixes. A desktop latest-block cache-key bug (64-char-prefix collision) was
    fixed while adding its test.

## 0.12.6

### Patch Changes

- 091ef41: Quality sweep, wave 4 (Tier-3 safe subset — coverage + mechanical cleanup)

  Largely additive and behavior-preserving (every behavioral change is tested):

  - **Test coverage** for previously under-tested critical subsystems: core surface
    host multiplexer, runner surface RPC + `surface.data` broadcast, desktop-host
    git porcelain/diff + provider-discovery + prefs + onboarding + surface relay,
    config loader, skill-draft fence extraction, and more.
  - **Real bugs found while adding coverage:** desktop-host git `-z` rename parsing
    emitted a phantom `ChangedFile`; untracked-file diff used a hardcoded POSIX
    `/dev/null` (now `os.devNull`); `fetchProviderModels` could hang (now a 15s
    `AbortSignal.timeout`).
  - **Mechanical cleanup:** removed proven-dead exports/params, tightened weak
    types (dropped `as never` / unchecked double-casts, exhaustive switches),
    consolidated duplicated `<NAME>_API_KEY` slug + config up-walk helpers.

  Risky/voluminous Tier-3 (god-file decomposition, the long-tail review/test-gap/
  consistency/perf clusters) remains tracked in `archived backlog` as the standing
  journal.

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.12.5

### Patch Changes

- 640d036: Performance pass (audit-driven, golden-tested for byte-identity)

  Algorithmic-complexity fixes; every algorithm-shape change is guarded by a test
  asserting the new path is byte-identical to the old, so behaviour is unchanged.

  - **Event log / projection (`@moxxy/sdk`, `@moxxy/core`, `@moxxy/runner`):**
    index `EventLog.ofType`/`byTurn` (O(n) filter → O(matches), property-tested
    equal to the old filter); `applyLazyTools` single-partition + index-backed
    loaded-tool scan; `projectMessages` binary-cursor compaction-range lookup;
    `computeElisionState` fused passes + no redundant sort; `surfaceInputParamsSchema`
    O(keys) size guard instead of `JSON.stringify` per frame.
  - **Chat-model block fold (`@moxxy/chat-model`, `@moxxy/client-core`, TUI,
    desktop):** the O(n²)/turn re-fold is now incremental — only the unsettled tail
    re-folds, keyed on a high-water mark — with a golden test feeding events one at
    a time and asserting deep-equality with a full re-fold after every event. Bounds
    the live in-memory log / `seenIds` / `usage.perCall`; memoizes the workflow
    canvas topology so a node drag no longer recomputes it per pointer-move.
  - **Quadratic / unbounded hotspots:** `UsagePanel` peak via reduce (was a
    `Math.max(...series)` spread that RangeError'd on long sessions), `grep` file
    size cap + binary skip, `StreamingPreview` incremental last-line (fixed an
    infinite loop on leading-newline content), terminal sentinel-regex compiled
    once + tail scan, webhooks parse-body-once, scheduler batched schedule
    reconcile, `runProcess` concat-once, and a one-time session-log `ensureReady`.

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1

## 0.12.4

### Patch Changes

- 1e1b1d3: Fix the desktop agentic surfaces being undrivable: you couldn't type into the
  terminal and the browser wouldn't navigate.

  - **Surfaces were destroyed out from under their viewer (core).** A surface is
    shared (the agent's tool + the viewer drive one PTY/page), but `SurfaceHost`
    tore the instance down on the first `close`. React StrictMode (dev) makes that
    routine: it mounts → unmounts → remounts, so the first mount's late-resolving
    `open` fires a `close` that destroyed the instance the remount had just
    attached to. Output kept flowing (from the snapshot) so it looked alive, but
    `surface.input`/`surface.resize` then hit a missing instance and were silently
    dropped — no typing, no navigation, no resize, no error. Fixed with viewer
    ref-counting: the instance is only torn down when the last viewer detaches.
  - **Terminal mounted at the wrong width (desktop).** The context rail animated
    its width open, so xterm's `fit()` measured a mid-slide sliver and the shell
    drew its prompt hard-wrapped narrow (which xterm won't reflow). The rail now
    snaps open so the pane is full-width at mount; the fit is rAF-debounced +
    width-guarded, and the terminal is focused on attach.

## 0.12.3

### Patch Changes

- e1fb6a6: Move the copy-pasted Markdown + YAML-subset frontmatter mini-parser into
  `@moxxy/sdk` as a single canonical, zero-dependency module
  (`parseFrontmatterFile` / `parseFrontmatter` / `renderFrontmatter`). It was
  duplicated almost line-for-line between `packages/core/src/skills/parse.ts` and
  `packages/plugin-memory/src/parse.ts`, and the two copies had diverged: the
  plugin-memory copy split inline arrays on bare commas and dropped null/float
  typing.

  The shared module keeps the more-correct `core` behavior — depth- and
  quote-aware inline arrays, `null`/`~`, and float parsing — so both packages now
  share one source of truth with identical parse output (same fields, same
  missing/blank-frontmatter handling, same body offset). `core` and
  `plugin-memory` re-export from the SDK under their existing public names
  (`parseSkillFile`/`ParsedSkillFile`, `parseMdFile`/`ParsedFile`); call sites and
  on-disk formats are unchanged. Adds golden tests pinning the prior behavior.

- e1fb6a6: Add a generic `createJsonFileStore` block to `@moxxy/sdk` capturing the repeated
  whole-file JSON id-collection skeleton (in-memory cache + per-instance write
  mutex + read-modify-write `.slice()` copy + crash-atomic `writeFileAtomic`),
  with parsing/validation and corruption policy supplied by the caller's `load`
  hook so each store keeps its exact on-disk format and error handling.

  Migrate the scheduler and webhooks stores onto it (behavior unchanged: same
  `{ version: 1, … }` pretty-printed format, same silent-reset vs.
  preserve-aside/quarantine corruption policy, same 0600 quarantine sidecar). Fix
  the workflows run-store's non-unique `${file}.tmp` write by routing it through
  the shared `writeFileAtomic` (pid+uuid temp → no concurrent-writer collision,
  no orphan temp on failure).

  The vault store (encrypted, passphrase-keyed, 0600) and the provider-admin
  store (name-keyed, versionless, trailing-newline format) are intentionally left
  on their existing — already invariant-compliant — `createMutex` +
  `writeFileAtomic` since they are not id-collections.

- e1fb6a6: Quality sweep, wave 2 (audit-driven, all gates green)

  Continues the 2026-06-18 monorepo sweep (`.claude/audits/`). Behavior is
  unchanged except for the documented bug fixes; every fix ships with a test.

  - **Dedup/generics onto shared homes:** route home-path derivations through the
    SDK `moxxyHome`/`moxxyPath` (fixes a latent `MOXXY_HOME` mismatch), one shared
    `refreshAndStore` for OAuth, a shared external-store helper in client-core, and
    one-shot provider calls routed through the shared SDK collector.
  - **Confirmed logic/correctness fixes (~50):** workflows (yaml block-scalar
    comment corruption, loop-exit determinism, hard-failure wave break, nested
    awaitInput, resume re-emit, sibling-name run resolution, paused-run reporting),
    desktop/client (SkillsView edit-clobber, command-palette dispatch, StrictMode
    double-IPC, ask-respond failure recovery, onboarding unhandled rejection, mic
    stream leak), and assorted fixes across core/cli/channels/providers/isolators.

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.12.2

### Patch Changes

- 89ad994: Repo-wide quality + performance sweep (audit-driven, all gates green)

  A monorepo audit (report in `.claude/audits/quality-sweep-2026-06-18.md`) drove
  three test-backed waves. Behavior is unchanged except for the bug fixes below.

  **SDK (new public helpers):** `assertNever`, `writeFileAtomicSync`,
  `compareSemver`/`parseSemverCore`, and `countNodes` are now exported from
  `@moxxy/sdk` as the single home for those patterns.

  **Dead code & consistency:** removed the orphaned CDP screencast plumbing in
  `plugin-browser` and ~16 other proven-unused exports/modules; replaced the only
  banned private-field-poke cast with a DI seam; deduped repeated helpers onto
  shared homes (SearchBox, diff helpers, token estimate, semver, countNodes).

  **Security / correctness fixes:** view-spec `isSafeViewUrl` whitespace XSS
  bypass (parser + renderer walls); capability-broker SSRF-via-redirect,
  symlink/TOCTOU, and unbounded-buffer hardening; permission deny-rules now fail
  closed on an invalid regex; OAuth refresh race + stale-token-field fixes;
  isolator SIGKILL escalation, cwd, and abort-signal wiring; bounded validation on
  remote-reachable IPC commands; refusal to overwrite a built-in provider; an
  unbounded `completedTurns` leak; and several resource/timer/listener leaks.

  **Generics & atomicity:** extracted `ActiveDefRegistry`/`DefMapRegistry` bases
  (8 copy-paste registries → thin subclasses) and `defineOpenAICompatProvider`
  (per-vendor copy-paste collapsed); closed invariant-#5 gaps by adding
  per-instance mutexes + atomic writes to the file-backed stores that lacked them.

  Larger/riskier items (the O(n²) chat-model fold rewrite, a generic JSON store,
  god-file splits, and the long-tail findings) are tracked in `archived backlog` for
  focused follow-up PRs rather than bundled here.

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.12.1

### Patch Changes

- 22b2c3c: Fix three bugs in the desktop agentic surfaces (terminal / browser / resizable rail):

  - **Rail wasn't resizable.** The drag handle is absolutely positioned, but
    `.col-rail` had no `position`, so it anchored to a far ancestor and landed
    off-screen — the divider looked draggable but nothing grabbed it. Anchor the
    handle to the rail, keep it inside the clip box, and drop the width transition
    mid-drag so the rail tracks the pointer 1:1.
  - **Terminal was shredded and unusable.** xterm's `fit()` ran synchronously on
    mount while the rail was still sliding open (≈0 width), locking the terminal —
    and the PTY it resized — to ~1–2 columns, so every character wrapped. Fit only
    once the pane has real layout (deferred + `ResizeObserver`-driven, width-guarded),
    and focus the terminal once the surface is attached so typing works immediately.
  - **Browser was stuck on "Loading…".** The CDP `Page.startScreencast` push emits
    no frames for a blank/static/headless page and swallowed its own failure, so the
    pane spun forever. Stream the page by polling a JPEG `frame` (always yields a
    frame, works on any Playwright browser) and surface a real error/launch status
    instead of an indefinite spinner.

## 0.12.0

### Minor Changes

- 33e9640: Agentic surfaces: repurpose the desktop context rail into a dropdown of shared,
  agent-drivable panes.

  - New swappable **Surface** block in the SDK (`defineSurface`, `SurfaceRegistry`,
    `SurfaceHost`) + runner protocol **v8** (`surface.*` methods + `surface.data`
    stream) so a runner-owned interactive resource (a PTY, a browser page) streams
    to a thin client and takes its input back — no reverse RPC.
  - **Terminal** (`@moxxy/plugin-terminal`): a shared shell the user and the agent
    drive together via a new `terminal` tool; rendered live with xterm.js. Ships a
    real PTY via node-pty (optional native dep, N-API) with a dependency-free
    piped-shell fallback.
  - **Browser**: a live, in-window view of the agent's Playwright page on
    `@moxxy/plugin-browser`, streamed over a CDP screencast (`Page.startScreencast`)
    — the user and agent share one page; clicks/keys/scroll/navigation are proxied
    to it.
  - **Files changed**: a git-aware file list with the diff on the right; clicking a
    file opens a dropdown to Add it to the agent or Open it (diff/content). New
    `workspace.readFile` + `git.{isRepo,status,diff}` desktop IPC.
  - The context button now opens a dropdown (Terminal / Files changed / Browser)
    instead of toggling; the rail is drag-resizable with a persisted width.

- 143264a: Desktop OAuth providers now sign in for real instead of showing a "run `moxxy login` in a terminal" hint.

  Settings → Providers (and the onboarding wizard) drive a shared `OAuthSignIn` flow that spawns `moxxy login <provider>`, opens the browser, and — for out-of-band providers like `claude-code` — collects the pasted `claude setup-token` or `code#state` in the UI (browser-authorize primary, token paste as a fallback). Loopback providers (openai-codex) keep their automatic browser+callback flow.

  Mechanics: `moxxy login --stdin-prompts` relays each interactive prompt to the host as a NUL-bracketed marker on stdout (new `encodeLoginPrompt` / `createLoginStreamScanner` in `@moxxy/sdk`) and reads answers as stdin lines, so a GUI host can drive the paste flow without a TTY. The desktop exposes this via new `provider.login.start` / `answer` / `cancel` IPC commands and `provider.login.prompt` / `output` / `done` events; the dead `onboarding.runProviderLogin` command was removed. `onboarding.providerAuthKind` now derives a provider's auth kind from the runner's registry (fixing `claude-code` being mis-detected as an API-key provider) instead of a hardcoded list.

- 951f374: Make the model's reasoning visible, and redesign sub-agents as a collapsible group.

  **Reasoning preview (per-provider, Codex-style between calls).** When enabled, the model's
  thinking now streams live (replacing the silent "thinking…" dots) and is kept as a dim,
  collapsible "Thinking" block interleaved with the tool calls it precedes — so you can see what
  the model is doing instead of waiting out a multi-second pause. Because reasoning is finalized
  once per provider round, summaries land naturally between tool batches.

  It's gated per provider/model via a new `ModelDescriptor.supportsReasoning` capability and turned
  on with `config.context.reasoning` (`true`, or `{ effort: 'low' | 'medium' | 'high' }`):

  - **Anthropic / Claude Code** — adaptive thinking with summarized display; the signed thinking
    block round-trips so interleaved-thinking tool-use continuations stay valid.
  - **OpenAI Codex** — surfaces the reasoning summary it already requests (previously discarded).
  - **OpenAI** — `reasoning_effort` for the gpt-5 family plus the `reasoning_content` summary that
    OpenAI-compatible reasoning backends stream.

  New SDK surface: a `reasoning` `ContentBlock`, `reasoning_delta`/`reasoning_signature`
  `ProviderEvent`s, `reasoning_chunk`/`reasoning_message` events, a `ProviderRequest.reasoning`
  knob, and `ModelDescriptor.supportsReasoning`. No runner protocol bump — reasoning events ride
  the existing event channel.

  **Grouped sub-agents view.** A `dispatch_agent` fan-out now renders as one collapsible group —
  a header (`N Explore agents finished`) over a tree of per-agent rows showing each agent's tool-use
  count, **token usage**, and status — instead of one block per child. Per-agent token totals and the
  agent kind are forwarded on the `subagent_*` events; both the desktop and TUI render the new tree.

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0

## 0.11.0

### Minor Changes

- 9f86a7b: Add four built-in LLM providers, available out of the box (no `provider_add`
  needed) and selectable in `moxxy init` / the `/model` picker:

  - **z.ai (Zhipu GLM)** in two modes — `zai` (pay-as-you-go, OpenAI-compatible
    endpoint) and `zai-coding-plan` (GLM Coding Plan, Anthropic-compatible
    endpoint, like Claude Code). Catalog: GLM-5.2 (1M context), GLM-5.1, GLM-5,
    GLM-4.6, GLM-4.5 family, GLM-4.5V (vision).
  - **xAI (Grok)** — `xai`, OpenAI-compatible. Catalog: grok-4.3 (1M context),
    grok-4, grok-4-fast, grok-code-fast-1, grok-3, grok-3-mini.
  - **Google Gemini** — `google`, via Gemini's OpenAI-compatibility endpoint.
    Catalog: gemini-3-pro/flash, gemini-2.5-pro/flash/flash-lite.
  - **Local models** — `local`, any OpenAI-compatible local server (Ollama by
    default, or LM Studio / llama.cpp / vLLM via `LOCAL_MODEL_BASE_URL`). Needs no
    API key.

  Also refreshes the Anthropic model catalog with the latest Claude models
  (Claude Fable 5, Opus 4.8, Opus 4.6 alongside the existing Opus 4.7, Sonnet 4.6,
  Haiku 4.5), which the `anthropic` and `claude-code` providers both pick up.

## 0.10.0

### Minor Changes

- aacdf1d: Desktop: live registry refresh + interactive provider management.

  The runner now broadcasts `info.changed` after every completed turn, so registry changes made by tools inside a conversation (provider_add, mcp_add, workflow_create, skill writes, …) reach attached clients; the desktop forwards the push to the renderer (`session.info.changed` → `SESSION_INFO_REFRESH_EVENT`) and the Settings panel re-fetches live — no more app restart to see an agent-added provider.

  Settings → Providers is now interactive: enable/disable any provider (runner protocol v7 `provider.setEnabled`, persisted to `preferences.json#disabledProviders` and honored by boot's activation walk; disabling the ACTIVE provider is refused), and a Configure sheet sets the API key (vault + live readiness re-probe via `provider.refreshReady`) and, for runtime-registered providers, the stored baseURL/default model (`provider.configure` through the new `SessionLike.providerAdmin` view). OAuth providers get a `moxxy login` hint instead of a key form.

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.9.0

### Minor Changes

- fee0523: New `moxxy office` channel: a browser pixel-art office game where every animated worker sprite is a full moxxy session. Click a sprite to chat with that agent (streaming, tool calls, permission/approval prompts, slash commands, mode switching, abort); spawn new agents that walk in through the entrance; watch subagents gather in the war room and bubble their progress. Served over the standard authenticated WebSocket IPC bridge, so the game reuses the shared client layer.

### Patch Changes

- 1450973: Virtual office: mouse-wheel / trackpad-pinch zoom (anchored at the cursor) and drag-to-pan, clamped to the office map; sprite clicks now fire on pointer-up with a drag threshold so panning never opens the chat panel.
- 5ab6c78: Fix the WS bridge rejecting real iOS devices at the upgrade handshake. iOS React Native (SocketRocket) sends an `Origin` header derived from the WS URL it dials (ws→http, wss→https) — it is not a browser-only signal — so the Origin default-deny dropped every iPhone pairing with `moxxy mobile` or the desktop gateway. The bridge server now supports `setAllowedOrigins` on the live listener (a tunnel URL is only assigned after start), and both the mobile channel and the desktop mobile gateway allow-list exactly the origins of the URLs they advertise: the tunnel origin, the LAN/loopback connect-URL origin, and the loopback spellings for simulators. Default-deny for everything else is unchanged.

## 0.8.2

### Patch Changes

- 4c594d8: Wave of desktop/mobile fixes. Runner protocol v6 (additive): clients can supply the turn id (`runTurn.turnId`) so renderer per-turn filters actually match — fixing the silently-broken "generate skill with AI" flow and hidden-turn leaks — and `attach` gains a replay policy (`'full' | 'none' | { tail }`) with EventLog rebase so the desktop no longer replays full session history on app start/desk switch (history comes from the paginated NDJSON log). Desktop settings gain a shared "ask moxxy to do it" background-agent modal: the skill generator is refactored onto it and MCP servers and Providers get Add buttons driving `mcp_add_server`/`provider_add`, with permission asks surfaced in-modal (plus a global ask fallback outside the chat view). Subagents now inherit the parent's resolved model: hallucinated model ids warn and fall back, workflow-trigger spawns use the session's last resolved model, and hardcoded model-id fallbacks are gone. Clerk sign-in returns to the app instead of stranding on the hosted My-account page (explicit fallback redirect URLs + a main-process account-portal recovery handler). Workflow canvas: Delete/Backspace removes the selected node and dropping a connector on empty canvas opens an insert-node menu. Mobile: reconnects re-prime the connection store (fixes the deaf "Connected" state after a runner restart), gateway URL commits on blur, the redundant header actions toggle is gone, menu entries are chips, executed tools open a diagnostics panel on tap, and the QR scanner starts scanning immediately.

## 0.8.1

### Patch Changes

- ad989eb: Workflow builder UX: the canvas pans by dragging the background (grab cursor; node drag / connection drag / click-to-deselect unaffected), the header controls (Back / validity badge / Save) align to the name/description input row instead of floating centred, and schema validation errors read as plain English anchored to the step — `step "greet": prompt must not be empty` instead of `steps.0.prompt: String must contain at least 1 character(s)` — so the builder can pin them to the offending node card.

## 0.8.0

### Minor Changes

- 2796066: feat(workflows): human-in-the-loop awaitInput — resume RPC + operator reply UI (un-gate)

  A workflow step can set `awaitInput: true` to pause and ask the operator a
  question, then continue with their reply. #146 gated this at validate/save time
  because the resume path hadn't shipped. The resume path now ships, so the gate
  is removed.

  - **Un-gate:** `awaitInput: true` is accepted again on **prompt/skill steps**
    (rejected on tool/workflow/logic/loop steps and on a loop body); `draft.ts`
    teaches the mid-run pause flow again with a worked example.
  - **Resume RPC (additive, protocol v5):** new `RunnerMethod.WorkflowResume`
    (`workflow.resume`) — server handler → `session.workflows.resume(runId, reply)`;
    `WorkflowsView.resume` (SDK) + CLI impl over the existing `resumeWorkflowRun`;
    `RemoteSession` client method gated on server protocol `>= 5` with the actionable
    "update the CLI" error (mirrors the v4 builder gate). `MIN_COMPATIBLE` stays at 1.
  - **Desktop / mobile / TUI:** `workflows.resume` added to the desktop IPC contract
    (+ host handler), the MobileSessionHost bridge, and `REMOTE_ALLOWED_COMMANDS`
    (RESPOND-only — answering a question the workflow asked, like `ask.respond`).
    Operator reply UI: desktop paused-workflow card (new client-core
    `usePausedWorkflows` hook) and TUI inline reply in the `/workflows` panel.
  - **Correctness:** the `workflow_paused` event now carries the workflow name +
    step label + question; vars set before a pause survive the checkpoint round-trip;
    `runNow` keeps treating a `paused` result as non-terminal (and the resume side
    delivers the now-completed run to the inbox); the stale-checkpoint sweeper +
    `clearRetainedChildren()`-on-shutdown are kept.

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.7.3

### Patch Changes

- 4a8ec5d: Workflows round-2 correctness: gate the unshippable `awaitInput` resume, make the visual builder work on the desktop, and fix loop/validation correctness.

  **`awaitInput` is gated (was a hang-forever dead-end).** The executor can pause + checkpoint an `awaitInput` step, but the resume trigger/channel that delivers the operator's reply never shipped to `main` — `resumeWorkflowRun` had zero production callers. So an agent-drafted "ask me, then act" workflow would pause forever, leak a retained child session for the process lifetime, and orphan a checkpoint file. `awaitInput` is now **rejected at validate/save time** with a clear "requires the resume channel, not available in this build" message, and `draft.ts` no longer teaches it (it steers the author to `inputs` fields instead). Defense-in-depth: the CLI runner treats a `paused` result as non-terminal (no inbox delivery), `Session.close()` clears retained child sessions so they can't leak, and a `WorkflowRunStore.sweepStale()` sweeper (7-day TTL, run on workflows boot) reaps orphaned `~/.moxxy/workflow-runs/active/` checkpoints. The executor pause/resume path is kept intact so re-enabling is a matter of landing a resume trigger and removing the schema gate.

  **Visual builder works on the desktop now.** The desktop drives a `RemoteSession`, whose workflows view only forwarded `list`/`setEnabled`/`run` — so the builder's `validateDraft`/`save`/`getRun` were `undefined` and threw "not supported on this session". Added a `workflow.validateDraft|save|getRun` runner-RPC family (**protocol bumped to v4**) with RemoteSession client methods + server handlers, so the desktop builder validates/saves/loads against the runner.

  **Loop + validation correctness.** A condition/switch step used as a loop body is rejected (its branch routing was silently ignored). A non-loop-body step that `needs` a loop-body step is rejected (it would stall — body steps are excluded from the main DAG). A loop-body step's own `when` guard and any `needs` other than its loop step / a sibling body step are rejected (body steps run unconditionally each iteration). Logic-step `vars` now drop `__proto__`/`constructor`/`prototype` keys (prototype-pollution guard). Paused-run checkpoints persist + restore `vars` set before the pause. Renaming a workflow via the builder removes the old file/entry instead of leaving an orphaned duplicate (`save(workflow, previousName)`, threaded through the view → IPC → runner RPC → builder hook).

- 6afc4c0: Workflows engine (phase 1 of 2): port the logic-step + agentic-authoring engine onto current main, and add a bounded while-loop node.

  **Engine features ported.** `@moxxy/plugin-workflows` now supports logic steps — `bridge` (extract/transform upstream output into `vars`), `condition` (if/else gate routed by an LLM `{"branch":"then"|"else"}`), and `switch` (multi-way gate routed by case id) — plus a `format: json|plain` field, branch fields (`then`/`else`/`cases`/`default`), a persisted-only `ui.layout` schema (node x/y + viewport, no editor here), agentic YAML authoring (`draft.ts` `buildSystemPrompt`/`draftWorkflow` + the `workflow_create` tool teaching the full schema), LLM branch-predicate parsing (`logic-response.ts`), and `awaitInput` pause/resume for prompt/skill steps (`run-store.ts` checkpoints under `~/.moxxy/workflow-runs/active/` + executor `resumeWorkflowRun`). The DAG executor (`executor/dag.ts`) gains `runLogicStep`, `mergeVars`, `applyBranchSkips`, and an `ExecutorContext`, merged surgically onto main's baseline — main's `MAX_NESTING_DEPTH` guard and behavior are preserved, as is the CLI's separate inter-workflow `afterWorkflow` cycle guard (`MAX_AFTER_WORKFLOW_CHAIN`, Tarjan SCC). The SDK gains the matching types (`WorkflowLoopAction`, `WorkflowLogicStepFormat`, `WorkflowRunStatus`, `WorkflowUi*`, `awaitInput`, `retainSession`, `SubagentContinueArgs`); core's subagent runtime gains retained-session `continue()`/`release()` (new `run-child.ts` + `registry.ts`) backing the pause/resume flow.

  **New `loop` node.** A `loop: { body: string[], condition: string, maxIterations: 1..50 (default 10) }` action repeats its body steps in order each iteration (resetting their state per pass, honoring `onError`), then evaluates `condition` via the same LLM predicate as a `condition` step. `condition` is the loop's EXIT/GOAL condition — the body repeats UNTIL it is met: `then` = condition met → STOP (continue to the next step), `else` = not yet met → run another iteration. A body step error BREAKS the loop to the next step (the loop returns ok with a "broke on error" note rather than failing the whole workflow), unless that body step sets `onError: continue` (which swallows the error and keeps iterating). It is unmistakably safe: it terminates when the exit condition is met, when a body error breaks it, OR at `maxIterations` (finishing with a clear note, never hanging), and composes with `MAX_NESTING_DEPTH` (a body that calls nested workflows still bottoms out at the depth cap). The iteration cap and the depth cap are independent guards; neither can be defeated by the other. Schema rejects loops combined with `then`/`else`/`cases`/`default`, empty bodies, out-of-range `maxIterations`, unresolvable body ids, and `awaitInput` on a loop.

  **IPC for the upcoming visual builder (phase 2).** Additive, capability-detectable commands `workflows.validateDraft` (parse YAML → errors), `workflows.save` (persist a workflow), and `workflows.getRun` (fetch canonical YAML): zod-validated contract + a desktop-host pass-through handler + new optional `WorkflowsView` methods, with the mobile `MobileSessionHost` extended to parity. The visual builder GUI itself is phase 2 (follow-up).

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0

## 0.7.2

### Patch Changes

- cf2f651: Audit wave: documentation drift + dead-code cleanup.

  - Removed dead exports: `@moxxy/core`'s unused `selectPendingToolCalls` / `selectCurrentTurn`
    event selectors and `@moxxy/sdk`'s unused voice helpers (`checkTranscriberReady`,
    `resolveTranscriber`, `pickFirstAvailableTranscriber`) — zero importers across the repo.
  - `@moxxy/plugin-telegram` no longer declares `zod` as a dependency (it never imported it).
  - CLI `--help` ENV section now lists the user-facing `MOXXY_*` variables and points at the
    new full table in the README.
  - Docs-only (no release impact): AGENTS.md/README.md architecture lists reconciled against
    the actual package set (mode-default replaces the deleted mode-tool-use; PR #120 client
    layer + channel-web/view/mobile + apps/mobile added), the published `@moxxy/sdk` README
    examples rewritten against the real API, apps/docs corrections (tools-builtin reality,
    testing API, four providers, full package index), and the dead `lint` task removed from
    turbo.json.

- cf2f651: Provider-parity fixes from the 2026-06-09 audit (A36–A38):

  - **Codex (A36):** `req.maxTokens` now reaches the Responses API as `max_output_tokens`; `req.temperature` is documented-unsupported on the Codex backend (gpt-5 reasoning models reject sampling params) and dropped with a one-shot MOXXY_DEBUG note instead of silently; `reasoningEffort` is a live `CodexProviderConfig` option (was pinned to 'medium') and the CLI's codex credential resolver now passes `provider.config` through to the client instead of discarding it.
  - **Runtime openai-compat providers (A37):** registered vendors now report their own name + model catalog on the live client (usage stats / errors / context-window lookups no longer misattributed to 'openai'); vault/env key naming is unified behind `providerApiKeyName`/`storedProviderApiKeyName` in plugin-provider-admin — the CLI honors a stored `envVar` override and maps hyphens to underscores, matching the desktop; `provider_add` model descriptors can declare `supportsDocuments` so attachments stop degrading.
  - **`req.system` contract (A38):** hook-injected system text (e.g. plugin-memory's consolidation nudge) now actually reaches every provider — delivered in addition to system-role messages (anthropic: extra system block after the cache breakpoint; openai: inserted system message; codex: appended to `instructions`). The loop helpers no longer prefill `req.system` with the system prompt, which also removes a duplicated base prompt in codex `instructions`.

- cf2f651: Security: four audit leftovers (A43–A46). MCP server credentials now support `${vault:NAME}` placeholders in env/header values, resolved only at connect time (the persisted mcp.json and the model-visible tool args keep the placeholder; `mcp_add_server`/`mcp_test_server` instruct vault-first). Agent-view URLs are scheme-allow-listed (`https`/`http`/`mailto`/`tel` + relative; `data:image/*` for img src only) at BOTH walls: a canonical `isSafeViewUrl` in the sdk enforced by `parseView` and `validateDoc`, and a render-time re-check in the web frontend that neutralizes `javascript:`/`data:text` hrefs and srcs. `web_fetch` closes its DNS-rebinding TOCTOU by pinning every hop's connection to the SSRF-guard-vetted addresses via an undici dispatcher with a fixed lookup (SNI/cert validation intact). Telegram inline-keyboard callbacks now enforce the same pairing authorization gate as text/voice messages.
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1

## 0.7.1

### Patch Changes

- 2e4bc37: Stability hardening for the web surface and process recovery (audit A7/A8): port-conflict recovery (web channel EADDRINUSE + runner protocol-mismatch) now verifies the holder is a moxxy process before signalling it and otherwise falls back to an ephemeral port instead of killing whatever listens (e.g. ngrok's UI on 4040); inbound web-surface WS frames are zod-validated and dropped (rate-limited warn) instead of crashing the process; the CLI installs last-resort unhandledRejection/uncaughtException guards.
- f3c798f: Stop CLI probe/light-boot sessions from leaking daemons. A new `probeSession`
  helper boots throwaway sessions with `skipInitHooks` (no scheduler poller, no
  webhooks listener — those now start exactly once, in the real session that
  owns them) and `disableSessionPersistence`, and guarantees the probe is closed
  before returning. Previously `moxxy <channel>` self-host booted three sessions
  and the orphaned probe won the webhooks port bind, so incoming webhooks ran
  turns on an abandoned session and duplicate scheduler pollers raced on the
  schedule store. Converted: the TUI needs-init probe, the `moxxy <command>`
  channel-existence probe, the channel-dispatch light-boots (`moxxy <channel>` /
  `moxxy channels …`), `moxxy schedule` store ops, the schedule-setup telegram
  check, and `moxxy plugins list`.
- 2e4bc37: Security (audit A4): webhook fires now actually enforce the trigger's `allowedTools`.
  The CLI webhook runner runs each fire against a per-fire scoped view of the active
  session — a filtered tool registry (the model only sees the listed tools) plus a
  wrapping permission resolver whose `check` and prompt-free `policyCheck` deny any tool
  outside the list (so the restriction survives goal-mode auto-approve), delegating
  allowed calls to the session's normal resolver chain. An empty `allowedTools` keeps the
  existing full-tool-set contract; the `webhook_create` description and setup guide now
  state exactly what is enforced and that fires run on the active session, not an
  isolated one.
- f297da0: Guard `afterWorkflow` triggers against cycles. Mutual triggers (A↔B, or longer loops) used to re-fire each other forever, burning provider tokens. Each run now carries its trigger chain on the `workflow_completed` event: re-fires that would revisit a workflow already in the chain, or exceed a depth cap of 8, are refused with a clear warning. On top of that, trigger sync statically detects cycles in the `afterWorkflow` graph, warns once naming the cycle, and disables auto-refire for its members (they remain runnable manually or on schedule).
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0

## 0.7.0

### Minor Changes

- 85f9b91: Share the desktop client layer across platforms and expose the IPC over a WebSocket.

  The desktop renderer's hooks, state stores, chat model, and IPC client are now
  transport- and platform-agnostic so a future mobile app can reuse them:

  - **`@moxxy/client-core`** — the `use*` hooks + chat/connection/ask stores + chat
    model + the transport singleton + a platform-capability registry. DOM-free; the
    desktop renderer consumes it via thin `@/lib/*` shims (no behavior change).
  - **`@moxxy/client-platform-web`** — the Web implementations of those capabilities
    (mic capture/PCM16, Web Speech TTS, localStorage, window event bus).
  - **`@moxxy/design-tokens`** — framework-neutral tokens + a `:root` CSS generator.
  - **`@moxxy/client-transport-ws`** — a `MoxxyApi` over the global `WebSocket`
    (no Node deps), for remote clients.
  - **`@moxxy/ipc-server-ws`** — serves the same `IpcCommands`/`IpcEvents` contract
    over an authenticated WebSocket (loopback by default, bearer-token gated). The
    desktop's IPC handler registration is now transport-neutral (a `CommandBus`/
    `EventSink` seam + a shared `dispatch` core in `@moxxy/desktop-ipc-contract`), so the
    same handler bodies serve Electron IPC and the WebSocket; events fan out to both.
  - **`@moxxy/plugin-channel-mobile`** — a `mobile` channel that serves the bridge from
    the CLI backed by the runner's single session: `moxxy mobile` (and `moxxy serve --all`)
    expose it with no desktop needed. It can reach beyond the LAN via a cloudflared/ngrok
    tunnel (`channels.mobile.tunnel`) and prints a **QR code** (URL + token embedded) to
    pair. The desktop bridge stays opt-in via `MOXXY_WS_BRIDGE`.
  - **`@moxxy/sdk`** — adds `resolveChannelToken` + `bearerGuard`: the standard channel
    auth-token resolution (env → `channels.<name>.token` → a persisted secret) and a
    pre-connection bearer handler, so channels gate connections uniformly. The mobile
    bridge + WS server adopt them.

  A new `apps/mobile` Expo proof-of-concept drives the chat loop (and permission prompts)
  through the shared hooks over the WebSocket bridge — against either backend. First launch
  shows a QR scanner that pairs by scanning `moxxy mobile`'s code. Desktop behavior is
  unchanged.

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0

## 0.6.0

### Minor Changes

- fab0fb4: Update flows: a real `moxxy update`, a TUI "new version" nudge, and observable desktop self-update.

  - **CLI** — new `moxxy update` command: checks the npm registry, detects how the
    CLI was installed (npm/pnpm/yarn/bun, global or local), and runs the matching
    upgrade after a confirm. `--check`/`--dry-run` report-only, `--yes` to skip the
    prompt. Source checkouts get git advice instead of an install.
  - **TUI** — surfaces a newer published `@moxxy/cli` as a one-line, auto-dismissing
    banner and shows the running version in the status line. The check is cached
    (~12h) and fully non-blocking on startup. (Also fixes the `version` prop being
    dropped before it reached the view.)
  - **Desktop self-update** — the previously-silent fall-back-to-the-floor is now
    observable: a persistent boot-decision log under `<userData>/app/boot-log.json`,
    a reason for every gate that rejects a staged bundle, and a Settings → Dashboard
    → Diagnostics readout. The renderer's boot confirmation is hardened (retry +
    reported failure) so a flaky heartbeat can't make the boot-probe revert a
    healthy update. Adds the `app.updateDiagnostics` / `app.bootHeartbeatFailed` IPC.

## 0.5.5

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0

## 0.5.4

### Patch Changes

- 9a789fe: Harden `moxxy plugins install`/`remove` against argument injection: the imperative
  install/uninstall path now rejects a flag-like spec (a leading `-`, e.g. `-g` or
  `--registry=…`) before handing it to `npm`, while still accepting the legitimate
  `name@version`, git (`github:`/`git+`/`https://`), and local-path specs. Internal
  cleanup: the duplicated `NPM_NAME_RE` / `diffSnapshot` / `PluginSnapshot` are hoisted
  into one shared module in `@moxxy/plugin-plugins-admin`.

## 0.5.3

### Patch Changes

- a2d551f: Desktop: resume a workspace's conversation + model context across app
  restarts, and make `/new` actually start a fresh session.

  The desktop owns and kills its `moxxy serve` child on quit, and each launch
  spawned a bare `serve` that minted a brand-new empty session — so the model
  forgot the whole conversation and the transcript collapsed to just the
  post-restart message (the TUI didn't have this because its long-lived daemon
  survives a window close). Now each per-workspace runner is given a sticky
  session id (its desk id) so it resumes `~/.moxxy/sessions/<id>.jsonl` if present
  and starts fresh under that id on first run.

  - New `SetupOptions.sessionId` / `BuildSessionArgs.sessionId`: "resume-if-present"
    (distinct from `resumeSessionId`, which errors when the log is missing — for
    an explicit `moxxy resume <id>`).
  - `serve` reads `MOXXY_SESSION_ID`; the desktop `RunnerSupervisor`/`RunnerPool`
    pass the workspace's desk id through to it.
  - Renderer: the runner replays its FULL history on every attach (and re-attach
    after a reconnect), so the chat runtime now de-dupes ingested events by id
    (`seenIds`, kept in lockstep across live append, replay, and pagination). This
    makes a resumed replay idempotent and also fixes a latent bug where a transient
    reconnect to a still-alive runner could duplicate the transcript.
  - `/new` now works on its own (previously it did nothing in the desktop — only
    `/clear` was handled). It clears the transcript AND resets the runner via a
    new `session.newSession` IPC → `RunnerSupervisor.resetSession()`, which wipes
    the persisted session log and restarts so the model context truly resets and
    doesn't resurrect on the next launch.

## 0.5.2

### Patch Changes

- b928391: Fix auto-compaction and auto-elision silently disabling on unrecognised model
  ids — the agent could grow its context unbounded and lose earlier context.

  `runCompactionIfNeeded` and `runElisionIfNeeded` resolved the model's context
  window via an exact `provider.models.find(m => m.id === ctx.model)` and bailed
  to a permanent no-op when it missed. But `config.model` is a free-form string
  and providers serve ids that aren't in their fixed descriptor list (a newer
  release like `claude-opus-4-8`, a dated id, or a runtime provider-admin model),
  so any such id turned BOTH context-management features off for the whole
  session. A shared `resolveModelContext` now falls back to the provider's first
  descriptor — exactly what the TUI context meter already did — so compaction and
  elision stay active on unlisted ids. The reactive overflow recovery
  (`runCompactionIfNeeded(ctx, { force: true })`) also now runs even when no
  window can be resolved at all, so an over-context turn compacts-and-retries
  instead of dying.

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1

## 0.5.1

### Patch Changes

- fad9d6b: Make `moxxy login claude-code` resilient to Anthropic's transient OAuth 500s.

  Anthropic's OAuth endpoints (`claude.ai/oauth/authorize` and the
  `console.anthropic.com/v1/oauth/token` exchange) intermittently return an
  `Internal server error` on the first hit — the identical request then succeeds
  on retry. The token-exchange 500 previously aborted the whole sign-in, forcing
  a full browser re-auth. `postClaudeToken` now retries transient failures
  (5xx / 429 / network errors) up to 3 attempts with a short backoff, while
  deterministic 4xx (bad/expired/already-used code, `invalid_grant`) still surface
  immediately. On exhaustion the error carries an actionable "wait and re-run"
  hint instead of a raw API dump. The browser sign-in instructions also note that
  the authorize page may need a "Try again" click on the first attempt.

## 0.5.0

### Minor Changes

- ad26425: Add a `claude-code` provider so Claude Pro/Max subscribers can use moxxy with
  their subscription instead of a pay-as-you-go API key.

  - New `@moxxy/plugin-provider-claude-code`: talks to the standard Anthropic
    Messages API with a Claude Code OAuth bearer token (`anthropic-beta:
oauth-2025-04-20` + the required "You are Claude Code…" system preamble).
  - Two ways to authenticate: paste a token from `claude setup-token` (or set
    `CLAUDE_CODE_OAUTH_TOKEN`), or run `moxxy login claude-code` for an
    interactive out-of-band OAuth sign-in. Access tokens refresh automatically.
  - `@moxxy/plugin-provider-anthropic`: `AnthropicProvider` gained an OAuth mode
    (bearer auth + system preamble + refresh-on-401); the API-key path is
    unchanged.
  - `@moxxy/sdk`: `ProviderAuthContext` gained an optional `prompt()` so auth
    flows can ask the user to paste a code/token (used by the out-of-band flow).

### Patch Changes

- e64aa0e: Fix "Mode not registered: tool-use" after the mode rename. A mode name persisted
  anywhere (config `mode:`, `~/.moxxy/preferences.json`, a desktop workspace's
  stored mode, a runner `setMode` RPC, a mid-turn mode hand-off) is now funneled
  through a legacy-name map in `ModeRegistry.setActive`: it tries the literal name
  first and falls back to the current name (`tool-use`→`default`,
  `deep-research`→`research`; the removed `plan-execute`/`bmad`/`developer` →
  `default`). A validly-registered name is never overridden, and a genuinely
  unknown mode still throws. Exposes `migrateModeName(name)` from `@moxxy/sdk`.
- 2615cbf: Polish the TUI: simplify the `/plugins` picker and make slash autocomplete
  scrollable.

  - `/plugins` now uses a few basic tabs — **Providers, Modes, Channels, Tools,
    Others, Installable** — instead of one tab per contribution kind. Disabled
    plugins live under "Others" with an `[off]` badge. Heading is just "Plugins".
  - Modal headers no longer paint a filled background band (it rendered as dark
    "bars" on many terminals) — the title + tabs sit as clean text, with the
    active tab marked by an inverse pill.
  - The `/` slash-command dropdown is no longer capped at 8 entries: it shows a
    scrolling window over the full command set (with `↑ N more` / `↓ N more`),
    so every command is reachable with ↑↓.

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0

## 0.4.0

### Minor Changes

- b014c3a: Slim the loop modes to three and turn plugin management into a first-class,
  plug/unplug system.

  Modes: the registry now ships only `default` (the Claude Code-style ReAct loop,
  package renamed `@moxxy/mode-tool-use` → `@moxxy/mode-default`, export
  `toolUseModePlugin` → `defaultModePlugin`), `goal` (autonomous auto-approve
  loop), and `research` (mode-name renamed from `deep-research`). The `bmad`,
  `developer`, and `plan-execute` modes are removed. Persisted preferences with
  the old mode names (`tool-use`, `deep-research`) are migrated on read, so
  existing sessions keep working.

  Plugins: the standalone "marketplace" is gone — install/remove/enable/disable
  and the installable-plugin catalog now live in `@moxxy/plugin-plugins-admin`.
  The `moxxy plugins` CLI gains `search`, `install`, `remove`, `enable`,
  `disable`, and `open` subcommands (alongside `list`/`reload`/`new`), and the TUI
  gains a `/plugins` picker (tabbed by plugin kind) to plug/unplug plugins live.
  The model can manage plugins on request via new `search_plugins` (npm registry +
  catalog discovery), `enable_plugin`, and `disable_plugin` tools, plus the
  existing `install_plugin` / `uninstall_plugin` — so "find me a plugin for X and
  install it" / "disable plugin X" work in natural language. Disabling a plugin now
  persists to `~/.moxxy/config.yaml` AND is honored by `pluginHost.reload()`, so a
  disabled plugin is never silently resurrected.

  SDK: `PluginHostHandle.list()` entries carry an optional `kinds` array; new
  `PluginsAdminView` / `InstallablePluginView` / `LoadedPluginView` session
  capabilities back the `/plugins` picker; `SessionOptions` gains an
  `isPluginDisabled` predicate.

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0

## 0.3.3

### Patch Changes

- d362a6b: Support sending documents (PDFs, Office/text) to the model. Adds a `document`
  `ContentBlock`, a `supportsDocuments` flag on `ModelDescriptor`, and a
  `'document'` `UserPromptAttachment` kind; `projectMessages` routes document
  attachments to the native block. The Anthropic, OpenAI, and Codex providers
  translate documents to their native shapes (Anthropic `document`, OpenAI
  `file`, Responses `input_file`), so attached files now reach the model for
  analysis instead of being dropped.
- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.3.2

### Patch Changes

- 6dea644: Fix tool calls getting stuck "running" forever (flipping to error only on the next message). When the stuck-loop detector tripped, `mode-tool-use` (the default mode) and `mode-goal` ended the turn after emitting `tool_call_requested` but before running the call — orphaning it with no `tool_result`. The turn still completed (re-enabling the composer), so the orphaned call spun indefinitely until the next `user_prompt` swept it into an error. Both modes now synthesize a failed result for every already-emitted request before bailing, matching the abort path and the already-correct plan-execute/developer modes. This also stops the provider from rejecting the unresolved tool-use block on the following turn.

## 0.3.1

### Patch Changes

- f3e3f1e: Fix tool calls getting stuck "running" forever (flipping to error only on the next message). When the stuck-loop detector tripped, `mode-tool-use` (the default mode) and `mode-goal` ended the turn after emitting `tool_call_requested` but before running the call — orphaning it with no `tool_result`. The turn still completed (re-enabling the composer), so the orphaned call spun indefinitely until the next `user_prompt` swept it into an error. Both modes now synthesize a failed result for every already-emitted request before bailing, matching the abort path and the already-correct plan-execute/developer modes. This also stops the provider from rejecting the unresolved tool-use block on the following turn.

## 0.3.0

### Minor Changes

- 0afd61d: Make an active mode visually obvious while it's running.

  Modes can now advertise a presentation `badge` (`ModeDef.badge`), surfaced on
  `SessionInfo.activeModeBadge` so every channel sees it over the wire. Goal mode
  declares one, so activating it now shows a persistent indicator the user can't
  miss — even mid-loop, when the usual mode footer is replaced by the "Thinking"
  marker:

  - **TUI** — a reverse-video `GOAL` pill stays pinned to the status line for the
    whole run, alongside the busy spinner.
  - **Desktop** — a persistent accent banner above the composer plus an accented
    Mode chip, both lit/cleared the moment the mode switches.

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.2.0

### Minor Changes

- df0593b: Add a `Sleep` built-in tool and a new `goal` mode (`/goal <objective>`).

  - **`Sleep` tool** — lets the agent pause for a set duration (`seconds` and/or `ms`, capped at
    5 minutes, abort-aware) to wait on an external/async process before re-checking, instead of
    busy-looping.
  - **`goal` mode + `/goal`** — `/goal <objective>` switches into the new `goal` mode,
    auto-approves every tool call (yolo) for the run, and starts working immediately. Unlike
    tool-use, the loop does NOT end when the model stops emitting tools — it keeps re-prompting
    the model to continue until the model explicitly calls the `goal_complete` tool (success,
    with a summary + evidence) or `goal_abandon` (blocked, needs the user). Every run is bounded
    by an iteration cap, a cumulative token budget, a stuck-loop detector, and no-progress
    detection, and stops immediately on user interrupt (Esc/Ctrl-C). Available in every channel
    via `/mode goal`.

### Patch Changes

- f469c0f: `moxxy init`: provider selection is now a single-choice picker instead of a multi-select.

  Users reported the old multi-select step was unintuitive — it wasn't obvious you had to toggle items on/off, and a required multi-select with nothing checked reads as a dead end. The wizard now uses a single `select` (one provider, pre-highlighted, just press Enter), which also removes the now-redundant "which provider should be primary?" step and renumbers the remaining steps (model → 3, mode → 4, embedder → 5, plugin-security → 6, review → 7). The generated `moxxy.config.yaml` is unchanged in shape, and you can still add more providers afterward via config `fallbacks` or the provider-admin tools. This matches the desktop app's onboarding, which already used a single-provider picker.

## 0.1.6

### Patch Changes

- bf8ef82: `moxxy login`: add a `--browser` flag that forces the loopback/browser OAuth flow even when stdin isn't a TTY.

  Previously a GUI host (the desktop app) that spawned `moxxy login <provider>` with piped stdio got the headless device-code flow — the user had to open a URL and type a code by hand. With `--browser`, the CLI runs the loopback flow that opens the system browser automatically and catches the localhost callback, so no copying is needed. (`--no-browser` still forces device-code.)

## 0.1.5

### Patch Changes

- f846b56: `moxxy serve` now boots even when no provider key is configured.

  Previously `serve` activated a provider at startup and exited 1 with `AUTH_NO_CREDENTIALS` when none was found — _before_ binding its socket. Clients (notably the desktop app) then looped forever on "lost the runner / reconnecting" and could never connect to add a provider. `serve` now boots with `tolerateNoProvider` (matching `channels` / `login`): it binds the socket with no active provider, and turns fail with a clear "no provider" error until one is configured.

## 0.1.4

### Patch Changes

- f07d698: Remove the two `npm install` deprecation warnings (`prebuild-install`, `boolean`) and slim the default install.

  `@moxxy/cli` no longer installs heavy native optional dependencies by default:

  - **keytar → `@napi-rs/keyring`**: keytar pulls the deprecated `prebuild-install`; `@napi-rs/keyring` ships per-platform NAPI prebuilds with no install scripts. OS-keychain unlock for the vault is preserved (it still falls back to the disk key / passphrase when the native binary is unavailable).
  - **`@huggingface/transformers` and `playwright` are now install-on-demand** (dropped from `optionalDependencies`). Both were already loaded via guarded dynamic `import()`; the local-embeddings and browser features degrade gracefully and prompt to install when first used. This is what pulled `boolean` (via `onnxruntime-node` → `global-agent`).

  Net effect: `npx @moxxy/cli` installs only `@moxxy/sdk`, `zod`, and `@napi-rs/keyring` — no deprecation warnings, smaller and faster.

- e73b51e: `moxxy init`: collect the vault passphrase as a styled first step instead of a bare prompt.

  On a first run the vault needs a passphrase to derive its encryption key. Previously this fired as an unstyled `readline` prompt _before_ the wizard (and before the logo). It's now a `@clack/prompts` `password` step — rendered under the moxxy logo, with a short description — so it reads as the first pre-requirement step of setup, consistent with the rest of the wizard. Threaded via a new `SetupOptions.passphrasePrompt`; headless `init` is unaffected (still uses `MOXXY_VAULT_PASSPHRASE` / the non-TTY guard).

## 0.1.3

### Patch Changes

- 93d9a2d: Publish with `pnpm publish` instead of `npm publish` so pnpm's `workspace:*` and `catalog:` protocols are rewritten to concrete version ranges in the published `package.json`.

  The previous `npm publish` shipped those protocols verbatim, so `npx @moxxy/cli init` failed on a clean machine with:

  ```
  npm error code EUNSUPPORTEDPROTOCOL
  npm error Unsupported URL Type "workspace:": workspace:*
  ```

  Both `@moxxy/cli` (`dependencies."@moxxy/sdk": "workspace:*"`, `zod: "catalog:"`) and `@moxxy/sdk` (`peerDependencies.zod: "catalog:"`) were affected, so both are republished.

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.1.0

### Minor Changes

- c4352f9: First published release of the `moxxy` CLI and SDK (off the `0.0.0` placeholder).

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
