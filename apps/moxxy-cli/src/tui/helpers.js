import React from 'react';

export const h = React.createElement;

export const COLORS = {
  user: 'green',
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
