import chalk from 'chalk';
import { Editor, CombinedAutocompleteProvider, matchesKey } from '@mariozechner/pi-tui';
import { styles, shortId } from './helpers.js';
import { StatusBar } from './status-bar.js';
import { ChatPanel } from './chat-panel.js';
import { EventsHandler } from './events-handler.js';
import { SLASH_COMMANDS } from './slash-commands.js';

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1006h'; // X11 + SGR mouse reporting
const DISABLE_MOUSE = '\x1b[?1000l\x1b[?1006l';
const MOUSE_WHEEL_LINES = 3;

/**
 * Main TUI application component.
 * Manages the status bar, chat panel, and editor.
 */
export class App {
  constructor(tui, client, agentId, { debug = false } = {}) {
    this.tui = tui;
    this.client = client;
    this.agentId = agentId;
    this.agent = null;
    this.loading = true;
    this.error = null;
    this.debug = debug;

    // Components
    this.statusBar = new StatusBar();
    this.chatPanel = new ChatPanel();
    this.editor = new Editor(tui, {
      borderColor: (s) => chalk.gray(s),
      selectList: {
        selectedPrefix: (s) => chalk.cyan(s),
        selectedText: (s) => chalk.bold(s),
        description: (s) => chalk.dim(s),
        scrollInfo: (s) => chalk.dim(s),
        noMatch: (s) => chalk.dim(s),
      },
    }, { paddingX: 2 });

    // Set up slash command autocomplete
    const slashItems = SLASH_COMMANDS.map(cmd => ({
      name: cmd.name,
      description: cmd.description,
    }));
    this.editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(slashItems, process.cwd())
    );

    this.editor.onSubmit = (text) => this._handleSubmit(text);

    // Wrap editor render:
    // 1) Inject "> " prompt into content lines
    // 2) Pad to a fixed height so autocomplete popup doesn't shift chat content
    //    Empty lines above the editor when no popup; popup fills that space when active
    const origEditorRender = this.editor.render.bind(this.editor);
    this._editorFixedHeight = 3 + this.editor.getAutocompleteMaxVisible() + 2; // base + popup items + borders
    this.editor.render = (width) => {
      const lines = origEditorRender(width);
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith('  ')) {
          lines[i] = chalk.gray('>') + lines[i].slice(1);
        }
      }
      while (lines.length < this._editorFixedHeight) {
        lines.unshift('');
      }
      return lines;
    };

    // Events handler
    this._lastConnected = undefined;
    this.eventsHandler = new EventsHandler(client, agentId, { debug });
    this.eventsHandler.onChange(() => {
      const connectionChanged = this._lastConnected !== undefined
        && this._lastConnected !== this.eventsHandler.connected;
      this._lastConnected = this.eventsHandler.connected;
      this.statusBar.setConnected(this.eventsHandler.connected);
      this.statusBar.setStats(this.eventsHandler.stats);
      this.chatPanel.setMessages(this.eventsHandler.messages);
      this.chatPanel.setThinking(this.eventsHandler.thinking);
      // Force full redraw on connection change to avoid stale status lines
      this.tui.requestRender(connectionChanged);
    });

    // Agent polling interval
    this._pollInterval = null;
    this._stopping = false;

    // Select mode (disables mouse capture for native terminal selection)
    this._selectMode = false;
  }

  async start() {
    // Add components to TUI
    this.tui.addChild(this.statusBar);
    this.tui.addChild(this.chatPanel);
    this.tui.addChild(this.editor);
    this.tui.setFocus(this.editor);

    // Global input handler for Ctrl+C and scroll keys
    this.tui.addInputListener((data) => {
      if (matchesKey(data, 'ctrl+c')) {
        this.stop();
        return { consume: true };
      }
      // Ctrl+Y — toggle select mode (native terminal text selection)
      if (matchesKey(data, 'ctrl+y')) {
        this._toggleSelectMode();
        return { consume: true };
      }
      // Escape — exit select mode if active
      if (this._selectMode && matchesKey(data, 'escape')) {
        this._toggleSelectMode();
        return { consume: true };
      }
      // Page Up — scroll chat up
      if (data === '\x1b[5~') {
        const pageSize = Math.max(1, this.chatPanel.height - 4);
        this.chatPanel.scrollUp(pageSize);
        this.tui.requestRender();
        return { consume: true };
      }
      // Page Down — scroll chat down
      if (data === '\x1b[6~') {
        const pageSize = Math.max(1, this.chatPanel.height - 4);
        this.chatPanel.scrollDown(pageSize);
        this.tui.requestRender();
        return { consume: true };
      }
      // SGR mouse: \x1b[<button;col;row(M|m)  — button 64=wheel up, 65=wheel down
      if (data.startsWith('\x1b[<')) {
        const match = data.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
        if (match) {
          const btn = parseInt(match[1], 10);
          const pressed = match[4] === 'M';
          if (btn === 64) { // wheel up
            this.chatPanel.scrollUp(MOUSE_WHEEL_LINES);
            this.tui.requestRender();
            return { consume: true };
          }
          if (btn === 65) { // wheel down
            this.chatPanel.scrollDown(MOUSE_WHEEL_LINES);
            this.tui.requestRender();
            return { consume: true };
          }
          // Shift+click (btn 4-6) → enter select mode for native terminal selection
          if (pressed && btn >= 4 && btn <= 6 && !this._selectMode) {
            this._toggleSelectMode();
          }
        }
        return { consume: true };
      }
    });

    // Load agent
    await this._loadAgent();

    // Connect SSE
    this.eventsHandler.connect(); // runs in background (async)

    // Enter alternate screen buffer and enable mouse wheel
    process.stdout.write(ENTER_ALT_SCREEN + ENABLE_MOUSE);

    // Compute layout before first render
    this._updateLayout();

    // Start rendering
    this.tui.start();
  }

  stop() {
    if (this._stopping) return;
    this._stopping = true;
    this.eventsHandler.disconnect();
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    // Schedule teardown on next tick so pi-tui's input handler can finish
    setImmediate(() => {
      try { this.tui.stop(); } catch { /* ignore */ }
      process.stdout.write(DISABLE_MOUSE + EXIT_ALT_SCREEN);
      // Force-kill via SIGINT — process.exit() can hang when async handles
      // (SSE fetch, timers) haven't fully unwound yet.
      process.kill(process.pid, 'SIGINT');
    });
  }

  _toggleSelectMode() {
    this._selectMode = !this._selectMode;
    if (this._selectMode) {
      process.stdout.write(DISABLE_MOUSE);
    } else {
      process.stdout.write(ENABLE_MOUSE);
    }
    this.statusBar.setSelectMode(this._selectMode);
    this.tui.requestRender(true);
  }

  _updateLayout() {
    const rows = this.tui.terminal.rows;
    // Status bar = 3 lines, editor = fixed height (includes autocomplete space)
    const chatHeight = Math.max(5, rows - 3 - this._editorFixedHeight);
    this.chatPanel.setHeight(chatHeight);
  }

  async _loadAgent() {
    try {
      this.loading = true;
      this.agent = await this.client.getAgent(this.agentId);
      this.statusBar.setAgent(this.agent);
      this.chatPanel.setAgentName(this.agent.name || null);
      this.error = null;
      this._startPolling();
    } catch (err) {
      this.error = err.message;
      if (err.isGatewayDown) {
        this.eventsHandler.addSystemMessage(err.message);
      } else {
        this.eventsHandler.addSystemMessage(`Error loading agent: ${err.message}`);
      }
    } finally {
      this.loading = false;
    }
  }

  _startPolling() {
    if (this._pollInterval) clearInterval(this._pollInterval);
    this._pollInterval = setInterval(async () => {
      if (!this.agent || this.agent.status !== 'running') return;
      try {
        const prevStatus = this.agent.status;
        this.agent = await this.client.getAgent(this.agentId);
        this.statusBar.setAgent(this.agent);
        this.chatPanel.setAgentName(this.agent.name || null);
        // Force full redraw when agent status changes to avoid stale status lines
        this.tui.requestRender(prevStatus !== this.agent.status);
      } catch { /* ignore polling errors */ }
    }, 5000);
  }

  async _handleSubmit(text) {
    // Normalize: autocomplete can produce "//quit" when it inserts "/quit"
    // on top of the "/" trigger the user already typed.
    const task = text.trim().replace(/^\/{2,}/, '/');
    if (!task) return;

    // Handle slash commands
    if (task === '/quit' || task === '/exit') {
      this.stop();
      return;
    }
    if (task === '/stop') {
      if (this.agent) {
        try {
          await this.client.stopAgent(this.agent.id);
          this.agent.status = 'idle';
          this.statusBar.setAgent(this.agent);
          this.tui.requestRender(true);
          this.eventsHandler.addSystemMessage('Agent stopped.');
        } catch (err) {
          this.eventsHandler.addSystemMessage(`Error: ${err.message}`);
        }
      }
      return;
    }
    if (task === '/clear') {
      this.eventsHandler.clearMessages();
      return;
    }
    if (task === '/help') {
      const helpText = 'Commands: ' + SLASH_COMMANDS.map(c => c.name).join(', ');
      this.eventsHandler.addSystemMessage(helpText);
      return;
    }
    if (task === '/status') {
      const status = this.agent
        ? `Agent ${shortId(this.agent.id)}: ${this.agent.status} | Provider: ${this.agent.provider_id} | Model: ${this.agent.model_id} | SSE: ${this.eventsHandler.connected ? 'connected' : 'disconnected'}`
        : 'No agent connected';
      this.eventsHandler.addSystemMessage(status);
      return;
    }
    if (task === '/select' || task === '/copy') {
      this._toggleSelectMode();
      return;
    }
    if (task === '/model') {
      const info = this.agent
        ? `Model: ${this.agent.model_id} via ${this.agent.provider_id}`
        : 'No agent connected';
      this.eventsHandler.addSystemMessage(info);
      return;
    }

    // Regular task: send to agent
    this.eventsHandler.addUserMessage(task);
    if (this.agent) {
      try {
        await this.client.startRun(this.agent.id, task);
        this.agent.status = 'running';
        this.statusBar.setAgent(this.agent);
        this.tui.requestRender(true);
      } catch (err) {
        if (err.isGatewayDown) {
          this.eventsHandler.addSystemMessage(err.message);
        } else {
          this.eventsHandler.addSystemMessage(`Error: ${err.message}`);
        }
      }
    } else {
      this.eventsHandler.addSystemMessage('No agent connected. Cannot run task.');
    }
  }
}
