import chalk from 'chalk';
import { styles } from './helpers.js';
import { Markdown, wrapTextWithAnsi, truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';

const MD_THEME = {
  heading: (s) => chalk.bold.cyan(s),
  link: (s) => chalk.underline.cyan(s),
  linkUrl: (s) => chalk.dim(s),
  code: (s) => chalk.yellow(s),
  codeBlock: (s) => chalk.white(s),
  codeBlockBorder: (s) => chalk.dim(s),
  quote: (s) => chalk.italic(s),
  quoteBorder: (s) => chalk.dim(s),
  hr: (s) => chalk.dim(s),
  listBullet: (s) => chalk.cyan(s),
  bold: (s) => chalk.bold(s),
  italic: (s) => chalk.italic(s),
  strikethrough: (s) => chalk.strikethrough(s),
  underline: (s) => chalk.underline(s),
};

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const PADDING_X = 5; // horizontal inset (each side)
const PADDING_Y = 2;  // vertical inset (blank lines, each side)

function toTokenNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function readTotalTokens(payload) {
  if (!payload || typeof payload !== 'object') return 0;

  const fromUsage = toTokenNumber(payload.usage?.total_tokens);
  if (fromUsage > 0) return fromUsage;

  const fromResponseUsage = toTokenNumber(payload.response?.usage?.total_tokens);
  if (fromResponseUsage > 0) return fromResponseUsage;

  const fromTopLevel = toTokenNumber(payload.total_tokens);
  if (fromTopLevel > 0) return fromTopLevel;

  const prompt = toTokenNumber(payload.prompt_tokens || payload.input_tokens);
  const completion = toTokenNumber(payload.completion_tokens || payload.output_tokens);
  return prompt + completion;
}

function eventSummary(eventType, payload) {
  switch (eventType) {
    case 'run.started': return payload.task ? `Task: ${payload.task}` : 'Run started';
    case 'run.completed': return 'Run completed';
    case 'run.failed': return `Failed: ${payload.error || payload.message || ''}`;
    case 'skill.invoked': return payload.name || 'skill';
    case 'skill.completed': return payload.name || 'skill';
    case 'skill.failed': return `${payload.name || 'skill'}: ${payload.error || 'failed'}`;
    case 'primitive.invoked': return payload.name || 'primitive';
    case 'primitive.completed': return payload.name || 'primitive';
    case 'primitive.failed': return `${payload.name || 'primitive'}: ${payload.error || 'failed'}`;
    case 'security.violation': return payload.reason || 'Security violation';
    case 'sandbox.denied': return payload.reason || 'Sandbox denied';
    case 'model.response': {
      const tokens = readTotalTokens(payload);
      return tokens ? `${tokens} tokens` : '';
    }
    default: return '';
  }
}

/**
 * Render a single message into terminal lines.
 */
function renderMessage(msg, width, agentName) {
  if (msg.type === 'user') {
    const header = styles.user.bold('User');
    const content = msg.content || '';
    const lines = wrapTextWithAnsi(content, width);
    return [header, ...lines];
  }

  if (msg.type === 'channel') {
    const channel = msg.channel ? msg.channel.charAt(0).toUpperCase() + msg.channel.slice(1) : 'Channel';
    const sender = msg.sender || 'User';
    const header = styles.user.bold(sender) + styles.dim(` via ${channel}`);
    const content = msg.content || '';
    const lines = wrapTextWithAnsi(content, width);
    return [header, ...lines];
  }

  if (msg.type === 'assistant') {
    const name = agentName || 'Assistant';
    const header = styles.accent.bold(name) + (msg.streaming ? styles.dim(' \u2026') : '');
    const content = msg.content || '';
    const md = new Markdown(content, 0, 0, MD_THEME);
    const lines = md.render(width);
    return [header, ...lines];
  }

  if (msg.type === 'subagent-spawned') {
    const header = chalk.magenta.bold(`▶ ${msg.name} spawned`);
    const lines = [header];
    if (msg.task) {
      const taskLines = wrapTextWithAnsi(msg.task, width);
      lines.push(...taskLines.map(l => chalk.magenta(l)));
    }
    return lines;
  }

  if (msg.type === 'subagent-text') {
    const name = msg.name || 'Sub-agent';
    const prefix = chalk.magenta('│ ');
    const header = prefix + chalk.magenta.bold(name) + (msg.streaming ? styles.dim(' …') : '');
    const content = msg.content || '';
    const md = new Markdown(content, 0, 0, MD_THEME);
    const contentLines = md.render(width - 2);
    return [header, ...contentLines.map(l => prefix + l)];
  }

  if (msg.type === 'subagent-done') {
    if (msg.status === 'completed') {
      return [chalk.magenta.bold(`✓ ${msg.name} completed`)];
    }
    const errorText = msg.error || 'unknown error';
    return [chalk.magenta.bold(`✗ ${msg.name} failed: `) + chalk.red(errorText)];
  }

  if (msg.type === 'hive-event') {
    const icons = {
      'task-created': '\u271A', 'task-claimed': '\u25B6', 'task-completed': '\u2713',
      'signal': '\u25C6', 'proposal': '\u25AA', 'vote': '\u25AA', 'member-joined': '\u25B6',
    };
    const icon = icons[msg.subtype] || '\u2B21';
    const header = chalk.yellow.bold(`${icon} Hive: `) + chalk.yellow(msg.content || '');
    return [header];
  }

  if (msg.type === 'ask') {
    const header = styles.warning.bold('? Agent needs your input');
    const question = msg.question || '';
    const questionLines = wrapTextWithAnsi(question, width);
    const hint = styles.dim('Type your answer below and press Enter.');
    return [header, ...questionLines, '', hint];
  }

  if (msg.type === 'system') {
    const lines = wrapTextWithAnsi(msg.content || '', width);
    return lines.map(l => styles.info(l));
  }

  if (msg.type === 'tool') {
    const toolPrefix = msg.subAgent ? `[${msg.subAgent}] ` : '';
    if (msg.status === 'error') {
      // Error: bordered box in error color
      const header = `\u2717 ${toolPrefix}${msg.name}`;
      const innerW = Math.max(header.length + 4, Math.min(width - 2, 40));
      const topFill = Math.max(0, innerW - header.length - 3);
      const top = styles.error('\u250c ' + header + ' ' + '\u2500'.repeat(topFill) + '\u2510');
      const errorText = msg.error || 'unknown error';
      const errorLines = wrapTextWithAnsi(errorText, innerW - 2);
      const rows = errorLines.map(l => {
        const pad = ' '.repeat(Math.max(0, innerW - 2 - visibleWidth(l)));
        return styles.error('\u2502 ') + styles.error(l) + styles.error(pad + ' \u2502');
      });
      const bot = styles.error('\u2514' + '\u2500'.repeat(innerW) + '\u2518');
      return [top, ...rows, bot];
    }
    if (msg.status === 'completed') {
      // Completed: bordered box showing the invocation arguments
      const header = `\u2713 ${toolPrefix}${msg.name}`;
      const innerW = Math.max(header.length + 4, Math.min(width - 2, 50));
      const topFill = Math.max(0, innerW - header.length - 3);
      const top = styles.dim('\u250c ') + styles.dim(header) + styles.dim(' ' + '\u2500'.repeat(topFill) + '\u2510');
      const toolLines = [top];
      if (msg.arguments) {
        const argLines = wrapTextWithAnsi(msg.arguments, innerW - 2);
        for (const l of argLines) {
          const pad = ' '.repeat(Math.max(0, innerW - 2 - visibleWidth(l)));
          toolLines.push(styles.dim('\u2502 ') + styles.dim(l) + styles.dim(pad + ' \u2502'));
        }
      }
      const bot = styles.dim('\u2514' + '\u2500'.repeat(innerW) + '\u2518');
      toolLines.push(bot);
      return toolLines;
    }
    // Invoked: bordered box with arguments context
    const header = `\u2699 ${toolPrefix}${msg.name}`;
    const innerW = Math.max(header.length + 4, Math.min(width - 2, 50));
    const topFill = Math.max(0, innerW - header.length - 3);
    const top = styles.dim('\u250c ') + styles.accent(header) + styles.dim(' ' + '\u2500'.repeat(topFill) + '\u2510');
    const toolLines = [top];
    if (msg.arguments) {
      const argLines = wrapTextWithAnsi(msg.arguments, innerW - 2);
      for (const l of argLines) {
        const pad = ' '.repeat(Math.max(0, innerW - 2 - visibleWidth(l)));
        toolLines.push(styles.dim('\u2502 ') + styles.dim(l) + styles.dim(pad + ' \u2502'));
      }
    }
    const bot = styles.dim('\u2514' + '\u2500'.repeat(innerW) + '\u2518');
    toolLines.push(bot);
    return toolLines;
  }

  if (msg.type === 'event') {
    const summary = eventSummary(msg.eventType, msg.payload || {});
    const isError = msg.eventType?.includes('failed') || msg.eventType?.includes('violation') || msg.eventType?.includes('denied');
    const colorFn = isError ? styles.error : styles.dim;
    if (isError && summary) {
      const header = colorFn(`[${msg.eventType}]`);
      const wrapped = wrapTextWithAnsi(summary, width - 1);
      return [header, ...wrapped.map(l => colorFn(' ' + l))];
    }
    const text = summary ? `[${msg.eventType}] ${summary}` : `[${msg.eventType}]`;
    return [truncateToWidth(colorFn(text), width)];
  }

  return [];
}

/**
 * Chat panel component that displays messages starting from the top.
 * Supports scrolling with Page Up / Page Down when content overflows.
 * Auto-scrolls to the bottom on new messages unless the user scrolled up.
 */
export class ChatPanel {
  constructor() {
    this.messages = [];
    this.agentName = null;
    this.thinking = false;
    this.height = 10; // available height, set externally
    this._scrollTop = 0;
    this._autoScroll = true;
    this._allLines = null;
    this._allLinesWidth = 0;
    this._cache = null;
    this._cacheWidth = 0;
  }

  setMessages(messages) {
    this.messages = messages;
    this._allLines = null;
    this._cache = null;
  }

  setAgentName(name) {
    if (this.agentName !== name) {
      this.agentName = name;
      this._allLines = null;
      this._cache = null;
    }
  }

  setHeight(height) {
    if (this.height !== height) {
      this.height = height;
      this._cache = null;
    }
  }

  setThinking(thinking) {
    this.thinking = thinking;
    // Always invalidate when thinking so the spinner animates
    this._allLines = null;
    this._cache = null;
  }

  invalidate() {
    this._allLines = null;
    this._cache = null;
  }

  /** Render all messages into a flat array of terminal lines (cached by width). */
  _renderAllLines(width) {
    if (this._allLines && this._allLinesWidth === width && !this.thinking) return this._allLines;
    const lines = [];
    for (let i = 0; i < this.messages.length; i++) {
      // Skip blank line between consecutive tool messages for compact display
      const isToolAfterTool = i > 0 && this.messages[i].type === 'tool' && this.messages[i - 1].type === 'tool';
      if (i > 0 && !isToolAfterTool) lines.push(''); // blank line between messages
      lines.push(...renderMessage(this.messages[i], width, this.agentName));
    }
    // Animated thinking indicator while waiting for agent response
    if (this.thinking) {
      const frame = SPINNER_FRAMES[Math.floor(Date.now() / 120) % SPINNER_FRAMES.length];
      lines.push('');
      lines.push(styles.user(`${frame} Thinking`));
    }
    this._allLines = lines;
    this._allLinesWidth = width;
    return lines;
  }

  /** Scroll up by n lines. Disables auto-scroll. */
  scrollUp(n = 3) {
    this._autoScroll = false;
    this._scrollTop = Math.max(0, this._scrollTop - n);
    this._cache = null;
  }

  /** Scroll down by n lines. Re-enables auto-scroll when reaching the bottom. */
  scrollDown(n = 3) {
    const contentHeight = this.height - 2 - PADDING_Y * 2;
    const totalLines = this._allLines ? this._allLines.length : 0;
    const maxScroll = Math.max(0, totalLines - contentHeight);
    this._scrollTop = Math.min(maxScroll, this._scrollTop + n);
    if (this._scrollTop >= maxScroll) {
      this._autoScroll = true;
    }
    this._cache = null;
  }

  /** Scroll to the very top. */
  scrollToTop() {
    this._autoScroll = false;
    this._scrollTop = 0;
    this._cache = null;
  }

  /** Scroll to the bottom and re-enable auto-scroll. */
  scrollToBottom() {
    this._autoScroll = true;
    this._cache = null;
  }

  render(width) {
    if (this._cache && this._cacheWidth === width && !this.thinking) return this._cache;

    const innerWidth = width - 2;
    const contentWidth = innerWidth - PADDING_X * 2;
    const innerHeight = this.height - 2;
    const contentHeight = innerHeight - PADDING_Y * 2;

    if (this.messages.length === 0) {
      const lines = [styles.dim('No messages yet. Type a task below.')];
      while (lines.length < contentHeight) lines.push('');
      return this._bordered(lines, innerWidth, false, false);
    }

    const allLines = this._renderAllLines(contentWidth);
    const totalLines = allLines.length;

    // Compute scroll position
    const maxScroll = Math.max(0, totalLines - contentHeight);
    if (this._autoScroll) {
      this._scrollTop = maxScroll;
    } else {
      this._scrollTop = Math.min(this._scrollTop, maxScroll);
    }

    // Extract visible window
    const start = this._scrollTop;
    const visible = allLines.slice(start, start + contentHeight);

    // Top-aligned: pad with empty lines at bottom
    while (visible.length < contentHeight) {
      visible.push('');
    }

    const hasAbove = start > 0;
    const hasBelow = start + contentHeight < totalLines;

    return this._bordered(visible, innerWidth, hasAbove, hasBelow);
  }

  _bordered(lines, innerWidth, hasAbove, hasBelow) {
    const leftPad = ' '.repeat(PADDING_X);

    // Top border with optional scroll-up indicator
    const scrollUpHint = hasAbove ? styles.dim(' \u25b2') : '';
    const topLabelLen = 6 + (hasAbove ? 2 : 0);
    const topFill = Math.max(0, innerWidth - topLabelLen);
    const topLine = styles.dim('\u250c') + styles.accent.bold(' Chat ') + scrollUpHint + styles.dim('\u2500'.repeat(topFill) + '\u2510');

    // Bottom border with optional scroll-down indicator
    const scrollDownHint = hasBelow ? ' \u25bc more ' : '';
    const botHintLen = hasBelow ? 8 : 0;
    const botFill = Math.max(0, innerWidth - botHintLen);
    const botLine = styles.dim('\u2514' + '\u2500'.repeat(botFill) + scrollDownHint + '\u2518');

    const emptyRow = styles.dim('\u2502') + ' '.repeat(innerWidth) + styles.dim('\u2502');
    const bordered = [topLine];

    // Top vertical padding
    for (let i = 0; i < PADDING_Y; i++) bordered.push(emptyRow);

    for (const line of lines) {
      const rightPad = ' '.repeat(Math.max(0, innerWidth - PADDING_X - visibleWidth(line) - PADDING_X));
      bordered.push(styles.dim('\u2502') + leftPad + line + rightPad + leftPad + styles.dim('\u2502'));
    }

    // Bottom vertical padding
    for (let i = 0; i < PADDING_Y; i++) bordered.push(emptyRow);

    bordered.push(botLine);

    this._cache = bordered;
    this._cacheWidth = innerWidth + 2;
    return bordered;
  }
}
