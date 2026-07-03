/**
 * Raw Discord message-component JSON (API shape) for the button rows the
 * channel renders. Built as plain objects rather than discord.js Builders so
 * the prompt modules stay dependency-free and unit-testable — discord.js
 * accepts raw API component data in `send()` payloads.
 */

/** Discord API button styles. */
export const BUTTON_STYLE = {
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
} as const;

export interface ApiButton {
  readonly type: 2;
  readonly style: number;
  readonly label: string;
  readonly custom_id: string;
}

export interface ApiActionRow {
  readonly type: 1;
  readonly components: ReadonlyArray<ApiButton>;
}

const MAX_LABEL_CHARS = 80;
const MAX_CUSTOM_ID_CHARS = 100;
const MAX_BUTTONS_PER_ROW = 5;
const MAX_ROWS = 5;

export function button(customId: string, label: string, style: number): ApiButton {
  return {
    type: 2,
    style,
    label: label.slice(0, MAX_LABEL_CHARS) || '…',
    custom_id: customId.slice(0, MAX_CUSTOM_ID_CHARS),
  };
}

/** Pack buttons into action rows (5 per row, 5 rows max — 25 button cap). */
export function packRows(buttons: ReadonlyArray<ApiButton>): ApiActionRow[] {
  const rows: ApiActionRow[] = [];
  for (let i = 0; i < buttons.length && rows.length < MAX_ROWS; i += MAX_BUTTONS_PER_ROW) {
    rows.push({ type: 1, components: buttons.slice(i, i + MAX_BUTTONS_PER_ROW) });
  }
  return rows;
}
