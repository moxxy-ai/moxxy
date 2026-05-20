import React from 'react';
import { Box } from 'ink';
import type { Session } from '@moxxy/core';
import { PermissionDialog } from '../components/PermissionDialog.js';
import { ApprovalDialog } from '../components/ApprovalDialog.js';
import { InputBox } from '../components/InputBox.js';
import { ListPicker } from '../components/ListPicker.js';
import { QueueView } from '../components/QueueView.js';
import type { SlashCommand } from '../components/SlashCommands.js';
import type { QueuedMessage } from './use-turn-runner.js';
import type { PendingApproval, PendingPermission, Picker } from './types.js';

interface InteractiveZoneProps {
  session: Session;
  pendingPermission: PendingPermission | null;
  pendingPermissionDepth: number;
  pendingApproval: PendingApproval | null;
  picker: Picker;
  busy: boolean;
  yolo: boolean;
  slashCommands: ReadonlyArray<SlashCommand>;
  /** Live queue contents for the always-visible QueueView. */
  queueMessages: ReadonlyArray<QueuedMessage>;
  /** Single-slot priority message set by Ctrl+J. */
  priorityMessage: QueuedMessage | null;
  onPermissionDecide: (perm: PendingPermission, decision: import('@moxxy/sdk').PermissionDecision) => void;
  onApprovalDecide: (decision: import('@moxxy/sdk').ApprovalDecision) => void;
  onPickerSelect: (picker: NonNullable<Picker>, id: string) => void;
  onPickerCancel: () => void;
  onSubmit: (text: string) => void | Promise<void>;
  onPasteText: (text: string) => string;
}

/**
 * The bottom-of-screen interactive slot. Mutually exclusive: at most
 * one of permission dialog, approval dialog, picker, or input box is
 * rendered at a time. PromptInput's raw-mode stdin handler doesn't
 * react well to being mounted alongside dialogs that also useInput,
 * which is why the gating happens here at the boundary.
 */
export const InteractiveZone: React.FC<InteractiveZoneProps> = ({
  session,
  pendingPermission,
  pendingPermissionDepth,
  pendingApproval,
  picker,
  busy,
  yolo,
  slashCommands,
  queueMessages,
  priorityMessage,
  onPermissionDecide,
  onApprovalDecide,
  onPickerSelect,
  onPickerCancel,
  onSubmit,
  onPasteText,
}) => {
  if (pendingPermission) {
    return (
      <PermissionDialog
        call={pendingPermission.call}
        toolDescription={session.tools.get(pendingPermission.call.name)?.description}
        queueDepth={pendingPermissionDepth}
        onDecide={(decision) => onPermissionDecide(pendingPermission, decision)}
      />
    );
  }
  if (pendingApproval) {
    return (
      <ApprovalDialog
        request={pendingApproval.request}
        onDecide={(decision) => onApprovalDecide(decision)}
      />
    );
  }
  if (picker) {
    return (
      <ListPicker
        title={picker.title}
        options={picker.options}
        onSelect={(id) => onPickerSelect(picker, id)}
        onCancel={onPickerCancel}
      />
    );
  }
  // QueueView renders ONLY when there's something to show. When idle and
  // the queue is empty, it returns null and there's no extra spacing.
  return (
    <Box flexDirection="column">
      <QueueView messages={queueMessages} priority={priorityMessage} />
      <InputBox
        onSubmit={onSubmit}
        disabled={false}
        yolo={yolo}
        slashCommands={slashCommands}
        placeholder={
          busy
            ? 'type to queue a message — sent after the current turn (ctrl+j to force-send first)'
            : 'type a prompt or / for commands'
        }
        onPasteText={onPasteText}
      />
    </Box>
  );
};
