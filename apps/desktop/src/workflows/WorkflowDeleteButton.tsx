import { Button, Icon, Modal, ModalFooter } from '@moxxy/desktop-ui';
import { useWorkflowDelete } from './useWorkflowDelete';

export function WorkflowDeleteButton({ name, remove }: { name: string; remove: (name: string) => Promise<boolean> }): JSX.Element {
  const state = useWorkflowDelete(name, remove);
  return <>
    <button type="button" className="btn-box tip" data-tip="Delete" aria-label={`Delete ${name}`} onClick={state.request}>
      <Icon name="x" size={14} />
    </button>
    {state.open && <Modal title="Delete workflow?" onClose={state.cancel}>
      <p>Delete {name} and its linked schedule? Waiting approvals will be invalidated. Past conversations and run history will remain.</p>
      {state.error && <p role="alert">{state.error}</p>}
      <ModalFooter>
        <Button variant="secondary" disabled={state.pending} onClick={state.cancel}>Cancel</Button>
        <Button variant="danger" disabled={state.pending} onClick={() => void state.confirm()}>{state.pending ? 'Deleting…' : 'Delete'}</Button>
      </ModalFooter>
    </Modal>}
  </>;
}
