import chalk from 'chalk';
import { shortId, formatNumber, styles } from './helpers.js';
import { truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';

/**
 * Status bar component displaying agent info, connection status, and stats.
 * Renders as 1 bordered line.
 */
export class StatusBar {
  constructor() {
    this.agent = null;
    this.connected = false;
    this.selectMode = false;
    this.stats = { eventCount: 0, tokenEstimate: 0, skills: {}, primitives: {} };
    this._cache = null;
    this._cacheWidth = 0;
  }

  setAgent(agent) {
    this.agent = agent;
    this._cache = null;
  }

  setConnected(connected) {
    this.connected = connected;
    this._cache = null;
  }

  setSelectMode(selectMode) {
    this.selectMode = selectMode;
    this._cache = null;
  }

  setStats(stats) {
    this.stats = stats;
    this._cache = null;
  }

  invalidate() {
    this._cache = null;
  }

  render(width) {
    if (this._cache && this._cacheWidth === width) return this._cache;

    const innerWidth = width - 2; // borders
    let parts = [];

    if (this.agent) {
      const statusColor = styles.status[this.agent.status] || styles.dim;
      const dot = this.agent.status === 'running' ? '\u25CF' : '\u25CB';
      parts.push(styles.accent(`Agent ${shortId(this.agent.id)}`));
      parts.push(statusColor(`${dot} ${this.agent.status}`));
      parts.push(chalk.dim(`${this.agent.provider_id}/${this.agent.model_id}`));
    } else {
      parts.push(styles.dim('No agent'));
    }

    const sseColor = this.connected ? styles.info : styles.error;
    parts.push(sseColor(this.connected ? 'SSE \u2713' : 'SSE \u2717'));

    if (this.stats.eventCount > 0) {
      parts.push(chalk.dim(`Ev:${formatNumber(this.stats.eventCount)}`));
    }
    if (this.stats.tokenEstimate > 0) {
      parts.push(chalk.dim(`Tok:${formatNumber(this.stats.tokenEstimate)}`));
    }

    if (this.selectMode) {
      parts.push(chalk.bgYellow.black(' SELECT ') + chalk.dim(' Esc to exit'));
    } else if (this.agent && this.agent.status === 'running') {
      parts.push(chalk.dim('Ctrl+X to stop'));
    }

    const content = parts.join(chalk.dim(' \u2502 '));
    const truncated = truncateToWidth(content, innerWidth);
    const pad = ' '.repeat(Math.max(0, innerWidth - visibleWidth(truncated)));

    const topLine = styles.dim('\u250c' + '\u2500'.repeat(innerWidth) + '\u2510');
    const midLine = styles.dim('\u2502') + truncated + pad + styles.dim('\u2502');
    const botLine = styles.dim('\u2514' + '\u2500'.repeat(innerWidth) + '\u2518');

    this._cache = [topLine, midLine, botLine];
    this._cacheWidth = width;
    return this._cache;
  }
}
