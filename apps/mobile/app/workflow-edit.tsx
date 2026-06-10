import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenFrame } from '@/components/ScreenFrame';
import { WorkflowEditor } from '@/components/WorkflowEditor';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useWorkflowEditor } from '@/hooks/useWorkflowEditor';

/**
 * The mobile visual builder screen — an outline editor over the shared
 * `@moxxy/workflows-builder` model. `?name=<slug>` edits an existing workflow
 * (loaded via `workflows.getRun`); no param opens a blank one. On save it
 * navigates back to the list.
 */
export default function WorkflowEditScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string }>();
  const name = typeof params.name === 'string' && params.name.length > 0 ? params.name : null;
  const { permissions, session } = useGatewayStore();
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;
  const editor = useWorkflowEditor();

  useEffect(() => {
    void editor.load(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const onSave = (): void => {
    void editor.save().then((ok) => {
      if (ok) router.back();
    });
  };

  return (
    <ScreenFrame
      title={name ? 'Edit workflow' : 'New workflow'}
      subtitle="Visual builder"
      connected={session.connected}
      pendingActions={pendingActions}
    >
      <WorkflowEditor
        state={editor.state}
        dispatch={editor.dispatch}
        valid={editor.valid}
        validating={editor.validating}
        saving={editor.saving}
        saved={editor.saved}
        error={editor.error}
        onSave={onSave}
      />
    </ScreenFrame>
  );
}
