/** The New schedule dialog: the form's state is made fresh each time it opens. */

import type { ScheduleCreateInput } from '@moxxy/desktop-ipc-contract';
import type { ScheduleCreateOutcome } from '@moxxy/client-core';
import { Modal } from '@moxxy/desktop-ui';
import { ScheduleFormFields } from './ScheduleFormFields';
import { useScheduleForm } from './useScheduleForm';

export function NewScheduleModal({
  create,
  onClose,
}: {
  readonly create: (input: ScheduleCreateInput) => Promise<ScheduleCreateOutcome>;
  readonly onClose: () => void;
}): JSX.Element {
  const form = useScheduleForm({ create, onCreated: onClose });
  return (
    <Modal title="New schedule" onClose={onClose} width={560} className="moxxy-modal--pop">
      <ScheduleFormFields form={form} onCancel={onClose} />
    </Modal>
  );
}
