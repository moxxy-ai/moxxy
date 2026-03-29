export function createMcpAddWizard(transport) {
  return {
    transport,
    step: transport === 'stdio' ? 'command' : 'url',
    values: {},
  };
}

export function parseMcpCommandInput(rawValue) {
  const input = String(rawValue || '').trim();
  if (!input) {
    return { command: '', args: [] };
  }

  const parts = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return {
    command: parts[0] || '',
    args: parts.slice(1),
  };
}

export function getMcpAddWizardPrompt(wizard) {
  switch (wizard.step) {
    case 'command':
      return {
        title: 'Add MCP Server',
        label: 'Command',
        placeholder: 'npx -y @modelcontextprotocol/server-filesystem',
      };
    case 'url':
      return {
        title: 'Add MCP Server',
        label: 'Server URL',
        placeholder: wizard.transport === 'streamable_http'
          ? 'https://mcp.exa.ai/mcp'
          : 'http://localhost:8080/sse',
      };
    case 'server_id':
      return {
        title: 'Add MCP Server',
        label: 'Server ID',
        placeholder: 'my-mcp-server',
      };
    default:
      return {
        title: 'Add MCP Server',
        label: 'Value',
        placeholder: '',
      };
  }
}

export function submitMcpAddWizardValue(wizard, rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return {
      done: false,
      wizard,
      error: 'Value cannot be empty.',
    };
  }

  if (wizard.step === 'command') {
    const parsed = parseMcpCommandInput(value);
    return {
      done: false,
      wizard: {
        ...wizard,
        step: 'server_id',
        values: {
          ...wizard.values,
          command: parsed.command,
          ...(parsed.args.length > 0 ? { args: parsed.args } : {}),
        },
      },
      error: null,
    };
  }

  if (wizard.step === 'url') {
    return {
      done: false,
      wizard: {
        ...wizard,
        step: 'server_id',
        values: { ...wizard.values, url: value },
      },
      error: null,
    };
  }

  return {
    done: true,
    payload: {
      transport: wizard.transport,
      ...wizard.values,
      id: value,
    },
    error: null,
  };
}
