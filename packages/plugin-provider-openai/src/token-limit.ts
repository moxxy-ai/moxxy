/** Translate the provider-neutral output budget to Chat Completions fields. */
export function tokenLimitParams(model: string, maxTokens: number | undefined): {
  max_completion_tokens?: number;
  max_tokens?: number;
} {
  if (!maxTokens) return {};
  return /^(?:gpt-5|gpt-6|o1|o3)/.test(model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}
