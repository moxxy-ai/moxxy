/**
 * The first-workspace step — pick a folder, name the workspace, and
 * create + activate it. Surfaces any existing workspaces and lets the
 * user skip: the app already runs in a workspace (the built-in Moxxy one,
 * in ~/Moxxy, on a first run), so skipping keeps working there. First-run only.
 */

import { Icon } from '@moxxy/desktop-ui';
import { StepCard, Fields, Nav, PrimaryButton, SuccessRow, inputStyle, pickerBtnStyle } from '../chrome';
import { useWorkspaceStep } from '../useWorkspaceStep';

export function WorkspaceStep({
  onNext,
  onBack,
}: {
  readonly onNext: () => void;
  readonly onBack: () => void;
}): JSX.Element {
  const step = useWorkspaceStep(onNext);
  const { current, count, folder } = step;

  return (
    <StepCard
      title="Pick a workspace"
      sub="A workspace is a folder I'll operate in. You can add more later."
    >
      {current ? (
        <SuccessRow
          text={`Skip, and I’ll work in “${current.name}” at ${current.cwd}. You can pick another folder later.`}
        />
      ) : (
        count > 0 && <SuccessRow text={`You already have ${count} workspace${count === 1 ? '' : 's'}.`} />
      )}
      <Fields>
        <button type="button" onClick={() => void step.pickFolder()} style={pickerBtnStyle}>
          <Icon name="workspace" size={16} />
          {folder ? folder : 'Choose a folder…'}
        </button>
        {folder && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 'var(--type-row)', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              Name
            </span>
            <input
              value={step.name}
              onChange={(e) => step.setName(e.target.value)}
              style={inputStyle}
            />
          </label>
        )}
        {step.error && (
          <p role="alert" style={{ margin: 0, fontSize: 'var(--type-row)', color: 'var(--color-red)' }}>
            {step.error}
          </p>
        )}
        <PrimaryButton onClick={() => void step.create()} disabled={!step.canCreate}>
          {step.creating ? 'Creating…' : 'Create workspace'}
        </PrimaryButton>
      </Fields>
      <Nav onBack={onBack} onNext={onNext} skip />
    </StepCard>
  );
}
