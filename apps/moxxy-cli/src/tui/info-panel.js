import { Box, Text } from 'ink';
import { h, COLORS, shortId, formatNumber, makeBar } from './helpers.js';

function StatusDot({ status }) {
  const color = COLORS.status[status] || COLORS.dim;
  const symbol = status === 'running' ? '\u25CF' : '\u25CB';
  return h(Text, { color }, `${symbol} ${status}`);
}

export function InfoPanel({ agent, stats, connected, height }) {
  const children = [];

  if (!agent) {
    children.push(h(Text, { color: COLORS.dim, key: 'none' }, 'No agent selected'));
    return h(Box, {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: COLORS.border,
      paddingX: 1,
      width: 30,
      height,
    }, ...children);
  }

  // Agent section
  children.push(h(Text, { bold: true, color: COLORS.accent, key: 'title' }, ' Agent'));
  children.push(h(Text, { color: COLORS.dim, key: 'id' }, `ID: ${shortId(agent.id)}`));
  children.push(h(Text, { key: 'provider' }, `Provider: ${agent.provider_id}`));
  children.push(h(Text, { key: 'model' }, `Model: ${agent.model_id}`));
  children.push(h(StatusDot, { status: agent.status, key: 'status' }));
  children.push(h(Text, { color: connected ? COLORS.info : COLORS.error, key: 'sse' },
    `SSE: ${connected ? 'connected' : 'disconnected'}`));

  // Usage section
  children.push(h(Box, { marginY: 1, key: 'sep1' },
    h(Text, { color: COLORS.dim }, '\u2500\u2500 Usage \u2500\u2500')));
  children.push(h(Text, { key: 'tokens' }, `Tokens: ${formatNumber(stats.tokenEstimate)}`));
  children.push(h(Text, { key: 'events' }, `Events: ${formatNumber(stats.eventCount)}`));

  // Activity section
  const allActivity = { ...stats.skills, ...stats.primitives };
  const entries = Object.entries(allActivity).sort(([,a], [,b]) => b - a).slice(0, 8);
  const maxCount = entries.length > 0 ? Math.max(...entries.map(([,c]) => c)) : 0;

  if (entries.length > 0) {
    children.push(h(Box, { marginTop: 1, key: 'sep2' },
      h(Text, { color: COLORS.dim }, '\u2500\u2500 Activity \u2500\u2500')));
    entries.forEach(([name, count]) => {
      children.push(h(Box, { key: `act-${name}` },
        h(Text, null, `${name.padEnd(12).slice(0, 12)} `),
        h(Text, { color: COLORS.accent }, makeBar(count, maxCount)),
        h(Text, { color: COLORS.dim }, ` ${count}`),
      ));
    });
  }

  return h(Box, {
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: COLORS.border,
    paddingX: 1,
    width: 30,
    height,
  }, ...children);
}
