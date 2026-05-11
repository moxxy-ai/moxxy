import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { MoxxyEvent, PendingToolCall, PermissionContext, PermissionDecision } from '@moxxy/sdk';
import { runTurn, type Session } from '@moxxy/core';
import { ChatView } from './components/ChatView.js';
import { PromptInput } from './components/PromptInput.js';
import { PermissionDialog } from './components/PermissionDialog.js';

export interface InteractiveSessionProps {
  readonly session: Session;
  readonly registerInteractiveResolver: (
    prompt: (call: PendingToolCall, ctx: PermissionContext) => Promise<PermissionDecision>,
  ) => void;
  readonly model?: string;
}

export const InteractiveSession: React.FC<InteractiveSessionProps> = ({
  session,
  registerInteractiveResolver,
  model,
}) => {
  const { exit } = useApp();
  const [events, setEvents] = useState<ReadonlyArray<MoxxyEvent>>([]);
  const [streamingDelta, setStreamingDelta] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<{
    call: PendingToolCall;
    ctx: PermissionContext;
    resolve: (d: PermissionDecision) => void;
  } | null>(null);
  const streamingBufferRef = useRef('');

  useEffect(() => {
    const unsub = session.log.subscribe((event) => {
      setEvents((prev) => [...prev, event]);
      if (event.type === 'assistant_chunk') {
        streamingBufferRef.current += event.delta;
        setStreamingDelta(streamingBufferRef.current);
      }
      if (event.type === 'assistant_message') {
        streamingBufferRef.current = '';
        setStreamingDelta('');
      }
    });

    registerInteractiveResolver(async (call, ctx) => {
      return new Promise<PermissionDecision>((resolve) => {
        setPendingPermission({ call, ctx, resolve });
      });
    });

    return () => unsub();
  }, [session, registerInteractiveResolver]);

  const handleSubmit = async (text: string): Promise<void> => {
    if (text === '/exit' || text === '/quit') {
      exit();
      return;
    }
    setBusy(true);
    streamingBufferRef.current = '';
    setStreamingDelta('');
    try {
      for await (const _event of runTurn(session, text, model ? { model } : {})) {
        void _event;
      }
    } catch (err) {
      // surfaced via error events; nothing extra to do
      void err;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="magenta">moxxy</Text>
        <Text dimColor> — /exit to quit</Text>
      </Box>
      <ChatView events={events} streamingDelta={streamingDelta} />
      {pendingPermission ? (
        <PermissionDialog
          call={pendingPermission.call}
          toolDescription={session.tools.get(pendingPermission.call.name)?.description}
          onDecide={(decision) => {
            const { resolve } = pendingPermission;
            setPendingPermission(null);
            resolve(decision);
          }}
        />
      ) : (
        <PromptInput onSubmit={handleSubmit} disabled={busy} placeholder={busy ? 'thinking…' : 'type a prompt'} />
      )}
    </Box>
  );
};
