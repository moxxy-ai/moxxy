/**
 * Overlay styles for the HUD + chat panel, injected as a single <style> tag by
 * App. Keyed off the CSS vars index.html already defines (--bg/--panel/--line/
 * --fg/--muted/--accent/--ok/--warn/--danger/--radius) so the overlay matches
 * the page chrome. Monospace headings for the pixel-game flavor; everything
 * else stays quiet — the game is the star.
 */

export const PANEL_CSS = `
/* ---- HUD (top-left) ----------------------------------------------------- */
.vo-hud {
  position: absolute; top: 12px; left: 12px;
  display: flex; flex-direction: column; gap: 8px;
  min-width: 176px; max-width: 232px;
  background: var(--panel); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  font-size: 12px;
}
.vo-hud-title {
  margin: 0; font: 600 10px ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted);
}
.vo-roster { display: flex; flex-direction: column; gap: 2px; }
.vo-chip {
  display: flex; align-items: center; gap: 7px; width: 100%;
  padding: 4px 6px; border: 1px solid transparent; border-radius: 6px;
  background: none; color: var(--fg); font: inherit; text-align: left;
  cursor: pointer;
}
.vo-chip:hover { background: var(--panel2); }
.vo-chip--selected { border-color: var(--accent); background: var(--panel2); }
.vo-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vo-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.vo-dot--thinking { background: var(--ok); animation: vo-pulse 1.1s ease-in-out infinite; }
.vo-dot--ask { background: var(--warn); }
@keyframes vo-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.78); }
}
.vo-spawn {
  border: none; border-radius: 6px; padding: 6px 8px; cursor: pointer;
  background: var(--accent); color: #fff;
  font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace;
}
.vo-spawn:hover { filter: brightness(1.1); }
.vo-spawn:disabled { opacity: 0.5; cursor: default; filter: none; }
.vo-demo-badge {
  padding: 4px 6px; text-align: center; border: 1px dashed var(--warn);
  border-radius: 6px; color: var(--warn);
  font: 600 10px ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.08em; text-transform: uppercase;
}
.vo-banner {
  padding: 4px 6px; border-radius: 6px; text-align: center;
  font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
}
.vo-banner--warn { background: var(--warn); color: #1a1405; }
.vo-banner--danger { background: var(--danger); color: #fff; }

/* ---- Chat panel (right) ------------------------------------------------- */
.vo-panel {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 360px; max-width: 100vw;
  display: flex; flex-direction: column;
  background: var(--panel); border-left: 1px solid var(--line);
  box-shadow: -6px 0 24px rgba(0, 0, 0, 0.35);
  font-size: 13px;
}
.vo-panel-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-bottom: 1px solid var(--line);
}
.vo-panel-name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: 700 13px ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: pointer;
}
.vo-panel-name:hover { color: var(--accent); }
.vo-rename {
  flex: 1; min-width: 0; background: var(--panel2); color: var(--fg);
  border: 1px solid var(--accent); border-radius: 6px; padding: 3px 6px;
  font: 700 12px ui-monospace, SFMono-Regular, Menlo, monospace; outline: none;
}
.vo-mode {
  flex: none; max-width: 112px; background: var(--panel2); color: var(--fg);
  border: 1px solid var(--line); border-radius: 6px; padding: 3px 4px;
  font-size: 11px;
}
.vo-iconbtn {
  flex: none; background: none; border: none; padding: 2px 5px;
  color: var(--muted); font-size: 14px; line-height: 1; cursor: pointer;
}
.vo-iconbtn:hover { color: var(--fg); }
.vo-remove {
  flex: none; background: none; border: 1px solid var(--line); border-radius: 6px;
  padding: 3px 7px; color: var(--danger); font-size: 11px; cursor: pointer;
}
.vo-remove:hover { border-color: var(--danger); }

/* ---- Transcript ---------------------------------------------------------- */
.vo-scroll {
  flex: 1; overflow-y: auto; padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.vo-loadolder {
  align-self: center; background: none; border: 1px solid var(--line);
  border-radius: 999px; color: var(--muted); font-size: 11px;
  padding: 3px 10px; cursor: pointer;
}
.vo-loadolder:hover { color: var(--fg); }
.vo-bubble {
  max-width: 86%; padding: 7px 10px; border-radius: 10px;
  white-space: pre-wrap; word-break: break-word; line-height: 1.45;
}
.vo-bubble--user {
  align-self: flex-end; background: var(--accent); color: #fff;
  border-bottom-right-radius: 3px;
}
.vo-bubble--assistant {
  align-self: flex-start; background: var(--panel2);
  border: 1px solid var(--line); border-bottom-left-radius: 3px;
}
.vo-caret {
  display: inline-block; width: 7px; height: 13px; margin-left: 3px;
  background: var(--accent); vertical-align: text-bottom;
  animation: vo-blink 1s steps(1) infinite;
}
@keyframes vo-blink { 50% { opacity: 0; } }
.vo-tool {
  align-self: stretch; background: var(--panel2); border: 1px solid var(--line);
  border-radius: 6px; padding: 4px 8px; cursor: pointer;
  color: var(--muted); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
}
.vo-tool:hover { color: var(--fg); }
.vo-tool--err { color: var(--danger); }
.vo-tool-detail {
  margin: 6px 0 2px; padding: 6px; max-height: 160px; overflow: auto;
  background: var(--bg); border-radius: 6px; white-space: pre-wrap;
  word-break: break-word; cursor: auto;
}
.vo-group-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.vo-skill {
  display: flex; flex-direction: column; gap: 6px;
  border-left: 2px solid var(--line); padding-left: 8px;
}
.vo-sys {
  color: var(--muted); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap; word-break: break-word;
}
.vo-sys--error { color: var(--danger); }
.vo-sys--notice { color: var(--warn); }
.vo-empty { color: var(--muted); text-align: center; padding: 24px 8px; font-style: italic; }

/* ---- Ask card ------------------------------------------------------------ */
.vo-ask {
  margin: 0 12px 8px; padding: 10px;
  border: 1px solid var(--warn); border-radius: var(--radius);
  background: rgba(210, 153, 34, 0.08);
}
.vo-ask-title {
  font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace;
  margin-bottom: 4px;
}
.vo-ask-body { color: var(--muted); font-size: 12px; white-space: pre-wrap; }
.vo-ask-json {
  margin: 6px 0 0; padding: 6px; max-height: 140px; overflow: auto;
  background: var(--bg); border-radius: 6px; font-size: 11px;
  white-space: pre-wrap; word-break: break-word;
}
.vo-ask-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.vo-btn {
  background: var(--panel2); border: 1px solid var(--line); border-radius: 6px;
  color: var(--fg); padding: 4px 11px; font-size: 12px; cursor: pointer;
}
.vo-btn:hover { border-color: var(--accent); }
.vo-btn--primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.vo-btn--danger { background: var(--danger); border-color: var(--danger); color: #fff; }

/* ---- Composer ------------------------------------------------------------ */
.vo-composer {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 10px 12px; border-top: 1px solid var(--line);
}
.vo-composer textarea {
  flex: 1; min-height: 38px; max-height: 120px; resize: none;
  background: var(--panel2); color: var(--fg); border: 1px solid var(--line);
  border-radius: 8px; padding: 8px 10px; font: inherit; outline: none;
}
.vo-composer textarea:focus { border-color: var(--accent); }
.vo-stop {
  flex: none; background: var(--panel2); border: 1px solid var(--danger);
  border-radius: 8px; color: var(--danger); padding: 8px 10px;
  font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; cursor: pointer;
}
.vo-stop:hover { background: var(--danger); color: #fff; }
.vo-demo-note { color: var(--muted); text-align: center; padding: 24px 16px; font-style: italic; }
`;
