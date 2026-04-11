import anthropic from './anthropic.js';
import openai from './openai.js';
import openaiCodex from './openai-codex.js';
import ollama from './ollama.js';
import xai from './xai.js';
import google from './google.js';
import deepseek from './deepseek.js';
import zai from './zai.js';
import zaiCodingPlan from './zai-coding-plan.js';
import claudeCli from './claude-cli.js';

export const BUILTIN_PROVIDERS = [
  anthropic,
  openai,
  openaiCodex,
  ollama,
  xai,
  google,
  deepseek,
  zai,
  zaiCodingPlan,
  claudeCli,
];
