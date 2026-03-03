import { createSseClient } from '../sse-client.js';

// Error events always shown in chat regardless of debug mode
const ERROR_EVENTS = new Set([
  'run.failed', 'primitive.failed', 'skill.failed',
  'security.violation', 'sandbox.denied',
]);

// Error events that should be shown as user-friendly system messages
// instead of raw event brackets (brackets only in debug mode)
const FRIENDLY_ERROR_EVENTS = new Set([
  'run.failed', 'primitive.failed',
]);

// Tool activity events always shown in chat as compact messages
const TOOL_ACTIVITY_EVENTS = new Set([
  'primitive.invoked', 'primitive.completed',
]);

const DELTA_FLUSH_MS = 50;
const PARAM_TRUNCATE = 80;
const HIDDEN_TOOL_PREFIXES = ['agent.'];

function isHiddenTool(name) {
  return HIDDEN_TOOL_PREFIXES.some(p => name.startsWith(p));
}

function formatValue(v) {
  if (v == null) return 'null';
  if (typeof v === 'string') return v.length > PARAM_TRUNCATE ? v.slice(0, PARAM_TRUNCATE) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.length} items]`;
  return JSON.stringify(v);
}

function formatParams(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw !== 'object' || Array.isArray(raw)) return formatValue(raw);
  const keys = Object.keys(raw);
  if (keys.length === 0) return null;
  return keys.map(k => `${k}: ${formatValue(raw[k])}`).join('\n');
}

/**
 * Imperative SSE event handler.
 * Replaces the React useEvents hook.
 */
export class EventsHandler {
  constructor(client, agentId, { debug = false } = {}) {
    this.client = client;
    this.agentId = agentId;
    this.debug = debug;
    this.messages = [];
    this.stats = { eventCount: 0, tokenEstimate: 0, skills: {}, primitives: {} };
    this.connected = false;
    this._assistantBuffer = '';
    this._deltaTimer = null;
    this._active = false;
    this._sse = null;
    this._onChange = null; // callback when messages/stats change
    this.thinking = false;
    this._thinkingTimer = null;
    this.pendingAsk = null; // { questionId, question } = set when agent asks user
    this._subAgents = new Map(); // agentId -> { name, task, buffer, status }
  }

  /** Set callback invoked on any state change. */
  onChange(fn) {
    this._onChange = fn;
  }

  _notify() {
    if (this._onChange) this._onChange();
  }

  async connect() {
    if (!this.agentId) return;
    this._active = true;
    let retryCount = 0;

    while (this._active && retryCount < 10) {
      try {
        this._sse = createSseClient(this.client.baseUrl, this.client.token, { agent_id: this.agentId });
        retryCount = 0;
        for await (const event of this._sse.stream()) {
          if (!this._active) return;
          if (!this.connected) {
            this.connected = true;
            this._notify();
          }
          this._processEvent(event);
        }
        if (!this._active) return;
      } catch (err) {
        if (err.name === 'AbortError' || !this._active) return;
        retryCount++;
        this.connected = false;
        if (err.isGatewayDown || this._isConnectionError(err)) {
          this.addSystemMessage('Gateway is not running. Start it with: moxxy gateway start');
          this._notify();
          return;
        }
        this._notify();
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  disconnect() {
    this._active = false;
    this._stopThinking();
    if (this._deltaTimer) {
      clearTimeout(this._deltaTimer);
      this._deltaTimer = null;
    }
    if (this._sse) this._sse.disconnect();
  }

  _startThinking() {
    this.thinking = true;
    if (this._thinkingTimer) return;
    this._thinkingTimer = setInterval(() => this._notify(), 120);
  }

  _stopThinking() {
    this.thinking = false;
    if (this._thinkingTimer) {
      clearInterval(this._thinkingTimer);
      this._thinkingTimer = null;
    }
  }

  addUserMessage(content) {
    this._assistantBuffer = '';
    this.messages.push({ type: 'user', content, ts: Date.now() });
    this._startThinking();
    this._notify();
  }

  addSystemMessage(content) {
    this.messages.push({ type: 'system', content, ts: Date.now() });
    this._notify();
  }

  clearMessages() {
    this.messages = [];
    this._assistantBuffer = '';
    this._notify();
  }

  _isConnectionError(err) {
    const cause = err.cause;
    if (cause && (cause.code === 'ECONNREFUSED' || cause.code === 'ECONNRESET')) return true;
    const msg = (err.message || '').toLowerCase();
    return msg.includes('econnrefused') || msg.includes('fetch failed');
  }

  _flushDelta() {
    let changed = false;

    // Flush parent assistant buffer
    const content = this._assistantBuffer;
    if (content) {
      const last = this.messages[this.messages.length - 1];
      if (last && last.type === 'assistant' && last.streaming) {
        last.content = content;
      } else {
        this.messages.push({ type: 'assistant', content, streaming: true, ts: Date.now() });
      }
      changed = true;
    }

    // Flush sub-agent buffers
    for (const [agentId, sub] of this._subAgents) {
      if (!sub.buffer) continue;
      const last = this.messages[this.messages.length - 1];
      if (last && last.type === 'subagent-text' && last.agentId === agentId && last.streaming) {
        last.content = sub.buffer;
      } else {
        this.messages.push({
          type: 'subagent-text', agentId, name: sub.name,
          content: sub.buffer, streaming: true, ts: Date.now(),
        });
      }
      changed = true;
    }

    if (changed) this._notify();
  }

  _processSubAgentEvent(event) {
    const type = event.event_type;
    const payload = event.payload || {};
    const agentId = event.agent_id;
    const sub = this._subAgents.get(agentId);
    if (!sub) return;

    if (type === 'message.delta') {
      sub.buffer += (payload.content || payload.text || '');
      if (!this._deltaTimer) {
        this._deltaTimer = setTimeout(() => {
          this._deltaTimer = null;
          this._flushDelta();
        }, DELTA_FLUSH_MS);
      }
      return;
    }

    if (type === 'message.final') {
      if (this._deltaTimer) {
        clearTimeout(this._deltaTimer);
        this._deltaTimer = null;
      }
      const finalContent = payload.content || payload.text || sub.buffer;
      sub.buffer = '';
      const last = this.messages[this.messages.length - 1];
      if (last && last.type === 'subagent-text' && last.agentId === agentId && last.streaming) {
        last.content = finalContent;
        last.streaming = false;
      } else {
        this.messages.push({
          type: 'subagent-text', agentId, name: sub.name,
          content: finalContent, streaming: false, ts: event.ts,
        });
      }
      this._notify();
      return;
    }

    if (type === 'primitive.invoked') {
      if (isHiddenTool(payload.name || '')) return;
      this.messages.push({
        type: 'tool', name: payload.name || 'unknown', status: 'invoked',
        arguments: formatParams(payload.arguments), ts: event.ts,
        subAgent: sub.name,
      });
      this._notify();
      return;
    }

    if (type === 'primitive.completed') {
      if (isHiddenTool(payload.name || '')) return;
      const last = this.messages[this.messages.length - 1];
      if (last && last.type === 'tool' && last.name === (payload.name || 'unknown') && last.status === 'invoked' && last.subAgent === sub.name) {
        last.status = 'completed';
        last.result = formatParams(payload.result);
      }
      this._notify();
      return;
    }

    if (type === 'primitive.failed') {
      if (isHiddenTool(payload.name || '')) return;
      const last = this.messages[this.messages.length - 1];
      if (last && last.type === 'tool' && last.name === (payload.name || 'unknown') && last.status === 'invoked' && last.subAgent === sub.name) {
        last.status = 'error';
        last.error = payload.error || 'unknown error';
      }
      this._notify();
      return;
    }

    // Pass other sub-agent events through in debug mode
    if (this.debug) {
      this.messages.push({ type: 'event', eventType: type, payload, ts: event.ts });
      this._notify();
    }
  }

  _processEvent(event) {
    const type = event.event_type;
    const payload = event.payload || {};

    // Update stats
    this.stats.eventCount++;
    if (type === 'skill.invoked' && payload.name) {
      this.stats.skills[payload.name] = (this.stats.skills[payload.name] || 0) + 1;
    }
    if (type === 'primitive.invoked' && payload.name) {
      this.stats.primitives[payload.name] = (this.stats.primitives[payload.name] || 0) + 1;
    }
    if (type === 'model.response' && payload.usage) {
      this.stats.tokenEstimate += (payload.usage.total_tokens || 0);
    }

    // Register new sub-agents
    if (type === 'subagent.spawned') {
      const subId = payload.sub_agent_id;
      const name = payload.name || subId;
      const task = payload.task || '';
      this._subAgents.set(subId, { name, task, buffer: '', status: 'running' });
      this.messages.push({ type: 'subagent-spawned', agentId: subId, name, task, ts: event.ts });
      this._notify();
      return;
    }

    // Handle sub-agent completion/failure (emitted on parent's agent_id)
    if (type === 'subagent.completed') {
      const subId = payload.sub_agent_id;
      const name = payload.name || subId;
      const sub = this._subAgents.get(subId);
      if (sub) sub.status = 'completed';
      this.messages.push({ type: 'subagent-done', agentId: subId, name, status: 'completed', result: payload.result, ts: event.ts });
      this._notify();
      return;
    }

    if (type === 'subagent.failed') {
      const subId = payload.sub_agent_id;
      const name = payload.name || subId;
      const sub = this._subAgents.get(subId);
      if (sub) sub.status = 'failed';
      this.messages.push({ type: 'subagent-done', agentId: subId, name, status: 'failed', error: payload.error, ts: event.ts });
      this._notify();
      return;
    }

    // Route events from sub-agents
    if (event.agent_id && event.agent_id !== this.agentId && this._subAgents.has(event.agent_id)) {
      this._processSubAgentEvent(event);
      return;
    }

    // Show channel messages (from Telegram, Discord, etc.) as user messages
    if (type === 'channel.message_received') {
      const sender = payload.sender_name || 'User';
      const channel = payload.channel_type || 'channel';
      const task = payload.task || '';
      this._assistantBuffer = '';
      this.messages.push({
        type: 'channel', sender, channel, content: task, ts: event.ts,
      });
      this._startThinking();
      this._notify();
      return;
    }

    // Handle user.ask = agent is asking the user a question
    if (type === 'user.ask_question') {
      if (this.thinking) this._stopThinking();
      const questionId = payload.question_id;
      const question = payload.question || 'The agent is asking for input.';
      this.pendingAsk = { questionId, question };
      this.messages.push({ type: 'ask', question, questionId, ts: event.ts });
      this._notify();
      return;
    }

    // Handle user.ask_answered = question was answered, clear pending state
    if (type === 'user.ask_answered') {
      this.pendingAsk = null;
      this._startThinking();
      this._notify();
      return;
    }

    if (type === 'message.delta') {
      if (this.thinking) this._stopThinking();
      this._assistantBuffer += (payload.content || payload.text || '');
      // Debounce renders
      if (!this._deltaTimer) {
        this._deltaTimer = setTimeout(() => {
          this._deltaTimer = null;
          this._flushDelta();
        }, DELTA_FLUSH_MS);
      }
      return;
    }

    if (type === 'message.final') {
      if (this.thinking) this._stopThinking();
      if (this._deltaTimer) {
        clearTimeout(this._deltaTimer);
        this._deltaTimer = null;
      }
      const finalContent = payload.content || payload.text || this._assistantBuffer;
      this._assistantBuffer = '';
      const last = this.messages[this.messages.length - 1];
      if (last && last.type === 'assistant' && last.streaming) {
        last.content = finalContent;
        last.streaming = false;
      } else {
        this.messages.push({ type: 'assistant', content: finalContent, streaming: false, ts: event.ts });
      }
      this._notify();
      return;
    }

    // Stop thinking on run completion or errors
    if (type === 'run.completed' || type === 'run.failed') {
      if (this.thinking) this._stopThinking();
    }

    // Silence errors for hidden tool prefixes (e.g. agent.*)
    if (type === 'primitive.failed' && isHiddenTool(payload.name || '')) {
      return;
    }

    // For user-facing error events, show as a friendly system message
    // (raw event format only in debug mode)
    if (!this.debug && FRIENDLY_ERROR_EVENTS.has(type)) {
      const detail = payload.error || payload.message || 'Unknown error';
      const label = type === 'run.failed' ? 'Run failed' : 'Tool error';
      this.messages.push({ type: 'system', content: `${label}: ${detail}`, ts: event.ts });
      this._notify();
      return;
    }

    // Show tool activity events as compact messages
    if (TOOL_ACTIVITY_EVENTS.has(type)) {
      if (type === 'primitive.invoked') {
        if (isHiddenTool(payload.name || '')) return;
        this.messages.push({
          type: 'tool', name: payload.name || 'unknown', status: 'invoked',
          arguments: formatParams(payload.arguments), ts: event.ts,
        });
        this._notify();
        return;
      }
      if (type === 'primitive.completed') {
        if (isHiddenTool(payload.name || '')) return;
        // Update the last tool message for the same primitive if it was just invoked
        const last = this.messages[this.messages.length - 1];
        if (last && last.type === 'tool' && last.name === (payload.name || 'unknown') && last.status === 'invoked') {
          last.status = 'completed';
          last.result = formatParams(payload.result);
        }
        this._notify();
        return;
      }
    }

    // Show tool error events
    if (type === 'primitive.failed') {
      // Update the last tool message for the same primitive if it was just invoked
      const last = this.messages[this.messages.length - 1];
      if (last && last.type === 'tool' && last.name === (payload.name || 'unknown') && last.status === 'invoked') {
        last.status = 'error';
        last.error = payload.error || 'unknown error';
        this._notify();
        return;
      }
    }

    // Show error events always; show all events in debug mode
    if (ERROR_EVENTS.has(type) || this.debug) {
      this.messages.push({ type: 'event', eventType: type, payload, ts: event.ts });
      this._notify();
    }
  }
}
