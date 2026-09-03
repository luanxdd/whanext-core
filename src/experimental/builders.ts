import type {
  ExperimentalContent,
  RichCodeBlockOptions,
  RichHtmlOptions,
  RichLinksOptions,
  RichMarkdownOptions,
  RichSuggestionsOptions,
  RichTableOptions,
  RichTipOptions,
  UnifiedResponseOptions,
} from '@/experimental/types.js';

const DEFAULT_BOT_JID = '867051314767696@bot';

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`experimental.${field}: valor obrigatório`);
  }
  return value;
}

function envelope(
  unified: unknown,
  options: { text?: string; botJid?: string; disclaimer?: string; id?: string } = {},
): ExperimentalContent {
  return {
    __whanextExperimental: true,
    kind: 'rich-response',
    response: {
      unified,
      ...(options.text ? { submessages: [options.text] } : {}),
      ...(options.botJid ? { botJid: options.botJid } : { botJid: DEFAULT_BOT_JID }),
      ...(options.disclaimer !== undefined ? { disclaimer: options.disclaimer } : {}),
      ...(options.id !== undefined ? { id: options.id } : {}),
    },
  };
}

function single(primitive: Record<string, unknown>): Record<string, unknown> {
  return {
    view_model: {
      primitive,
      __typename: 'GenAISingleLayoutViewModel',
    },
  };
}

export function richHtml(options: RichHtmlOptions): ExperimentalContent {
  const html = required(options?.html, 'richHtml');
  const title = options.title?.trim() || 'WhaNext';
  return envelope({
    sections: [single({
      __typename: 'GenAIaeacdsnwHtmlPrimitive',
      payload: html,
      trusted_sources: [...(options.trustedSources ?? [])],
    })],
  }, { ...options, text: options.text ?? title });
}

export function markdown(options: RichMarkdownOptions): ExperimentalContent {
  const text = required(options?.markdown, 'markdown');
  return envelope({
    sections: [single({ text, __typename: 'GenAIMarkdownTextUXPrimitive' })],
  }, options);
}

export function codeBlock(options: RichCodeBlockOptions): ExperimentalContent {
  const code = required(options?.code, 'codeBlock');
  const sections: Record<string, unknown>[] = [];
  if (options.before) sections.push(single({ text: options.before, __typename: 'GenAIMarkdownTextUXPrimitive' }));
  sections.push(single({
    language: options.language?.trim() || 'text',
    code_blocks: [{ content: code, type: 'DEFAULT' }],
    __typename: 'GenAICodeUXPrimitive',
  }));
  if (options.after) sections.push(single({ text: options.after, __typename: 'GenAIMarkdownTextUXPrimitive' }));
  return envelope({ sections }, options);
}

export function table(options: RichTableOptions): ExperimentalContent {
  if (!options || !Array.isArray(options.headers) || options.headers.length === 0) {
    throw new TypeError('experimental.table: headers é obrigatório');
  }
  if (!Array.isArray(options.rows)) throw new TypeError('experimental.table: rows é obrigatório');
  const width = options.headers.length;
  const normalizedRows = options.rows.map((row) => {
    if (row.length !== width) throw new TypeError('experimental.table: todas as linhas devem ter o mesmo número de colunas do header');
    return { is_header: false, cells: [...row] };
  });
  const sections: Record<string, unknown>[] = [];
  if (options.title) sections.push(single({ text: options.title, __typename: 'GenAIMarkdownTextUXPrimitive' }));
  if (options.text) sections.push(single({ text: options.text, __typename: 'GenAIMarkdownTextUXPrimitive' }));
  sections.push(single({
    rows: [{ is_header: true, cells: [...options.headers] }, ...normalizedRows],
    __typename: 'GenATableUXPrimitive',
  }));
  if (options.footer) sections.push(single({ text: options.footer, __typename: 'GenAIMarkdownTextUXPrimitive' }));
  return envelope({ sections }, options);
}

export function links(options: RichLinksOptions): ExperimentalContent {
  const text = required(options?.markdown, 'links');
  if (!Array.isArray(options.links) || options.links.length === 0) {
    throw new TypeError('experimental.links: links é obrigatório');
  }
  const values = options.links.map((item, index) => {
    const link = typeof item === 'string' ? { url: item } : item;
    const url = required(link.url, 'links.url');
    return {
      url,
      label: link.label?.trim() || `Link ${index + 1}`,
      subtitle: link.subtitle?.trim() || '',
    };
  });
  const inline_entities = values.map((link, index) => ({
    key: `IE_${index}`,
    metadata: {
      reference_id: index + 1,
      reference_url: link.url,
      reference_title: link.label,
      reference_display_name: link.label,
      sources: [{
        source_type: 'THIRD_PARTY',
        source_display_name: link.label,
        source_subtitle: link.subtitle,
        source_url: link.url,
      }],
      __typename: 'GenAISearchCitationItem',
    },
  }));
  const sections: Record<string, unknown>[] = [single({
    text,
    inline_entities,
    __typename: 'GenAIMarkdownTextUXPrimitive',
  })];
  if (options.showSources !== false) {
    sections.push(single({
      sources: values.map((link) => ({
        source_type: 'THIRD_PARTY',
        source_display_name: link.label,
        source_subtitle: link.subtitle,
        source_url: link.url,
      })),
      search_engine: 'WhaNext',
      __typename: 'GenAISearchResultPrimitive',
    }));
  }
  return envelope({ sections }, options);
}

export function suggestions(options: RichSuggestionsOptions): ExperimentalContent {
  if (!Array.isArray(options?.suggestions) || options.suggestions.length === 0) {
    throw new TypeError('experimental.suggestions: suggestions é obrigatório');
  }
  const values = options.suggestions.map((value) => required(value, 'suggestions.item'));
  const primitives = values.map((prompt_text) => ({
    prompt_text,
    prompt_type: 'SUGGESTED_PROMPT',
    __typename: 'GenAIFollowUpSuggestionPillPrimitive',
  }));
  const layout = options.layout ?? (primitives.length === 1 ? 'single' : 'scroll');
  const name = layout === 'single' ? 'GenAISingleLayoutViewModel' : layout === 'row' ? 'GenAIActionRowLayoutViewModel' : 'GenAIHScrollLayoutViewModel';
  return envelope({
    sections: [{
      view_model: {
        primitive: layout === 'single' ? primitives[0] : primitives,
        __typename: name,
      },
      __typename: 'GenAIUnifiedResponseSection',
    }],
  }, options);
}

export function tip(options: RichTipOptions): ExperimentalContent {
  const text = required(options?.text, 'tip');
  return envelope({
    sections: [single({ text, __typename: 'GenAIMetadataTextPrimitive' })],
  }, options);
}

export function unifiedResponse(options: UnifiedResponseOptions): ExperimentalContent {
  if (!options || options.data === undefined) throw new TypeError('experimental.unifiedResponse: data é obrigatório');
  return envelope(options.data, options);
}

export function encodeUnifiedResponse(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function decodeUnifiedResponse<T = unknown>(value: string): T {
  required(value, 'decodeUnifiedResponse');
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as T;
}
