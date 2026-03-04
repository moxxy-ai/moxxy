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

    // Two-step command state
    this._pendingVaultSet = null;   // { keyName }
    this._pendingModelSwitch = null; // { step: 'provider'|'model', providers?, providerId?, models? }
    this._modelMetaKey = null;
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
      // Ctrl+X = stop running agent
      if (matchesKey(data, 'ctrl+x')) {
        this._stopAgent();
        return { consume: true };
      }
      // Ctrl+Y = toggle select mode (native terminal text selection)
      if (matchesKey(data, 'ctrl+y')) {
        this._toggleSelectMode();
        return { consume: true };
      }
      // Escape = exit select mode if active
      if (this._selectMode && matchesKey(data, 'escape')) {
        this._toggleSelectMode();
        return { consume: true };
      }
      // Page Up = scroll chat up
      if (data === '\x1b[5~') {
        const pageSize = Math.max(1, this.chatPanel.height - 4);
        this.chatPanel.scrollUp(pageSize);
        this.tui.requestRender();
        return { consume: true };
      }
      // Page Down = scroll chat down
      if (data === '\x1b[6~') {
        const pageSize = Math.max(1, this.chatPanel.height - 4);
        this.chatPanel.scrollDown(pageSize);
        this.tui.requestRender();
        return { consume: true };
      }
      // SGR mouse: \x1b[<button;col;row(M|m)  = button 64=wheel up, 65=wheel down
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

    // Load conversation history before connecting SSE
    await this.eventsHandler.loadHistory(this.client, this.agentId);

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
      process.stdout.write(DISABLE_MOUSE + EXIT_ALT_SCREEN + '\x1b[2J\x1b[H');
      // Force-kill via SIGINT = process.exit() can hang when async handles
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
      await this._syncModelContextWindow();
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
        const prevModelKey = `${this.agent.provider_id}/${this.agent.model_id}`;
        this.agent = await this.client.getAgent(this.agentId);
        this.statusBar.setAgent(this.agent);
        this.chatPanel.setAgentName(this.agent.name || null);
        const nextModelKey = `${this.agent.provider_id}/${this.agent.model_id}`;
        if (prevModelKey !== nextModelKey) {
          await this._syncModelContextWindow(true);
        }
        // Force full redraw when agent status changes to avoid stale status lines
        this.tui.requestRender(prevStatus !== this.agent.status);
      } catch { /* ignore polling errors */ }
    }, 5000);
  }

  _parsePositiveInt(value) {
    const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  _readContextWindow(metadata) {
    if (!metadata || typeof metadata !== 'object') return 0;
    const candidates = [
      metadata.context_window,
      metadata.contextWindow,
      metadata.max_context_tokens,
      metadata.max_input_tokens,
      metadata.input_token_limit,
    ];
    for (const value of candidates) {
      const parsed = this._parsePositiveInt(value);
      if (parsed > 0) return parsed;
    }
    return 0;
  }

  async _syncModelContextWindow(force = false) {
    if (!this.agent?.provider_id || !this.agent?.model_id) return;
    const key = `${this.agent.provider_id}/${this.agent.model_id}`;
    if (!force && this._modelMetaKey === key) return;

    try {
      const models = await this.client.listModels(this.agent.provider_id);
      const selected = (models || []).find(m => m.model_id === this.agent.model_id);
      const contextWindow = this._readContextWindow(selected?.metadata);
      this.statusBar.setContextWindow(contextWindow);
      this._modelMetaKey = key;
      this.tui.requestRender();
    } catch {
      this.statusBar.setContextWindow(0);
      this._modelMetaKey = null;
    }
  }

  async _stopAgent() {
    if (this.agent && this.agent.status === 'running') {
      try {
        await this.client.stopAgent(this.agent.name);
        this.agent.status = 'idle';
        this.statusBar.setAgent(this.agent);
        this.eventsHandler._stopThinking();
        this.tui.requestRender(true);
        this.eventsHandler.addSystemMessage('Agent stopped.');
      } catch (err) {
        this.eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
    }
  }

  async _handleSubmit(text) {
    // Normalize: autocomplete can produce "//quit" when it inserts "/quit"
    // on top of the "/" trigger the user already typed.
    const task = text.trim().replace(/^\/{2,}/, '/');
    if (!task) return;

    // Pending ask: agent asked for user input via user.ask primitive
    if (this.eventsHandler.pendingAsk) {
      const { questionId } = this.eventsHandler.pendingAsk;
      this.eventsHandler.pendingAsk = null;
      this.eventsHandler.addUserMessage(task);
      try {
        await this.client.respondToAsk(this.agentId, questionId, task);
      } catch (err) {
        this.eventsHandler.addSystemMessage(`Error responding: ${err.message}`);
      }
      return;
    }

    // Two-step command: vault set (capture secret value)
    if (this._pendingVaultSet) {
      const { keyName } = this._pendingVaultSet;
      this._pendingVaultSet = null;
      try {
        await this.client.createSecret({ key_name: keyName, backend_key: keyName, value: task });
        this.eventsHandler.addSystemMessage(`Secret "${keyName}" stored.`);
      } catch (err) {
        this.eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }

    // Two-step command: model switch
    if (this._pendingModelSwitch) {
      const pending = this._pendingModelSwitch;
      const num = parseInt(task, 10);

      if (pending.step === 'provider') {
        if (isNaN(num) || num < 1 || num > pending.providers.length) {
          this.eventsHandler.addSystemMessage('Invalid selection. Cancelled.');
          this._pendingModelSwitch = null;
          return;
        }
        const provider = pending.providers[num - 1];
        try {
          const models = await this.client.listModels(provider.id);
          if (!models || models.length === 0) {
            this.eventsHandler.addSystemMessage(`No models for ${provider.id}.`);
            this._pendingModelSwitch = null;
            return;
          }
          const lines = models.map((m, i) => `  ${i + 1}. ${m.display_name || m.model_id}`);
          this.eventsHandler.addSystemMessage(`Models for ${provider.display_name || provider.id}:\n${lines.join('\n')}\nEnter number to select:`);
          this._pendingModelSwitch = { step: 'model', providerId: provider.id, models };
        } catch (err) {
          this.eventsHandler.addSystemMessage(`Error: ${err.message}`);
          this._pendingModelSwitch = null;
        }
        return;
      }

      if (pending.step === 'model') {
        this._pendingModelSwitch = null;
        if (isNaN(num) || num < 1 || num > pending.models.length) {
          this.eventsHandler.addSystemMessage('Invalid selection. Cancelled.');
          return;
        }
        const model = pending.models[num - 1];
        try {
          await this.client.updateAgent(this.agentId, {
            provider_id: pending.providerId,
            model_id: model.model_id,
          });
          this.agent.provider_id = pending.providerId;
          this.agent.model_id = model.model_id;
          this.statusBar.setAgent(this.agent);
          await this._syncModelContextWindow(true);
          this.tui.requestRender(true);
          this.eventsHandler.addSystemMessage(`Switched to ${pending.providerId}/${model.model_id}.`);
        } catch (err) {
          this.eventsHandler.addSystemMessage(`Error: ${err.message}`);
        }
        return;
      }
    }

    // Handle slash commands
    if (task === '/quit' || task === '/exit') {
      this.stop();
      return;
    }
    if (task === '/stop') {
      await this._stopAgent();
      return;
    }
    if (task === '/clear') {
      this.eventsHandler.clearMessages();
      return;
    }
    if (task === '/help') {
      const lines = [
        'Commands: ' + SLASH_COMMANDS.map(c => c.name).join(', '),
        'Shortcuts: Ctrl+X stop agent | Ctrl+Y select mode | Ctrl+C exit',
      ];
      this.eventsHandler.addSystemMessage(lines.join('\n'));
      return;
    }
    if (task === '/status') {
      const status = this.agent
        ? `Agent ${this.agent.name}: ${this.agent.status} | Provider: ${this.agent.provider_id} | Model: ${this.agent.model_id} | SSE: ${this.eventsHandler.connected ? 'connected' : 'disconnected'}`
        : 'No agent connected';
      this.eventsHandler.addSystemMessage(status);
      return;
    }
    if (task === '/select' || task === '/copy') {
      this._toggleSelectMode();
      return;
    }

    // Vault commands
    if (task === '/vault list') {
      try {
        const secrets = await this.client.listSecrets();
        if (!secrets || secrets.length === 0) {
          this.eventsHandler.addSystemMessage('No vault secrets found.');
        } else {
          const lines = secrets.map(s =>
            `  ${s.key_name} (${s.backend_key}) [${s.policy_label || 'default'}]`
          );
          this.eventsHandler.addSystemMessage('Vault secrets:\n' + lines.join('\n'));
        }
      } catch (err) {
        this.eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }
    if (task.startsWith('/vault set')) {
      const keyName = task.slice('/vault set'.length).trim();
      if (!keyName) {
        this.eventsHandler.addSystemMessage('Usage: /vault set <key_name>');
        return;
      }
      this._pendingVaultSet = { keyName };
      this.eventsHandler.addSystemMessage(`Enter the secret value for "${keyName}":`);
      return;
    }
    if (task.startsWith('/vault remove') || task.startsWith('/vault delete')) {
      const keyName = task.replace(/^\/vault (remove|delete)/, '').trim();
      if (!keyName) {
        this.eventsHandler.addSystemMessage('Usage: /vault remove <key_name>');
        return;
      }
      try {
        const secrets = await this.client.listSecrets();
        const match = secrets.find(s => s.key_name === keyName);
        if (!match) {
          this.eventsHandler.addSystemMessage(`Secret "${keyName}" not found.`);
          return;
        }
        await this.client.deleteSecret(match.id);
        this.eventsHandler.addSystemMessage(`Secret "${keyName}" removed.`);
      } catch (err) {
        this.eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }

    // Model commands
    if (task === '/model list') {
      try {
        const providers = await this.client.listProviders();
        if (!providers || providers.length === 0) {
          this.eventsHandler.addSystemMessage('No providers found.');
          return;
        }
        const sections = [];
        for (const p of providers) {
          const models = await this.client.listModels(p.id);
          const modelLines = (models || []).map(m => `    ${m.display_name || m.model_id}`);
          sections.push(`  ${p.display_name || p.id}:\n${modelLines.join('\n') || '    (none)'}`);
        }
        this.eventsHandler.addSystemMessage('Available models:\n' + sections.join('\n'));
      } catch (err) {
        this.eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }
    if (task === '/model switch') {
      try {
        const providers = await this.client.listProviders();
        if (!providers || providers.length === 0) {
          this.eventsHandler.addSystemMessage('No providers found.');
          return;
        }
        const lines = providers.map((p, i) => `  ${i + 1}. ${p.display_name || p.id}`);
        this.eventsHandler.addSystemMessage('Select a provider:\n' + lines.join('\n') + '\nEnter number:');
        this._pendingModelSwitch = { step: 'provider', providers };
      } catch (err) {
        this.eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
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
        await this.client.startRun(this.agent.name, task);
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
