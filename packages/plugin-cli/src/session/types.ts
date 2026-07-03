import type {
  ApprovalDecision,
  ApprovalRequest,
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
} from '@moxxy/sdk';
import type { ListPickerOption, ListPickerTab } from '../components/ListPicker.js';

export type Overlay =
  | { kind: 'skills' }
  | { kind: 'tools' }
  | { kind: 'agents' }
  | { kind: 'usage' }
  | { kind: 'workflows' }
  | { kind: 'channels' }
  | null;

export type Picker =
  | null
  | {
      kind: 'model';
      title: string;
      tabs: ReadonlyArray<ListPickerTab>;
      initialTabId?: string;
      searchable?: boolean;
      searchPlaceholder?: string;
    }
  | { kind: 'mode'; title: string; options: ReadonlyArray<ListPickerOption> }
  | {
      kind: 'sessions';
      title: string;
      options: ReadonlyArray<ListPickerOption>;
      searchable?: boolean;
      searchPlaceholder?: string;
    }
  | {
      kind: 'plugins';
      title: string;
      tabs: ReadonlyArray<ListPickerTab>;
      initialTabId?: string;
      searchable?: boolean;
      searchPlaceholder?: string;
    }
  | { kind: 'mcp-server'; title: string; options: ReadonlyArray<ListPickerOption> }
  | {
      kind: 'mcp-action';
      title: string;
      serverName: string;
      options: ReadonlyArray<ListPickerOption>;
    }
  | {
      /**
       * Install-on-first-use confirm: a slash command or picker asked for a
       * capability whose package isn't installed but the catalog provides.
       * Picking `install` runs the picker install flow, then re-runs `rerun`
       * (the original slash line) so the user lands exactly where they were
       * headed — through the unmodified code path.
       */
      kind: 'install-confirm';
      title: string;
      options: ReadonlyArray<ListPickerOption>;
      catalogId: string;
      rerun: string;
    };

export interface PendingPermission {
  call: PendingToolCall;
  ctx: PermissionContext;
  resolve: (d: PermissionDecision) => void;
}

export interface PendingApproval {
  request: ApprovalRequest;
  resolve: (d: ApprovalDecision) => void;
}
