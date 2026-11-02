/**
 * `text` without the marks it ends on. A loop instead of `/[…]+$/`: that
 * pattern retries from every mark in a long run that does not end the text,
 * so a reply of many commas would stall speech for seconds.
 */
export function trimTrailing(text: string, marks: ReadonlySet<string>): string {
  let end = text.length;
  while (end > 0 && marks.has(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}
