import type { QuestionAnswers, QuestionItem } from '@moxxy/sdk';

interface ClaudeQuestion {
  readonly question?: unknown;
  readonly header?: unknown;
  readonly multiSelect?: unknown;
  readonly options?: ReadonlyArray<{ readonly label?: unknown; readonly description?: unknown }>;
}

/** Claude's AskUserQuestion input as Moxxy Questions. Claude adds "Other" itself, so an own answer always fits. */
export function fromClaudeQuestions(input: unknown): QuestionItem[] {
  const questions = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions)) return [];
  return (questions as ReadonlyArray<ClaudeQuestion>).flatMap((q, i) => {
    if (typeof q.question !== 'string') return [];
    const id = `q${i}`;
    return [
      {
        id,
        ...(typeof q.header === 'string' ? { header: q.header } : {}),
        question: q.question,
        options: (q.options ?? []).flatMap((option, j) =>
          typeof option.label === 'string'
            ? [{ id: `${id}o${j}`, label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}) }]
            : [],
        ),
        multiSelect: q.multiSelect === true,
        allowOther: true,
      },
    ];
  });
}

/** The person's answers keyed by question text: chosen labels joined, an own answer as written. */
export function toClaudeAnswers(items: ReadonlyArray<QuestionItem>, answers: QuestionAnswers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    const answer = answers[item.id];
    if (!answer) continue;
    const labels = item.options.filter((option) => answer.selected.includes(option.id)).map((option) => option.label);
    if (answer.other) labels.push(answer.other);
    out[item.question] = labels.join(', ');
  }
  return out;
}
