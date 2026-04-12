import { useReducer, useCallback, useRef } from 'react';
import { SLASH_COMMANDS } from '../slash-commands.js';
import { startRecording } from '../voice-recorder.js';

const INITIAL_STATE = { type: 'idle' };

function reducer(state, action) {
  switch (action.type) {
    case 'vault_set_pending':
      return { type: 'vault_set', keyName: action.keyName };
    case 'vault_set_key':
      return { type: 'vault_set_key' };
    case 'vault_remove_key':
      return { type: 'vault_remove_key' };
    case 'mcp_add_transport':
      return { type: 'mcp_transport' };
    case 'mcp_add_detail':
      return { type: 'mcp_detail', transport: action.transport };
    case 'mcp_add_id':
      return { type: 'mcp_id', transport: action.transport, detail: action.detail };
    case 'mcp_remove_id':
      return { type: 'mcp_remove_id' };
    case 'mcp_test_id':
      return { type: 'mcp_test_id' };
    case 'template_assign_slug':
      return { type: 'template_assign_slug' };
    case 'voice_recording':
      return { type: 'voice_recording' };
    case 'reset':
      return INITIAL_STATE;
    default:
      return state;
  }
}

/**
 * Hook that encapsulates all slash command routing and two-step command state.
 * Returns { handleSubmit } where handleSubmit is the main input handler.
 */
export function useCommandHandler({
  client,
  agent,
  agentId,
  eventsHandler,
  onStop,
  onExit,
  onAgentUpdate,
  onContextSync,
  onOpenModelPicker,
  onOpenVaultPicker,
  onOpenVaultSetWizard,
  onOpenVaultRemoveWizard,
  onOpenMcpPicker,
  onOpenMcpTransportPicker,
  onOpenMcpServerPicker,
  onOpenTemplatePicker,
  onOpenTemplateAssignWizard,
}) {
  const [twoStep, dispatch] = useReducer(reducer, INITIAL_STATE);
  const voiceHandleRef = useRef(null);

  const handleSubmit = useCallback(async (text) => {
    const task = text.trim().replace(/^\/{2,}/, '/');

    // While a recording is active, ANY submit (including bare Enter) stops
    // it and ships the clip. This must run before the empty-text early return
    // below so hitting Enter with no text still ends the capture.
    if (twoStep.type === 'voice_recording') {
      const handle = voiceHandleRef.current;
      dispatch({ type: 'reset' });
      voiceHandleRef.current = null;
      if (!handle) {
        eventsHandler.addSystemMessage('No active recording.');
        return;
      }
      try {
        const clip = await handle.stop();
        eventsHandler.addSystemMessage('Transcribing voice message…');
        if (!agent) {
          eventsHandler.addSystemMessage('No agent connected. Cannot run task.');
          return;
        }
        try {
          const result = await client.startRunWithAudio(agent.name, clip);
          const transcript = (result && result.transcript) || '[voice]';
          eventsHandler.addUserMessage(transcript);
          if (onAgentUpdate) onAgentUpdate({ status: 'running' });
        } catch (err) {
          if (err.isGatewayDown) {
            eventsHandler.addSystemMessage(err.message);
          } else {
            eventsHandler.addSystemMessage(`Voice error: ${err.message}`);
          }
        }
      } catch (err) {
        eventsHandler.addSystemMessage(`Recording failed: ${err.message}`);
      } finally {
        handle.cleanup();
      }
      return;
    }

    if (!task) return;

    // Pending ask: agent asked for user input
    if (eventsHandler.pendingAsk) {
      const { questionId } = eventsHandler.pendingAsk;
      eventsHandler.pendingAsk = null;
      eventsHandler.addUserMessage(task);
      try {
        await client.respondToAsk(agentId, questionId, task);
      } catch (err) {
        eventsHandler.addSystemMessage(`Error responding: ${err.message}`);
      }
      return;
    }

    // Two-step: vault set (capture secret value)
    if (twoStep.type === 'vault_set') {
      const { keyName } = twoStep;
      dispatch({ type: 'reset' });
      try {
        await client.createSecret({ key_name: keyName, backend_key: keyName, value: task });
        eventsHandler.addSystemMessage(`Secret "${keyName}" stored.`);
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }

    if (twoStep.type === 'vault_set_key') {
      const keyName = task.trim();
      if (!keyName) {
        eventsHandler.addSystemMessage('Secret key name cannot be empty. Cancelled.');
        dispatch({ type: 'reset' });
        return;
      }
      dispatch({ type: 'vault_set_pending', keyName });
      eventsHandler.addSystemMessage(`Enter the secret value for "${keyName}":`);
      return;
    }

    if (twoStep.type === 'vault_remove_key') {
      const keyName = task.trim();
      dispatch({ type: 'reset' });
      if (!keyName) {
        eventsHandler.addSystemMessage('Secret key name cannot be empty. Cancelled.');
        return;
      }
      try {
        const secrets = await client.listSecrets();
        const match = secrets.find(s => s.key_name === keyName);
        if (!match) {
          eventsHandler.addSystemMessage(`Secret "${keyName}" not found.`);
          return;
        }
        await client.deleteSecret(match.id);
        eventsHandler.addSystemMessage(`Secret "${keyName}" removed.`);
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }

    // Two-step: mcp add - transport selection
    if (twoStep.type === 'mcp_transport') {
      const choice = task.toLowerCase().trim();
      if (choice !== 'stdio' && choice !== 'sse') {
        eventsHandler.addSystemMessage('Invalid transport. Enter "stdio" or "sse". Cancelled.');
        dispatch({ type: 'reset' });
        return;
      }
      const prompt = choice === 'stdio' ? 'Enter the command to start the server:' : 'Enter the SSE URL:';
      eventsHandler.addSystemMessage(prompt);
      dispatch({ type: 'mcp_add_detail', transport: choice });
      return;
    }

    // Two-step: mcp add - command/url
    if (twoStep.type === 'mcp_detail') {
      if (!task) {
        eventsHandler.addSystemMessage('Empty value. Cancelled.');
        dispatch({ type: 'reset' });
        return;
      }
      eventsHandler.addSystemMessage('Enter a server ID (unique name for this server):');
      dispatch({ type: 'mcp_add_id', transport: twoStep.transport, detail: task });
      return;
    }

    // Two-step: mcp add - server ID
    if (twoStep.type === 'mcp_id') {
      const serverId = task.trim();
      dispatch({ type: 'reset' });
      if (!serverId) {
        eventsHandler.addSystemMessage('Empty server ID. Cancelled.');
        return;
      }
      try {
        const config = { transport: twoStep.transport, server_id: serverId };
        if (twoStep.transport === 'stdio') {
          config.command = twoStep.detail;
        } else {
          config.url = twoStep.detail;
        }
        await client.addMcpServer(agentId, config);
        eventsHandler.addSystemMessage(`MCP server "${serverId}" added.`);
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }

    if (twoStep.type === 'mcp_remove_id') {
      const serverId = task.trim();
      dispatch({ type: 'reset' });
      if (!serverId) {
        eventsHandler.addSystemMessage('Server ID cannot be empty. Cancelled.');
        return;
      }
      try {
        await client.removeMcpServer(agentId, serverId);
        eventsHandler.addSystemMessage(`MCP server "${serverId}" removed.`);
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }

    if (twoStep.type === 'mcp_test_id') {
      const serverId = task.trim();
      dispatch({ type: 'reset' });
      if (!serverId) {
        eventsHandler.addSystemMessage('Server ID cannot be empty. Cancelled.');
        return;
      }
      try {
        const result = await client.testMcpServer(agentId, serverId);
        const status = result.success ? 'Connection successful' : `Connection failed: ${result.error || 'unknown error'}`;
        eventsHandler.addSystemMessage(`MCP test "${serverId}": ${status}`);
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }

    if (twoStep.type === 'template_assign_slug') {
      const slug = task.trim();
      dispatch({ type: 'reset' });
      if (!slug) {
        eventsHandler.addSystemMessage('Template slug cannot be empty. Cancelled.');
        return;
      }
      try {
        await client.setAgentTemplate(agentId, slug);
        eventsHandler.addSystemMessage(`Template "${slug}" assigned. Changes take effect on next run.`);
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }

    // Slash commands
    if (task === '/exit') {
      onExit();
      return;
    }
    if (task === '/stop') {
      await onStop();
      return;
    }
    if (task === '/new' || task === '/reset') {
      try {
        await client.resetSession(agentId);
        eventsHandler.clearMessages();
        eventsHandler.addSystemMessage('Session reset. Starting fresh.');
        if (onAgentUpdate) onAgentUpdate({ status: 'idle' });
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }
    if (task === '/clear') {
      eventsHandler.clearMessages();
      return;
    }
    if (task === '/help') {
      const lines = [
        'Commands: ' + SLASH_COMMANDS.map(c => c.name).join(', '),
        'Shortcuts: Ctrl+C copy/exit | Ctrl+X cut/stop | Ctrl+V paste',
      ];
      eventsHandler.addSystemMessage(lines.join('\n'));
      return;
    }
    if (task === '/status') {
      const status = agent
        ? `Agent ${agent.name}: ${agent.status} | Provider: ${agent.provider_id} | Model: ${agent.model_id} | SSE: ${eventsHandler.connected ? 'connected' : 'disconnected'}`
        : 'No agent connected';
      eventsHandler.addSystemMessage(status);
      return;
    }
    // Vault commands
    if (task === '/vault') {
      await onOpenVaultPicker();
      return;
    }
    if (task === '/vault list') {
      try {
        const secrets = await client.listSecrets();
        if (!secrets || secrets.length === 0) {
          eventsHandler.addSystemMessage('No vault secrets found.');
        } else {
          const lines = secrets.map(s =>
            `  ${s.key_name} (${s.backend_key}) [${s.policy_label || 'default'}]`
          );
          eventsHandler.addSystemMessage('Vault secrets:\n' + lines.join('\n'));
        }
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }
    if (task.startsWith('/vault set')) {
      const keyName = task.slice('/vault set'.length).trim();
      if (!keyName) {
        await onOpenVaultSetWizard();
        return;
      }
      dispatch({ type: 'vault_set_pending', keyName });
      eventsHandler.addSystemMessage(`Enter the secret value for "${keyName}":`);
      return;
    }
    if (task.startsWith('/vault remove') || task.startsWith('/vault delete')) {
      const keyName = task.replace(/^\/vault (remove|delete)/, '').trim();
      if (!keyName) {
        await onOpenVaultRemoveWizard();
        return;
      }
      try {
        const secrets = await client.listSecrets();
        const match = secrets.find(s => s.key_name === keyName);
        if (!match) {
          eventsHandler.addSystemMessage(`Secret "${keyName}" not found.`);
          return;
        }
        await client.deleteSecret(match.id);
        eventsHandler.addSystemMessage(`Secret "${keyName}" removed.`);
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }

    if (task === '/model') {
      await onOpenModelPicker();
      return;
    }

    // MCP commands
    if (task === '/mcp') {
      await onOpenMcpPicker();
      return;
    }
    if (task === '/mcp list') {
      try {
        const servers = await client.listMcpServers(agentId);
        if (!servers || servers.length === 0) {
          eventsHandler.addSystemMessage('No MCP servers connected.');
        } else {
          const lines = servers.map(s => {
            const id = s.id || s.server_id || 'unknown';
            const status = s.enabled === false ? 'disabled' : 'enabled';
            const detail = s.transport === 'stdio'
              ? `cmd=${s.command || '?'}`
              : `url=${s.url || '?'}`;
            return `  ${id} [${s.transport || 'unknown'}] ${status}  ${detail}`;
          });
          eventsHandler.addSystemMessage('MCP servers:\n' + lines.join('\n'));
        }
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }
    if (task === '/mcp add') {
      await onOpenMcpTransportPicker();
      return;
    }
    if (task === '/mcp add stdio' || task === '/mcp add sse' || task === '/mcp add streamable_http') {
      const transport = task.slice('/mcp add '.length).trim();
      const prompt = transport === 'stdio'
        ? 'Enter the command to start the server:'
        : 'Enter the server URL:';
      eventsHandler.addSystemMessage(prompt);
      dispatch({ type: 'mcp_add_detail', transport });
      return;
    }
    if (task.startsWith('/mcp remove')) {
      const serverId = task.slice('/mcp remove'.length).trim();
      if (!serverId) {
        await onOpenMcpServerPicker('remove');
        return;
      }
      try {
        await client.removeMcpServer(agentId, serverId);
        eventsHandler.addSystemMessage(`MCP server "${serverId}" removed.`);
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }
    if (task.startsWith('/mcp test')) {
      const serverId = task.slice('/mcp test'.length).trim();
      if (!serverId) {
        await onOpenMcpServerPicker('test');
        return;
      }
      try {
        const result = await client.testMcpServer(agentId, serverId);
        const status = result.status === 'ok'
          ? 'Connection successful'
          : `Connection failed: ${result.error || 'unknown error'}`;
        eventsHandler.addSystemMessage(`MCP test "${serverId}": ${status}`);
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }

    // Template commands
    if (task === '/template') {
      await onOpenTemplatePicker();
      return;
    }
    if (task === '/template list') {
      try {
        const templates = await client.listTemplates();
        if (!templates || templates.length === 0) {
          eventsHandler.addSystemMessage('No templates found.');
        } else {
          const lines = templates.map(t =>
            `  ${t.name} v${t.version}  (${t.slug})${t.tags && t.tags.length > 0 ? ` [${t.tags.join(', ')}]` : ''}`
          );
          eventsHandler.addSystemMessage('Templates:\n' + lines.join('\n'));
        }
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }
    if (task.startsWith('/template assign')) {
      const slug = task.slice('/template assign'.length).trim();
      if (!slug) {
        await onOpenTemplateAssignWizard();
        return;
      }
      try {
        await client.setAgentTemplate(agentId, slug);
        eventsHandler.addSystemMessage(`Template "${slug}" assigned. Changes take effect on next run.`);
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }
    if (task === '/voice') {
      if (voiceHandleRef.current) {
        // Defensive: treat a second /voice as a stop even if state drifted.
        dispatch({ type: 'voice_recording' });
        return;
      }
      try {
        const handle = await startRecording();
        voiceHandleRef.current = handle;
        dispatch({ type: 'voice_recording' });
        eventsHandler.addSystemMessage(
          `Recording (${handle.tool})… press Enter or /voice again to stop.`,
        );
      } catch (err) {
        eventsHandler.addSystemMessage(`Cannot record voice: ${err.message}`);
      }
      return;
    }

    if (task === '/template clear') {
      try {
        await client.setAgentTemplate(agentId, null);
        eventsHandler.addSystemMessage('Template cleared. Changes take effect on next run.');
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
      return;
    }

    // Regular task: send to agent
    eventsHandler.addUserMessage(task);
    if (agent) {
      try {
        await client.startRun(agent.name, task);
        if (onAgentUpdate) onAgentUpdate({ status: 'running' });
      } catch (err) {
        if (err.isGatewayDown) {
          eventsHandler.addSystemMessage(err.message);
        } else {
          eventsHandler.addSystemMessage(`Error: ${err.message}`);
        }
      }
    } else {
      eventsHandler.addSystemMessage('No agent connected. Cannot run task.');
    }
  }, [client, agent, agentId, eventsHandler, twoStep, onStop, onExit, onAgentUpdate, onContextSync, onOpenModelPicker, onOpenVaultPicker, onOpenVaultSetWizard, onOpenVaultRemoveWizard, onOpenMcpPicker, onOpenMcpTransportPicker, onOpenMcpServerPicker, onOpenTemplatePicker, onOpenTemplateAssignWizard, dispatch]);

  return { handleSubmit, twoStepState: twoStep };
}
