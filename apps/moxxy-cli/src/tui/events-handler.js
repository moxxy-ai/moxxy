import { createSseClient } from '../sse-client.js';

// Error events always shown in chat regardless of debug mode
const ERROR_EVENTS = new Set([
  'run.failed', 'primitive.failed', 'skill.failed',
  'security.violation', 'sandbox.denied',
  'mcp.connection_failed', 'mcp.tool_failed',
]);

// Error events that should be shown as user-friendly system messages
// instead of raw event brackets (brackets only in debug mode).
// NOTE: primitive.failed is handled separately (with skill awareness) before this check.
const FRIENDLY_ERROR_EVENTS = new Set([
  'run.failed',
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

function toTokenNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function normalizeUsage(rawUsage) {
  if (!rawUsage || typeof rawUsage !== 'object') return null;

  const promptTokens = toTokenNumber(rawUsage.prompt_tokens || rawUsage.input_tokens);
  const completionTokens = toTokenNumber(rawUsage.completion_tokens || rawUsage.output_tokens);
  const totalTokens = toTokenNumber(rawUsage.total_tokens) || (promptTokens + completionTokens);

  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
    return null;
  }

  return { promptTokens, completionTokens, totalTokens };
}

function extractUsage(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const nested = normalizeUsage(payload.usage);
  if (nested) return nested;

  const responseNested = normalizeUsage(payload.response?.usage);
  if (responseNested) return responseNested;

  const topLevel = normalizeUsage(payload);
  if (topLevel) return topLevel;

  return null;
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
    this.stats = {
      eventCount: 0,
      tokenEstimate: 0,
      contextTokens: 0,
      skills: {},
      primitives: {},
    };
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
    this._activeSkillIdx = null; // index into this.messages for the running skill
    this._hiveStatus = null; // aggregated hive status tracker
    this._version = 0;
    this.messageVersion = 0;
    this._snapshot = null; // cached for useSyncExternalStore referential stability
  }

  /** Set callback invoked on any state change. */
  onChange(fn) {
    this._onChange = fn;
  }

  _notify() {
    this._version++;
    // Rebuild cached snapshot so getSnapshot() returns a new reference
    this._snapshot = {
      messages: this.messages,
      stats: { ...this.stats },
      connected: this.connected,
      thinking: this.thinking,
      pendingAsk: this.pendingAsk,
      version: this._version,
      messageVersion: this.messageVersion,
    };
    if (this._onChange) this._onChange();
  }

  getSnapshot() {
    if (!this._snapshot) {
      this._snapshot = {
        messages: this.messages,
        stats: { ...this.stats },
        connected: this.connected,
        thinking: this.thinking,
        pendingAsk: this.pendingAsk,
        version: this._version,
        messageVersion: this.messageVersion,
      };
    }
    return this._snapshot;
  }

  async loadHistory(client, agentId) {
    try {
      const data = await client.getHistory(agentId);
      const msgs = (data.messages || []).map(m => ({
        type: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
        ts: Date.parse(m.created_at),
      }));
      this.messages = [...msgs, ...this.messages];
      this.messageVersion++;
      this._notify();
    } catch {
      // Silently ignore history load failures
    }
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
    this.messageVersion++;
    this._notify();
  }

  addSystemMessage(content) {
    this.messages.push({ type: 'system', content, ts: Date.now() });
    this.messageVersion++;
    this._notify();
  }

  clearMessages() {
    this.messages = [];
    this._assistantBuffer = '';
    this.messageVersion++;
    this._notify();
  }

  _isConnectionError(err) {
    const cause = err.cause;
    if (cause && (cause.code === 'ECONNREFUSED' || cause.code === 'ECONNRESET')) return true;
    const msg = (err.message || '').toLowerCase();
    return msg.includes('econnrefused') || msg.includes('fetch failed');
  }

  _flushDelta() {
    // Flush parent assistant buffer
    const content = this._assistantBuffer;
    if (content) {
      const last = this.messages[this.messages.length - 1];
      if (last && last.type === 'assistant' && last.streaming) {
        last.content = content;
      } else {
        this.messages.push({ type: 'assistant', content, streaming: true, ts: Date.now() });
      }
      this.messageVersion++;
      this._notify();
    }
  }

  _processSubAgentEvent(event) {
    const type = event.event_type;
    const payload = event.payload || {};
    const agentId = event.agent_id;
    const sub = this._subAgents.get(agentId);
    if (!sub) return;

    // Track sub-agent text internally but don't render in chat.
    // Hive events (task created/claimed/completed) are shown instead.
    if (type === 'message.delta') {
      sub.buffer += (payload.content || payload.text || '');
      return;
    }

    if (type === 'message.final') {
      sub.buffer = '';
      return;
    }

    // Track stats for sub-agent primitives but don't render in chat
    if (type === 'primitive.invoked' && payload.name) {
      this.stats.primitives[payload.name] = (this.stats.primitives[payload.name] || 0) + 1;
      return;
    }

    if (type === 'primitive.completed' || type === 'primitive.failed') {
      return;
    }

    // Pass other sub-agent events through in debug mode only
    if (this.debug) {
      this.messages.push({ type: 'event', eventType: type, payload, ts: event.ts });
      this.messageVersion++;
      this._notify();
    }
  }

  _updateHiveStatus(type, payload, ts) {
    if (!this._hiveStatus) {
      this._hiveStatus = {
        totalTasks: 0, completedTasks: 0, inProgressTasks: 0,
        workers: 0, recentEvents: [],
      };
    }
    const hs = this._hiveStatus;

    // Build a short description for the recent events log
    let desc = '';
    if (type === 'hive.task_created') {
      hs.totalTasks++;
      desc = `Task "${payload.title || 'untitled'}" created`;
    } else if (type === 'hive.task_claimed') {
      hs.inProgressTasks++;
      desc = `Task claimed by ${payload.agent_id || 'worker'}`;
    } else if (type === 'hive.task_completed') {
      hs.completedTasks++;
      hs.inProgressTasks = Math.max(0, hs.inProgressTasks - 1);
      desc = `Task completed by ${payload.agent_id || 'worker'}`;
    } else if (type === 'hive.member_joined') {
      hs.workers++;
      desc = `${payload.agent_id || 'worker'} joined as ${payload.role || 'worker'}`;
    } else if (type === 'hive.signal_posted') {
      desc = `Signal: ${payload.signal_type || 'info'} from ${payload.author || 'agent'}`;
    } else if (type === 'hive.proposal_created') {
      desc = `Proposal: "${payload.title || 'untitled'}"`;
    } else if (type === 'hive.vote_cast') {
      desc = `Vote: ${payload.vote || '?'} by ${payload.voter || 'agent'}`;
    } else if (type === 'hive.disbanded') {
      desc = 'Hive disbanded';
    } else {
      desc = type.replace('hive.', '');
    }

    // Keep only last 3 events
    hs.recentEvents.push(desc);
    if (hs.recentEvents.length > 3) hs.recentEvents.shift();

    // In debug mode, also add individual hive-event messages
    if (this.debug) {
      this.messages.push({ type: 'hive-event', subtype: type.replace('hive.', ''), content: desc, ts });
    }

    // Find or create the single hive-status message
    const existingIdx = this.messages.findIndex(m => m.type === 'hive-status');
    const statusMsg = {
      type: 'hive-status',
      totalTasks: hs.totalTasks,
      completedTasks: hs.completedTasks,
      inProgressTasks: hs.inProgressTasks,
      workers: hs.workers,
      recentEvents: [...hs.recentEvents],
      ts,
    };

    if (existingIdx >= 0) {
      this.messages[existingIdx] = statusMsg;
    } else {
      this.messages.push(statusMsg);
    }
    this.messageVersion++;
    this._notify();
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
    if (type === 'model.response') {
      const usage = extractUsage(payload);
      if (usage) {
        const promptTokens = usage.promptTokens;
        const completionTokens = usage.completionTokens;
        const totalTokens = usage.totalTokens;

        this.stats.tokenEstimate += totalTokens;
        this.stats.contextTokens = promptTokens || Math.max(0, totalTokens - completionTokens);
      } else {
        // Fallback estimate when provider does not report usage in payload.
        const contentLength = payload.content_length || 0;
        if (contentLength > 0) {
          this.stats.tokenEstimate += Math.ceil(contentLength / 4);
        }
      }
    }

    // Register new sub-agents and show in chat
    if (type === 'subagent.spawned') {
      const subId = payload.sub_agent_id || payload.child_name;
      const name = payload.name || payload.child_name || subId;
      const task = payload.task || '';
      this._subAgents.set(subId, { name, task, buffer: '', status: 'running' });
      this.messages.push({
        type: 'tool', name: `agent.spawn → ${name}`, status: 'invoked',
        arguments: task ? `task: ${task.length > PARAM_TRUNCATE ? task.slice(0, PARAM_TRUNCATE) + '…' : task}` : null,
        ts: event.ts,
      });
      this.messageVersion++;
      this._notify();
      return;
    }

    // Handle sub-agent completion
    if (type === 'subagent.completed') {
      const subId = payload.sub_agent_id || payload.child_name;
      const sub = this._subAgents.get(subId);
      if (sub) {
        sub.status = 'completed';
        // Update matching invoked message to completed
        for (let i = this.messages.length - 1; i >= 0; i--) {
          const m = this.messages[i];
          if (m.type === 'tool' && m.name === `agent.spawn → ${sub.name}` && m.status === 'invoked') {
            m.status = 'completed';
            break;
          }
        }
        this.messageVersion++;
        this._notify();
      }
      return;
    }

    if (type === 'subagent.failed') {
      const subId = payload.sub_agent_id || payload.child_name;
      const sub = this._subAgents.get(subId);
      if (sub) {
        sub.status = 'failed';
        // Update matching invoked message to error
        for (let i = this.messages.length - 1; i >= 0; i--) {
          const m = this.messages[i];
          if (m.type === 'tool' && m.name === `agent.spawn → ${sub.name}` && m.status === 'invoked') {
            m.status = 'error';
            m.error = payload.error || 'sub-agent failed';
            break;
          }
        }
        this.messageVersion++;
        this._notify();
      }
      return;
    }

    // Handle hive events via aggregated status tracker
    if (type.startsWith('hive.')) {
      this._updateHiveStatus(type, payload, event.ts);
      return;
    }

    // Handle heartbeat events - show as system notifications in chat
    if (type === 'heartbeat.completed') {
      const msg = payload.message || 'Heartbeat fired';
      const hbId = payload.heartbeat_id ? ` (${payload.heartbeat_id.slice(0, 8)})` : '';
      this.messages.push({ type: 'system', content: `Heartbeat${hbId}: ${msg}`, ts: event.ts });
      this.messageVersion++;
      this._notify();
      return;
    }
    if (type === 'heartbeat.triggered' || type === 'heartbeat.failed') {
      if (this.debug) {
        const detail = type === 'heartbeat.failed' ? (payload.error || 'failed') : `action=${payload.action_type}`;
        this.messages.push({ type: 'event', eventType: type, payload, ts: event.ts });
        this.messageVersion++;
        this._notify();
      }
      return;
    }

    // MCP events
    if (type === 'mcp.connected') {
      this.messages.push({ type: 'system', content: `MCP server connected: ${payload.server_id || 'unknown'}`, ts: event.ts });
      this.messageVersion++;
      this._notify();
      return;
    }
    if (type === 'mcp.disconnected') {
      this.messages.push({ type: 'system', content: `MCP server disconnected: ${payload.server_id || 'unknown'}`, ts: event.ts });
      this.messageVersion++;
      this._notify();
      return;
    }
    if (type === 'mcp.connection_failed') {
      const error = payload.error ? `: ${payload.error}` : '';
      this.messages.push({ type: 'system', content: `MCP connection failed: ${payload.server_id || 'unknown'}${error}`, ts: event.ts });
      this.messageVersion++;
      this._notify();
      return;
    }
    if (type === 'mcp.tool_invoked') {
      this.messages.push({
        type: 'tool', name: `mcp:${payload.server_id || '?'}/${payload.name || 'unknown'}`, status: 'invoked',
        arguments: formatParams(payload.arguments),
        rawArguments: payload.arguments,
        ts: event.ts,
      });
      this.messageVersion++;
      this._notify();
      return;
    }
    if (type === 'mcp.tool_completed') {
      const toolName = `mcp:${payload.server_id || '?'}/${payload.name || 'unknown'}`;
      const last = this.messages[this.messages.length - 1];
      if (last && last.type === 'tool' && last.name === toolName && last.status === 'invoked') {
        last.status = 'completed';
        last.result = formatParams(payload.result);
        last.rawResult = payload.result;
      }
      this.messageVersion++;
      this._notify();
      return;
    }
    if (type === 'mcp.tool_failed') {
      const toolName = `mcp:${payload.server_id || '?'}/${payload.name || 'unknown'}`;
      const last = this.messages[this.messages.length - 1];
      if (last && last.type === 'tool' && last.name === toolName && last.status === 'invoked') {
        last.status = 'error';
        last.error = payload.error || 'unknown error';
      } else {
        this.messages.push({
          type: 'tool', name: toolName, status: 'error',
          error: payload.error || 'unknown error',
          ts: event.ts,
        });
      }
      this.messageVersion++;
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
      this.messageVersion++;
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
      this.messageVersion++;
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
      // Close active skill session on final message
      if (this._activeSkillIdx != null) {
        const skill = this.messages[this._activeSkillIdx];
        if (skill && skill.status === 'running') {
          skill.status = 'completed';
        }
        this._activeSkillIdx = null;
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
      this.messageVersion++;
      this._notify();
      return;
    }

    // Stop thinking on run completion or errors
    if (type === 'run.completed' || type === 'run.failed') {
      if (this.thinking) this._stopThinking();
      // Close active skill session on run end
      if (this._activeSkillIdx != null) {
        const skill = this.messages[this._activeSkillIdx];
        if (skill) {
          skill.status = type === 'run.failed' ? 'error' : 'completed';
        }
        this._activeSkillIdx = null;
      }
    }

    // Silence errors for hidden tool prefixes (e.g. agent.*)
    if (type === 'primitive.failed' && isHiddenTool(payload.name || '')) {
      return;
    }

    // Handle primitive.failed with skill awareness BEFORE friendly error fallback
    if (type === 'primitive.failed') {
      const toolName = payload.name || 'unknown';
      const errorMsg = payload.error || 'unknown error';

      // skill.execute itself failed → mark the skill as error and close session
      if (toolName === 'skill.execute' && this._activeSkillIdx != null) {
        const skill = this.messages[this._activeSkillIdx];
        if (skill) {
          skill.status = 'error';
          skill.error = errorMsg;
        }
        this._activeSkillIdx = null;
        this.messageVersion++;
        this._notify();
        return;
      }

      // A tool within an active skill failed → mark the step as error
      if (this._activeSkillIdx != null) {
        const skill = this.messages[this._activeSkillIdx];
        if (skill && skill.status === 'running') {
          const step = [...skill.steps].reverse().find(s => s.name === toolName && s.status === 'running');
          if (step) {
            step.status = 'error';
            step.error = errorMsg;
            this.messageVersion++;
            this._notify();
            return;
          }
        }
      }

      // Update the last tool message for the same primitive if it was just invoked
      const last = this.messages[this.messages.length - 1];
      if (last && last.type === 'tool' && last.name === toolName && last.status === 'invoked') {
        last.status = 'error';
        last.error = errorMsg;
        this.messageVersion++;
        this._notify();
        return;
      }

      // Fallback: show as friendly system message (non-debug mode)
      if (!this.debug) {
        this.messages.push({ type: 'system', content: `Tool error: ${errorMsg}`, ts: event.ts });
        this.messageVersion++;
        this._notify();
        return;
      }
    }

    // For user-facing error events, show as a friendly system message
    // (raw event format only in debug mode)
    if (!this.debug && FRIENDLY_ERROR_EVENTS.has(type)) {
      const detail = payload.error || payload.message || 'Unknown error';
      const label = type === 'run.failed' ? 'Run failed' : 'Tool error';
      this.messages.push({ type: 'system', content: `${label}: ${detail}`, ts: event.ts });
      this.messageVersion++;
      this._notify();
      return;
    }

    // Show tool activity events as compact messages
    if (TOOL_ACTIVITY_EVENTS.has(type)) {
      if (type === 'primitive.invoked') {
        if (isHiddenTool(payload.name || '')) return;
        const toolName = payload.name || 'unknown';

        // Detect skill.execute → start a skill session
        if (toolName === 'skill.execute') {
          // Parse arguments — may be an object or a JSON string
          let args = payload.arguments;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { args = {}; }
          }
          const skillName = (args && args.name) || 'unknown';

          // Close any previous active skill
          if (this._activeSkillIdx != null) {
            const prev = this.messages[this._activeSkillIdx];
            if (prev && prev.status === 'running') {
              prev.status = 'completed';
            }
          }

          this.messages.push({
            type: 'skill', name: skillName, status: 'running',
            steps: [], ts: event.ts,
          });
          this._activeSkillIdx = this.messages.length - 1;
          this.messageVersion++;
          this._notify();
          return;
        }

        // If a skill is active, nest this tool as a step
        if (this._activeSkillIdx != null) {
          const skill = this.messages[this._activeSkillIdx];
          if (skill && skill.status === 'running') {
            skill.steps.push({ name: toolName, status: 'running', result: null });
            this.messageVersion++;
            this._notify();
            return;
          }
        }

        this.messages.push({
          type: 'tool', name: toolName, status: 'invoked',
          arguments: formatParams(payload.arguments),
          rawArguments: payload.arguments,
          ts: event.ts,
        });
        this.messageVersion++;
        this._notify();
        return;
      }
      if (type === 'primitive.completed') {
        if (isHiddenTool(payload.name || '')) return;
        const toolName = payload.name || 'unknown';

        // skill.execute completed → just absorb (skill stays running for subsequent tools)
        if (toolName === 'skill.execute') {
          // Update skill name from result if available
          if (this._activeSkillIdx != null) {
            const skill = this.messages[this._activeSkillIdx];
            const resultName = payload.result && typeof payload.result === 'object' && payload.result.name;
            if (skill && resultName) {
              skill.name = resultName;
            }
          }
          this.messageVersion++;
          this._notify();
          return;
        }

        // If a skill is active, update the step
        if (this._activeSkillIdx != null) {
          const skill = this.messages[this._activeSkillIdx];
          if (skill && skill.status === 'running') {
            const step = [...skill.steps].reverse().find(s => s.name === toolName && s.status === 'running');
            if (step) {
              step.status = 'completed';
              step.result = formatParams(payload.result);
            }
            this.messageVersion++;
            this._notify();
            return;
          }
        }

        // Update the last tool message for the same primitive if it was just invoked
        const last = this.messages[this.messages.length - 1];
        if (last && last.type === 'tool' && last.name === toolName && last.status === 'invoked') {
          last.status = 'completed';
          last.result = formatParams(payload.result);
          last.rawResult = payload.result;
        }
        this.messageVersion++;
        this._notify();
        return;
      }
    }

    // Show skill activity events as compact bordered messages
    if (type === 'skill.invoked') {
      // Close any previous active skill
      if (this._activeSkillIdx != null) {
        const prev = this.messages[this._activeSkillIdx];
        if (prev && prev.status === 'running') {
          prev.status = 'completed';
        }
      }
      this.messages.push({
        type: 'skill', name: payload.name || 'unknown', status: 'running',
        steps: [], ts: event.ts,
      });
      this._activeSkillIdx = this.messages.length - 1;
      this.messageVersion++;
      this._notify();
      return;
    }
    if (type === 'skill.completed') {
      // Update the last skill message if it matches
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const m = this.messages[i];
        if (m.type === 'skill' && m.name === (payload.name || 'unknown') && m.status === 'running') {
          m.status = 'completed';
          break;
        }
      }
      this._activeSkillIdx = null;
      this.messageVersion++;
      this._notify();
      return;
    }
    if (type === 'skill.failed') {
      // Update the last skill message if it matches, otherwise show as error
      let found = false;
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const m = this.messages[i];
        if (m.type === 'skill' && m.name === (payload.name || 'unknown') && m.status === 'running') {
          m.status = 'error';
          m.error = payload.error || 'unknown error';
          found = true;
          break;
        }
      }
      if (!found) {
        this.messages.push({
          type: 'skill', name: payload.name || 'unknown', status: 'error',
          error: payload.error || 'unknown error', steps: [], ts: event.ts,
        });
      }
      this._activeSkillIdx = null;
      this.messageVersion++;
      this._notify();
      return;
    }

    // Show error events always; show all events in debug mode
    if (ERROR_EVENTS.has(type) || this.debug) {
      this.messages.push({ type: 'event', eventType: type, payload, ts: event.ts });
      this.messageVersion++;
      this._notify();
    }
  }
}
