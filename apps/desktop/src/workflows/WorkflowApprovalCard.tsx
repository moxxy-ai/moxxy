import type { WorkflowApprovalChoice, WorkflowApprovalItem } from '@moxxy/sdk';
import { Button } from '@moxxy/desktop-ui';

export function WorkflowApprovalCard({
  item,
  busy,
  onDecide,
  onRevoke,
}: {
  item: WorkflowApprovalItem;
  busy: boolean;
  onDecide: (choice: WorkflowApprovalChoice | 'cancel') => void;
  onRevoke: () => void;
}): JSX.Element {
  return (
    <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
      <h3>{item.workflowName}</h3>
      <p>
        {item.tool} · {item.status}
      </p>
      <details>
        <summary>Exact action and scope</summary>
        <p>
          Run: {item.runId}
          <br />
          Definition: {item.revision}
        </p>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            maxHeight: 240,
            overflow: 'auto',
          }}
        >
          {JSON.stringify(item.input, null, 2)}
        </pre>
      </details>
      <p>
        Allow always applies only to this workflow definition and these exact arguments. It does not
        allow all tools.
      </p>
      {item.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button disabled={busy} onClick={() => onDecide('allow_once')}>
            Allow once
          </Button>
          <Button disabled={busy} onClick={() => onDecide('allow_always')}>
            Allow always for this workflow
          </Button>
          <Button disabled={busy} onClick={() => onDecide('deny')}>
            Deny
          </Button>
          <Button disabled={busy} onClick={() => onDecide('cancel')}>
            Stop workflow
          </Button>
        </div>
      )}
      {item.status === 'allowed' && item.choice === 'allow_always' && (
        <Button disabled={busy} onClick={onRevoke}>
          Revoke approval
        </Button>
      )}
      {item.status === 'interrupted' && (
        <p>The runner stopped. This action will not be replayed automatically.</p>
      )}
    </section>
  );
}
