import chalk from 'chalk';

export const COLORS = {
  user: '#FF9500',
  assistant: 'white',
  event: 'gray',
  error: 'red',
  warning: 'yellow',
  info: 'cyan',
  dim: 'gray',
  border: 'gray',
  accent: 'cyan',
  status: {
    idle: 'yellow',
    running: 'green',
    stopped: 'gray',
    error: 'red',
  },
};

// Chalk style functions matching COLORS
export const styles = {
  user: chalk.hex('#FF9500'),
  assistant: chalk.white,
  event: chalk.gray,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.cyan,
  dim: chalk.dim,
  border: chalk.gray,
  accent: chalk.cyan,
  bold: chalk.bold,
  inverse: chalk.inverse,
  status: {
    idle: chalk.yellow,
    running: chalk.green,
    stopped: chalk.gray,
    error: chalk.red,
  },
};

export function shortId(id) {
  return id ? id.slice(0, 12) : '?';
}

export function formatTs(ts) {
  if (!ts) return '';
  return new Date(typeof ts === 'number' ? ts : Date.parse(ts)).toLocaleTimeString();
}

export function formatNumber(n) {
  return (n || 0).toLocaleString();
}

export function makeBar(count, maxCount) {
  const maxWidth = 10;
  const width = maxCount > 0 ? Math.round((count / maxCount) * maxWidth) : 0;
  return '\u2588'.repeat(width);
}
