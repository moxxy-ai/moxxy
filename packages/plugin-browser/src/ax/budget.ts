/**
 * The most a read of a page may put in front of the model.
 *
 * Every read stays in the conversation and is sent again with each later call,
 * so its size is paid many times over: one 178,073-character read of Coolify's
 * service catalogue cost +48,011 tokens, and the task carried it through 44
 * further calls. A page larger than this is still all there — its uids still
 * work and browser_find searches all of it — it is just not all sent.
 */
export const READ_BUDGET = 20_000;
/**
 * The read that closes a run of steps (`browser_run`). The run's own report
 * already says what each step did; the page after it is there to continue
 * from, and in the Coolify task every run ended with 10–15k characters of it.
 */
export const BRIEF_READ_BUDGET = 6_000;
/** A read the agent asked for whole (`full: true`) gets more room, still with a ceiling. */
export const FULL_READ_BUDGET = 50_000;

/**
 * `text` cut to `budget` characters at a whole row, with a closing line that
 * says how much was left out and how to reach it.
 */
export function withinBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.lastIndexOf('\n', budget);
  const kept = text.slice(0, cut > 0 ? cut : budget);
  const left = text.slice(kept.length).split('\n').filter((line) => line.trim() !== '').length;
  return (
    `${kept}\n… ${left} more rows not shown — the page goes on. Look for what you need with browser_find, ` +
    'or scroll to it and read again.'
  );
}
