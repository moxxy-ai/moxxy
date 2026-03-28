/**
 * MCP commands: list/add/remove/test.
 */
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, withSpinner, showResult, pickAgent, p } from '../ui.js';

/**
 * Collect all --args values from the raw argument array.
 * parseFlags only keeps the last value for non-multi flags,
 * so we manually extract all --args occurrences.
 */
function collectArgs(raw) {
  const result = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--args' && i + 1 < raw.length) {
      result.push(raw[i + 1]);
      i++;
    }
  }
  return result;
}

export async function runMcp(client, args) {
  let [action, ...rest] = args;
  const flags = parseFlags(rest);

  // Interactive sub-menu when no valid action
  if (!['list', 'add', 'remove', 'test'].includes(action) && isInteractive()) {
    action = await p.select({
      message: 'MCP action',
      options: [
        { value: 'list',   label: 'List servers',   hint: 'show MCP servers for an agent' },
        { value: 'add',    label: 'Add server',     hint: 'register a new MCP server' },
        { value: 'remove', label: 'Remove server',  hint: 'remove an MCP server' },
        { value: 'test',   label: 'Test server',    hint: 'test connectivity to an MCP server' },
      ],
    });
    handleCancel(action);
  }

  switch (action) {
    case 'list': {
      let agentName = flags.agent;
      if (!agentName && isInteractive()) {
        agentName = await pickAgent(client, 'Select agent');
      }
      if (!agentName) throw new Error('Required: --agent');

      const servers = isInteractive()
        ? await withSpinner('Fetching MCP servers...', () =>
            client.listMcpServers(agentName), 'MCP servers loaded.')
        : await client.listMcpServers(agentName);

      if (isInteractive()) {
        if (Array.isArray(servers) && servers.length > 0) {
          for (const s of servers) {
            const transport = s.transport || 'unknown';
            const detail = transport === 'stdio'
              ? `cmd=${s.command || '?'}`
              : `url=${s.url || '?'}`;
            p.log.info(`  ${s.id}  [${transport}]  ${detail}`);
          }
        } else {
          p.log.warn('No MCP servers configured for this agent.');
        }
      } else {
        console.log(JSON.stringify(servers, null, 2));
      }
      return servers;
    }

    case 'add': {
      let agentName = flags.agent;
      let serverId = flags.id;
      let transport = flags.transport;

      // Interactive wizard when missing required fields
      if ((!agentName || !serverId || !transport) && isInteractive()) {
        if (!agentName) {
          agentName = await pickAgent(client, 'Select agent for MCP server');
        }

        if (!serverId) {
          serverId = handleCancel(await p.text({
            message: 'Server ID',
            placeholder: 'my-mcp-server',
            validate: (val) => { if (!val) return 'Server ID is required'; },
          }));
        }

        if (!transport) {
          transport = handleCancel(await p.select({
            message: 'Transport type',
            options: [
              { value: 'stdio',           label: 'stdio',           hint: 'local process via stdin/stdout' },
              { value: 'sse',             label: 'sse',             hint: 'remote server via SSE (legacy)' },
              { value: 'streamable_http', label: 'streamable_http', hint: 'remote server via Streamable HTTP (recommended)' },
            ],
          }));
        }

        let body = { id: serverId, transport };

        if (transport === 'stdio') {
          const command = flags.command || handleCancel(await p.text({
            message: 'Command to run',
            placeholder: 'npx -y @modelcontextprotocol/server-filesystem',
            validate: (val) => { if (!val) return 'Command is required'; },
          }));
          body.command = command;

          const argsInput = collectArgs(rest);
          if (argsInput.length > 0) {
            body.args = argsInput;
          } else {
            const argsStr = handleCancel(await p.text({
              message: 'Arguments (space-separated, optional)',
              placeholder: '/path/to/dir',
            }));
            if (argsStr) {
              body.args = argsStr.split(/\s+/);
            }
          }
        } else {
          // SSE and streamable_http both need a URL
          const placeholder = transport === 'streamable_http'
            ? 'https://mcp.exa.ai/mcp'
            : 'http://localhost:8080/sse';
          const url = flags.url || handleCancel(await p.text({
            message: 'Server URL',
            placeholder,
            validate: (val) => { if (!val) return 'URL is required'; },
          }));
          body.url = url;
        }

        const result = await withSpinner('Adding MCP server...', () =>
          client.addMcpServer(agentName, body), 'MCP server added.');

        showResult('MCP Server Added', {
          Agent: agentName,
          ID: serverId,
          Transport: transport,
        });

        return result;
      }

      // Non-interactive mode
      if (!agentName || !serverId || !transport) {
        throw new Error('Required: --agent, --id, --transport');
      }

      const body = { id: serverId, transport };
      if (transport === 'stdio') {
        if (!flags.command) throw new Error('Required for stdio transport: --command');
        body.command = flags.command;
        const cmdArgs = collectArgs(rest);
        if (cmdArgs.length > 0) body.args = cmdArgs;
      } else if (transport === 'sse' || transport === 'streamable_http') {
        if (!flags.url) throw new Error(`Required for ${transport} transport: --url`);
        body.url = flags.url;
      }

      const result = await client.addMcpServer(agentName, body);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    case 'remove': {
      let agentName = flags.agent;
      let serverId = flags.id;

      if ((!agentName || !serverId) && isInteractive()) {
        if (!agentName) {
          agentName = await pickAgent(client, 'Select agent');
        }

        if (!serverId) {
          const servers = await withSpinner('Fetching MCP servers...', () =>
            client.listMcpServers(agentName), 'MCP servers loaded.');

          if (!Array.isArray(servers) || servers.length === 0) {
            p.log.warn('No MCP servers to remove.');
            return;
          }

          serverId = handleCancel(await p.select({
            message: 'Select server to remove',
            options: servers.map(s => ({
              value: s.id,
              label: s.id,
              hint: `[${s.transport || 'unknown'}]`,
            })),
          }));
        }

        const confirmed = await p.confirm({
          message: `Remove MCP server "${serverId}"?`,
          initialValue: false,
        });
        handleCancel(confirmed);
        if (!confirmed) {
          p.log.info('Cancelled.');
          return;
        }

        await withSpinner('Removing MCP server...', () =>
          client.removeMcpServer(agentName, serverId), 'MCP server removed.');
        return;
      }

      if (!agentName || !serverId) throw new Error('Required: --agent, --id');

      await client.removeMcpServer(agentName, serverId);
      console.log(`MCP server ${serverId} removed.`);
      break;
    }

    case 'test': {
      let agentName = flags.agent;
      let serverId = flags.id;

      if ((!agentName || !serverId) && isInteractive()) {
        if (!agentName) {
          agentName = await pickAgent(client, 'Select agent');
        }

        if (!serverId) {
          const servers = await withSpinner('Fetching MCP servers...', () =>
            client.listMcpServers(agentName), 'MCP servers loaded.');

          if (!Array.isArray(servers) || servers.length === 0) {
            p.log.warn('No MCP servers to test.');
            return;
          }

          serverId = handleCancel(await p.select({
            message: 'Select server to test',
            options: servers.map(s => ({
              value: s.id,
              label: s.id,
              hint: `[${s.transport || 'unknown'}]`,
            })),
          }));
        }

        const result = await withSpinner('Testing MCP server...', () =>
          client.testMcpServer(agentName, serverId), 'Test complete.');

        if (result.ok || result.status === 'ok') {
          p.log.success(`Server "${serverId}" is reachable.`);
          if (Array.isArray(result.tools) && result.tools.length > 0) {
            p.log.info(`  Tools (${result.tools.length}):`);
            for (const t of result.tools) {
              p.log.info(`    - ${t.name || t}`);
            }
          }
        } else {
          p.log.error(`Server "${serverId}" test failed: ${result.error || 'unknown error'}`);
        }
        return result;
      }

      if (!agentName || !serverId) throw new Error('Required: --agent, --id');

      const result = await client.testMcpServer(agentName, serverId);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    default: {
      const { showHelp } = await import('../help.js');
      showHelp('mcp', p);
      break;
    }
  }
}
