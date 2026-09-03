import type { ExperimentalContent } from '@/experimental/types.js';

export function isExperimentalContent(value: unknown): value is ExperimentalContent {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.__whanextExperimental === true && record.kind === 'rich-response' && typeof record.response === 'object' && record.response !== null;
}
