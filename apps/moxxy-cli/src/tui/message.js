import { Box, Text } from 'ink';
import { h, COLORS } from './helpers.js';

function eventSummary(eventType, payload) {
  switch (eventType) {
    case 'run.started': return payload.task ? `Task: ${payload.task}` : 'Run started';
    case 'run.completed': return 'Run completed';
    case 'run.failed': return `Failed: ${payload.error || payload.message || ''}`;
    case 'skill.invoked': return payload.name || 'skill';
    case 'skill.completed': return `${payload.name || 'skill'} done`;
    case 'skill.failed': return `${payload.name || 'skill'}: ${payload.error || 'failed'}`;
    case 'primitive.invoked': return payload.name || 'primitive';
    case 'primitive.completed': return `${payload.name || 'primitive'} done`;
    case 'primitive.failed': return `${payload.name || 'primitive'}: ${payload.error || 'failed'}`;
    case 'security.violation': return payload.reason || 'Security violation';
    case 'sandbox.denied': return payload.reason || 'Sandbox denied';
    default: return '';
  }
}

export function Message({ type, content, eventType, payload, streaming }) {
  if (type === 'user') {
    return h(Box, null,
      h(Text, { color: COLORS.user, bold: true }, '> '),
      h(Text, { color: COLORS.user }, content),
    );
  }

  if (type === 'assistant') {
    return h(Box, { flexDirection: 'column' },
      h(Box, null,
        h(Text, { color: COLORS.accent, bold: true }, 'Assistant'),
        streaming ? h(Text, { color: COLORS.dim }, ' \u2026') : null,
      ),
      h(Text, { color: COLORS.assistant, wrap: 'wrap' }, content || ''),
    );
  }

  if (type === 'event') {
    const summary = eventSummary(eventType, payload || {});
    const isError = eventType?.includes('failed') || eventType?.includes('violation') || eventType?.includes('denied');
    const color = isError ? COLORS.error : COLORS.dim;
    return h(Box, null,
      h(Text, { color, dimColor: !isError }, `[${eventType}]`),
      summary ? h(Text, { color, dimColor: !isError }, ` ${summary}`) : null,
    );
  }

  return null;
}
