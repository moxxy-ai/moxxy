import { Select } from "@moxxy/desktop-ui";
import { EFFORT_LABELS } from "../chat/agent-picker/ModelTuning";
import type { EffortLevel } from "../chat/agent-picker/useModelTuning";
import { Switch } from "./settings-primitives";
import { useModelDefaults, type ModelDefaultsState } from "./useModelDefaults";

/** A provider name has no slash, so the first one splits a pick whatever the model id holds. */
const pickValue = (provider: string, model: string): string =>
  `${provider}/${model}`;

const cardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "12px 20px",
  padding: "13px 16px",
  background: "var(--color-card-bg)",
  border: "1px solid var(--color-card-border)",
  borderRadius: "var(--radius-card)",
};

const controlStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const labelStyle: React.CSSProperties = {
  fontSize: "var(--type-meta)",
  fontWeight: 700,
  color: "var(--color-text-dim)",
};

const noteStyle: React.CSSProperties = {
  margin: "3px 0 0",
  fontSize: "var(--type-meta)",
  color: "var(--color-text-dim)",
};

/** Render-only: the model, effort and fast tier a new conversation starts with. State lives in `useModelDefaults`. */
export function DefaultModel({
  defaults,
}: {
  readonly defaults: ModelDefaultsState;
}): JSX.Element {
  const held = defaults.loading || defaults.busy;
  const picked = defaults.provider !== null && defaults.model !== null;
  return (
    <div data-testid="default-model">
      <div style={cardStyle}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <h3
            style={{ margin: 0, fontSize: "var(--type-row)", fontWeight: 600 }}
          >
            Default model
          </h3>
          <p style={noteStyle}>
            {picked
              ? "New conversations start with it — here, in the terminal and in channels. Open ones keep theirs."
              : "Connect a provider below to choose what new conversations start with."}
          </p>
        </div>
        {picked && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "8px 16px",
            }}
          >
            <label style={controlStyle}>
              {/* The closed menu shows the model alone; two providers can list the same one. */}
              <span style={labelStyle}>{defaults.provider}</span>
              <Select
                aria-label="Default model"
                tone="soft"
                value={pickValue(defaults.provider, defaults.model)}
                disabled={held}
                onChange={(e) => {
                  const at = e.target.value.indexOf("/");
                  void defaults.setModel(
                    e.target.value.slice(0, at),
                    e.target.value.slice(at + 1)
                  );
                }}
                style={{ maxWidth: 260 }}
                data-testid="default-model-select"
              >
                {defaults.providers.map((provider) => (
                  <optgroup key={provider.name} label={provider.name}>
                    {provider.models.map((model) => (
                      <option
                        key={model}
                        value={pickValue(provider.name, model)}
                      >
                        {model}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </label>
            {defaults.canSetEffort && (
              <label style={controlStyle}>
                <span style={labelStyle}>Effort</span>
                <Select
                  aria-label="Default reasoning effort"
                  tone="soft"
                  value={defaults.effort}
                  disabled={held}
                  onChange={(e) =>
                    void defaults.setEffort(e.target.value as EffortLevel)
                  }
                  data-testid="default-effort-select"
                >
                  {defaults.effortLevels.map((level) => (
                    <option key={level} value={level}>
                      {EFFORT_LABELS[level]}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {defaults.canSetFast && (
              <div
                style={controlStyle}
                title="About 1.5× faster answers; uses 2–2.5× more of your plan or credits"
              >
                <span style={labelStyle}>Fast</span>
                <Switch
                  on={defaults.fast}
                  label="Fast mode by default"
                  disabled={held}
                  busy={defaults.busy}
                  onClick={() => void defaults.setFast(!defaults.fast)}
                />
              </div>
            )}
          </div>
        )}
      </div>
      {defaults.error && (
        <p
          role="alert"
          style={{
            margin: "6px 0 0",
            fontSize: "var(--type-meta)",
            color: "var(--color-red)",
          }}
        >
          {defaults.error}
        </p>
      )}
    </div>
  );
}

/** The card with its state, for the Providers section to place. */
export function DefaultModelSetting(): JSX.Element {
  return <DefaultModel defaults={useModelDefaults()} />;
}
