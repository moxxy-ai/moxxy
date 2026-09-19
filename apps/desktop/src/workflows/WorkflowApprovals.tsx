import { useState } from 'react';
import { useActiveWorkspaceId, useWorkflowApprovals } from '@moxxy/client-core';
import { Modal } from '@moxxy/desktop-ui';
import { WorkflowApprovalCard } from './WorkflowApprovalCard';

export function WorkflowApprovals({ modal = false }: { modal?: boolean }): JSX.Element | null {
  const workspaceId = useActiveWorkspaceId();
  const state = useWorkflowApprovals(workspaceId);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const pending = state.items.find((item) => item.status === 'pending' && item.id !== dismissed);
  const render = (item: typeof state.items[number]) => (
    <WorkflowApprovalCard
      key={item.id}
      item={item}
      busy={state.busy === item.id}
      onDecide={(choice) => {
        void state.respond(item.id, choice);
      }}
      onRevoke={() => {
        void state.respond(item.id);
      }}
    />
  );
  if (modal) {
    if (!pending) return null;
    return (
      <Modal title="Workflow needs approval" onClose={() => setDismissed(pending.id)}>
        {render(pending)}
        {state.error && <p role="alert">{state.error}</p>}
        <p>Closing this window leaves the request waiting in Automations → Workflows.</p>
      </Modal>
    );
  }
  return (
    <section aria-label="Workflow approvals">
      <h2>Approvals</h2>
      {state.error && <p role="alert">{state.error}</p>}
      {state.items.length === 0 ? <p>No workflow approvals.</p> : state.items.map(render)}
    </section>
  );
}
