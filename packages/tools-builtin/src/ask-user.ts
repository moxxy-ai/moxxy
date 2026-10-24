import { MoxxyError, defineTool, describeQuestionAnswers, questionAnswerDisplay, z, type QuestionItem } from '@moxxy/sdk';

const NOBODY_ANSWERS =
  'Nobody can answer questions here. Decide on your own, go on, and say which choices you made and why.';

export const askUserTool = defineTool({
  name: 'ask_user',
  icon: 'chat',
  description:
    'Ask the user one to four questions and wait for the answers. Use it only when a decision is ' +
    "genuinely the user's to make and you cannot settle it from the request, the code, or a sensible " +
    'default — which of two designs, which scope, which name. Offer two to four concrete answers per ' +
    'question; the user can always answer in their own words instead. Do not ask leave to run a tool ' +
    '(the user is asked for that separately) or whether to continue.',
  inputSchema: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().trim().min(1).describe('The full question, ending with a question mark.'),
          header: z.string().trim().min(1).max(30).optional().describe('A short tag, for example "Auth method".'),
          options: z
            .array(
              z.object({
                label: z.string().trim().min(1).describe('A short answer, one to five words.'),
                description: z.string().trim().min(1).optional().describe('What choosing it means.'),
              }),
            )
            .min(2)
            .max(4),
          multiSelect: z.boolean().optional().describe('True when several answers can be chosen together.'),
        }),
      )
      .min(1)
      .max(4),
  }),
  // Goal mode runs unattended: nobody is there to answer, so the agent decides
  // on its own and says what it chose (as Claude Code drops its question tool
  // from unattended runs).
  notInModes: ['goal'],
  // Asking changes nothing, so it never needs leave to run.
  permission: { action: 'allow' },
  // It waits on the person for as long as they take, so no time budget.
  isolation: { required: 'inproc', capabilities: { net: { mode: 'none' } } },
  async handler(input, ctx) {
    if (!ctx.ask) return NOBODY_ANSWERS;
    const questions: QuestionItem[] = input.questions.map((item, index) => ({
      id: `q${index + 1}`,
      ...(item.header ? { header: item.header } : {}),
      question: item.question,
      options: item.options.map((option, at) => ({
        id: `o${at + 1}`,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
      multiSelect: item.multiSelect ?? false,
      allowOther: true,
    }));

    const outcome = await ctx.ask(questions);
    if (outcome.kind === 'answered') {
      // The model reads the text; the transcript keeps what the person chose.
      return {
        forModel: describeQuestionAnswers(questions, outcome.answers),
        display: questionAnswerDisplay(questions, outcome.answers),
      };
    }
    if (outcome.kind === 'unanswerable') return NOBODY_ANSWERS;
    throw new MoxxyError({ code: 'ABORTED', message: 'The question was closed because the turn stopped.' });
  },
});
