/** The words of a description, lower-cased, without punctuation. */
export const wordsIn = (target: string) => target.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const FOCUS = new Set(['focus', 'focused', 'focussed', 'cursor', 'caret', 'fokus', 'fokusie', 'fokusem', 'kursor', 'kursorem', 'kursora']);

/** A target that says where the focus is, which changes from one run to the next, rather than which element it is. */
export const pointsAtFocus = (target: string) => wordsIn(target).some((word) => FOCUS.has(word));

/** Words that only say which element that is: the one with the focus. */
export const OF_THE_FOCUS: ReadonlySet<string> = new Set([...FOCUS, 'the', 'a', 'keyboard', 'current', 'currently', 'active', 'element', 'field', 'input', 'with', 'has', 'in']);
