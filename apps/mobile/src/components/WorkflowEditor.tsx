import { Pressable, Text, TextInput, View } from 'react-native';
import {
  STEP_KINDS,
  stepKindMeta,
  type BuilderAction,
  type BuilderNode,
  type BuilderState,
  type StepKind,
} from '@moxxy/workflows-builder';
import type { WorkflowStepErrorMode } from '@moxxy/sdk';
import { MobileIcon } from './MobileIcon';

/**
 * Mobile workflow editor — an OUTLINE editor over the shared builder model.
 * Touch-dragging a node graph is disproportionate for v1, so the mobile UI is
 * a vertical list of step cards with the SAME operations the desktop canvas
 * exposes (add/remove step, set needs, edit the action, and the loop's body +
 * exit + condition + maxIterations). All mutations go through the shared
 * reducer; this component is presentation + touch interaction only.
 *
 * The loop card surfaces both connection regions explicitly: a BODY toggle list
 * (steps that run inside the loop) and an EXIT picker (the single "on done / on
 * error → next" step), mirroring the desktop canvas's two-region loop model.
 */

const ACCENT_HEX: Record<ReturnType<typeof stepKindMeta>['accent'], string> = {
  blue: '#3b82f6',
  green: '#10b981',
  purple: '#8b5cf6',
  teal: '#14b8a6',
  amber: '#f59e0b',
  pink: '#ec4899',
  cyan: '#06b6d4',
  orange: '#f97316',
};

const ERROR_MODES: WorkflowStepErrorMode[] = ['fail', 'continue', 'retry'];

interface Props {
  readonly state: BuilderState;
  readonly dispatch: (action: BuilderAction) => void;
  readonly valid: boolean | null;
  readonly validating: boolean;
  readonly saving: boolean;
  readonly saved: boolean;
  readonly error: string | null;
  readonly onSave: () => void;
}

export function WorkflowEditor(props: Props) {
  const { state, dispatch } = props;
  return (
    <View className="gap-4">
      {/* Header: name + description */}
      <View className="gap-3 rounded-card border border-cardBorder bg-cardBg p-4 shadow-card" style={{ shadowOpacity: 0.08 }}>
        <FieldLabel>Workflow name (slug)</FieldLabel>
        <TextInput
          value={state.meta.name}
          onChangeText={(name) => dispatch({ type: 'update-meta', patch: { name } })}
          autoCapitalize="none"
          placeholder="my-workflow"
          placeholderTextColor="#94a3b8"
          className="rounded-block border border-cardBorder bg-cardBg px-3 py-2 text-[14px] text-text"
        />
        <FieldLabel>Description</FieldLabel>
        <TextInput
          value={state.meta.description}
          onChangeText={(description) => dispatch({ type: 'update-meta', patch: { description } })}
          placeholder="What this workflow does"
          placeholderTextColor="#94a3b8"
          className="rounded-block border border-cardBorder bg-cardBg px-3 py-2 text-[14px] text-text"
        />
        <View className="flex-row items-center justify-between">
          <ValidityBadge valid={props.valid} validating={props.validating} saved={props.saved} />
          <Pressable
            className={`min-h-11 flex-row items-center justify-center gap-2 rounded-pill px-5 ${
              props.saving || props.valid === false ? 'bg-cardBorder' : 'bg-primary'
            }`}
            disabled={props.saving || props.valid === false}
            onPress={props.onSave}
          >
            <MobileIcon name="check" size={16} color="#ffffff" strokeWidth={2.6} />
            <Text className="text-[13px] font-black text-white">{props.saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>
        {props.error ? (
          <View className="rounded-block border border-red bg-red/10 px-3 py-2">
            <Text className="text-[12px] font-bold text-red">{props.error}</Text>
          </View>
        ) : null}
      </View>

      {/* Palette */}
      <View className="gap-2 rounded-card border border-cardBorder bg-cardBg p-4 shadow-card" style={{ shadowOpacity: 0.08 }}>
        <FieldLabel>Add step</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {STEP_KINDS.map((k) => (
            <Pressable
              key={k.kind}
              testID={`mobile-palette-add-${k.kind}`}
              className="rounded-pill border px-3 py-1.5"
              style={{ borderColor: ACCENT_HEX[k.accent] }}
              onPress={() => dispatch({ type: 'add-step', input: { kind: k.kind } })}
            >
              <Text className="text-[12px] font-black" style={{ color: ACCENT_HEX[k.accent] }}>
                + {k.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {state.nodes.length === 0 ? (
        <View className="rounded-card border border-cardBorder bg-cardBg p-5">
          <Text className="text-[14px] text-muted">Add a step above to start building.</Text>
        </View>
      ) : null}

      {state.nodes.map((node) => (
        <StepCard key={node.id} state={state} node={node} dispatch={dispatch} />
      ))}
    </View>
  );
}

function StepCard({
  state,
  node,
  dispatch,
}: {
  state: BuilderState;
  node: BuilderNode;
  dispatch: (a: BuilderAction) => void;
}) {
  const meta = stepKindMeta(node.kind);
  const accent = ACCENT_HEX[meta.accent];
  const errors = state.errors[node.id] ?? [];
  const others = state.nodes.filter((n) => n.id !== node.id);

  const patch = (p: Parameters<typeof emitUpdate>[2]): void => emitUpdate(dispatch, node.id, p);

  return (
    <View
      testID={`mobile-node-${node.id}`}
      className="gap-3 rounded-card border border-cardBorder bg-cardBg p-4 shadow-card"
      style={{ shadowOpacity: 0.08, borderLeftWidth: 5, borderLeftColor: accent }}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-[11px] font-black uppercase" style={{ color: accent }}>
          {meta.label}
        </Text>
        <Pressable testID={`mobile-delete-${node.id}`} onPress={() => dispatch({ type: 'remove-step', id: node.id })}>
          <MobileIcon name="x" size={18} color="#ef4444" />
        </Pressable>
      </View>

      <FieldLabel>Step id</FieldLabel>
      <TextInput
        value={node.id}
        onChangeText={(to) => dispatch({ type: 'rename-node', from: node.id, to })}
        autoCapitalize="none"
        className="rounded-block border border-cardBorder bg-cardBg px-3 py-2 text-[13px] text-text"
      />
      <FieldLabel>Label</FieldLabel>
      <TextInput
        value={node.label ?? ''}
        onChangeText={(label) => patch({ label })}
        placeholder="Human title"
        placeholderTextColor="#94a3b8"
        className="rounded-block border border-cardBorder bg-cardBg px-3 py-2 text-[13px] text-text"
      />

      {node.kind !== 'loop' ? (
        <>
          <FieldLabel>{actionLabel(node.kind)}</FieldLabel>
          <TextInput
            testID={`mobile-action-${node.id}`}
            value={node.action}
            onChangeText={(action) => patch({ action })}
            multiline={node.kind === 'prompt' || node.kind === 'bridge' || node.kind === 'condition' || node.kind === 'switch'}
            placeholder={meta.description}
            placeholderTextColor="#94a3b8"
            className="min-h-11 rounded-block border border-cardBorder bg-cardBg px-3 py-2 text-[13px] text-text"
          />
        </>
      ) : (
        <LoopCard state={state} node={node} dispatch={dispatch} accent={accent} />
      )}

      {node.kind === 'condition' ? (
        <>
          <TogglePicker
            label="then → (met)"
            options={others}
            selected={node.then ?? []}
            onToggle={(id, on) => toggleBranch(dispatch, node, 'then', id, on)}
          />
          <TogglePicker
            label="else → (not met)"
            options={others}
            selected={node.else ?? []}
            onToggle={(id, on) => toggleBranch(dispatch, node, 'else', id, on)}
          />
        </>
      ) : null}

      {node.kind !== 'loop' ? (
        <TogglePicker
          label="Needs"
          testID={`mobile-needs-${node.id}`}
          options={others}
          selected={node.needs}
          onToggle={(id, on) =>
            dispatch(on ? { type: 'connect-needs', from: id, to: node.id } : { type: 'disconnect-needs', from: id, to: node.id })
          }
        />
      ) : null}

      <FieldLabel>On error</FieldLabel>
      <View className="flex-row gap-2">
        {ERROR_MODES.map((m) => (
          <Pressable
            key={m}
            className={`rounded-pill px-3 py-1.5 ${node.onError === m ? 'bg-primary' : 'bg-appBg'}`}
            onPress={() => patch({ onError: m })}
          >
            <Text className={`text-[12px] font-bold ${node.onError === m ? 'text-white' : 'text-muted'}`}>{m}</Text>
          </Pressable>
        ))}
      </View>

      {errors.length > 0 ? (
        <View testID={`mobile-errors-${node.id}`} className="rounded-block border border-red bg-red/10 px-3 py-2">
          {errors.map((msg, i) => (
            <Text key={i} className="text-[11px] text-red">
              {msg}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function LoopCard({
  state,
  node,
  dispatch,
  accent,
}: {
  state: BuilderState;
  node: BuilderNode;
  dispatch: (a: BuilderAction) => void;
  accent: string;
}) {
  const body = node.loop?.body ?? [];
  const bodySet = new Set(body);
  const exit = state.edges.find((e) => e.kind === 'loop-exit' && e.from === node.id)?.to ?? '';
  const candidates = state.nodes.filter((n) => n.id !== node.id);
  return (
    <View className="gap-3">
      <FieldLabel>Exit / goal condition (met → stop)</FieldLabel>
      <TextInput
        testID={`mobile-loop-condition-${node.id}`}
        value={node.loop?.condition ?? ''}
        onChangeText={(condition) => dispatch({ type: 'set-loop-config', loopId: node.id, patch: { condition } })}
        multiline
        placeholder="Describe the goal that ENDS the loop."
        placeholderTextColor="#94a3b8"
        className="min-h-16 rounded-block border border-cardBorder bg-cardBg px-3 py-2 text-[13px] text-text"
      />
      <FieldLabel>Max iterations (1-50)</FieldLabel>
      <TextInput
        value={String(node.loop?.maxIterations ?? 10)}
        onChangeText={(v) => dispatch({ type: 'set-loop-config', loopId: node.id, patch: { maxIterations: Number(v) || 1 } })}
        keyboardType="number-pad"
        className="rounded-block border border-cardBorder bg-cardBg px-3 py-2 text-[13px] text-text"
      />
      <FieldLabel>Body — runs inside the loop each iteration</FieldLabel>
      <View testID={`mobile-loop-body-${node.id}`} className="gap-2">
        {candidates.length === 0 ? <Text className="text-[12px] text-muted">Add steps, then assign them here.</Text> : null}
        {candidates.map((c) => {
          const on = bodySet.has(c.id);
          return (
            <Pressable
              key={c.id}
              disabled={c.id === exit}
              className={`flex-row items-center gap-2 rounded-block border px-3 py-2 ${on ? 'border-purple bg-purple/10' : 'border-cardBorder'}`}
              style={{ borderColor: on ? accent : undefined }}
              onPress={() =>
                dispatch({
                  type: 'set-loop-body',
                  loopId: node.id,
                  body: on ? body.filter((b) => b !== c.id) : [...body, c.id],
                })
              }
            >
              <MobileIcon name={on ? 'check' : 'plus'} size={15} color={on ? accent : '#94a3b8'} />
              <Text className="text-[13px] text-text">{c.label || c.id}</Text>
            </Pressable>
          );
        })}
      </View>
      <FieldLabel>Exit → next step (on done / body error)</FieldLabel>
      <View className="gap-2">
        <Pressable
          className={`rounded-block border px-3 py-2 ${exit === '' ? 'border-primary bg-primary/10' : 'border-cardBorder'}`}
          onPress={() => dispatch({ type: 'set-loop-exit', loopId: node.id, targetId: null })}
        >
          <Text className="text-[13px] text-text">(loop ends the workflow)</Text>
        </Pressable>
        {candidates
          .filter((c) => !bodySet.has(c.id))
          .map((c) => (
            <Pressable
              key={c.id}
              testID={`mobile-loop-exit-${node.id}-${c.id}`}
              className={`rounded-block border px-3 py-2 ${exit === c.id ? 'border-primary bg-primary/10' : 'border-cardBorder'}`}
              onPress={() => dispatch({ type: 'set-loop-exit', loopId: node.id, targetId: c.id })}
            >
              <Text className="text-[13px] text-text">{c.label || c.id}</Text>
            </Pressable>
          ))}
      </View>
    </View>
  );
}

function TogglePicker({
  label,
  options,
  selected,
  onToggle,
  testID,
}: {
  label: string;
  options: BuilderNode[];
  selected: ReadonlyArray<string>;
  onToggle: (id: string, on: boolean) => void;
  testID?: string;
}) {
  const set = new Set(selected);
  return (
    <View className="gap-2" testID={testID}>
      <FieldLabel>{label}</FieldLabel>
      {options.length === 0 ? <Text className="text-[12px] text-muted">No other steps yet.</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        {options.map((o) => {
          const on = set.has(o.id);
          return (
            <Pressable
              key={o.id}
              className={`rounded-pill px-3 py-1.5 ${on ? 'bg-primary' : 'bg-appBg'}`}
              onPress={() => onToggle(o.id, !on)}
            >
              <Text className={`text-[12px] font-bold ${on ? 'text-white' : 'text-muted'}`}>{o.label || o.id}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ValidityBadge({ valid, validating, saved }: { valid: boolean | null; validating: boolean; saved: boolean }) {
  const { label, color } = saved
    ? { label: 'saved', color: '#10b981' }
    : validating
      ? { label: 'checking…', color: '#94a3b8' }
      : valid === true
        ? { label: 'valid', color: '#10b981' }
        : valid === false
          ? { label: 'invalid', color: '#ef4444' }
          : { label: 'unsaved', color: '#94a3b8' };
  return (
    <View testID="mobile-validity-badge" className="rounded-pill px-3 py-1" style={{ borderWidth: 1, borderColor: color }}>
      <Text className="text-[12px] font-black" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text className="text-[10px] font-black uppercase tracking-wide text-muted">{children}</Text>;
}

function actionLabel(kind: StepKind): string {
  switch (kind) {
    case 'prompt':
      return 'Prompt';
    case 'skill':
      return 'Skill name';
    case 'tool':
      return 'Tool name';
    case 'workflow':
      return 'Workflow name';
    case 'bridge':
    case 'condition':
    case 'switch':
      return 'Instruction';
    default:
      return 'Action';
  }
}

function toggleBranch(
  dispatch: (a: BuilderAction) => void,
  node: BuilderNode,
  slot: 'then' | 'else',
  id: string,
  on: boolean,
): void {
  const current = (slot === 'then' ? node.then : node.else) ?? [];
  const targets = on ? [...current, id] : current.filter((t) => t !== id);
  dispatch({ type: 'set-branch', nodeId: node.id, slot, targets });
}

function emitUpdate(
  dispatch: (a: BuilderAction) => void,
  id: string,
  patch: { label?: string; action?: string; onError?: WorkflowStepErrorMode },
): void {
  dispatch({ type: 'update-node', id, patch });
}
