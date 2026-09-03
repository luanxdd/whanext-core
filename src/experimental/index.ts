export {
  codeBlock,
  decodeUnifiedResponse,
  encodeUnifiedResponse,
  links,
  markdown,
  richHtml,
  suggestions,
  table,
  tip,
  unifiedResponse,
} from '@/experimental/builders.js';
export { replyExperimental, sendExperimental } from '@/experimental/service.js';
export type {
  ExperimentalBaseOptions,
  ExperimentalContent,
  ExperimentalEnvelope,
  RichCodeBlockOptions,
  RichHtmlOptions,
  RichLinkItem,
  RichLinksOptions,
  RichMarkdownOptions,
  RichSuggestionsOptions,
  RichTableOptions,
  RichTipOptions,
  RichResponseBuildOptions,
  UnifiedResponseOptions,
} from '@/experimental/types.js';
export { RichResponseBuilder } from '@/experimental/rich-response-builder.js';

import {
  codeBlock,
  decodeUnifiedResponse,
  encodeUnifiedResponse,
  links,
  markdown,
  richHtml,
  suggestions,
  table,
  tip,
  unifiedResponse,
} from '@/experimental/builders.js';
import { replyExperimental, sendExperimental } from '@/experimental/service.js';
import { RichResponseBuilder } from '@/experimental/rich-response-builder.js';

export const experimental = Object.freeze({
  RichResponseBuilder,
  richHtml,
  markdown,
  codeBlock,
  table,
  tip,
  links,
  suggestions,
  unifiedResponse,
  encodeUnifiedResponse,
  decodeUnifiedResponse,
  send: sendExperimental,
  reply: replyExperimental,
});
