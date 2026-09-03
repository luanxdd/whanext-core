import {
  codeBlock,
  links,
  markdown,
  richHtml,
  suggestions,
  table,
  tip,
} from '@/experimental/builders.js';
import type {
  ExperimentalContent,
  RichCodeBlockOptions,
  RichHtmlOptions,
  RichLinksOptions,
  RichMarkdownOptions,
  RichResponseBuildOptions,
  RichSuggestionsOptions,
  RichTableOptions,
  RichTipOptions,
} from '@/experimental/types.js';

function sectionsOf(content: ExperimentalContent): unknown[] {
  const unified = content.response.unified as { sections?: unknown[] };
  return Array.isArray(unified.sections) ? unified.sections : [];
}

export class RichResponseBuilder {
  readonly #sections: unknown[] = [];

  markdown(value: string | RichMarkdownOptions): this {
    const options = typeof value === 'string' ? { markdown: value } : value;
    this.#sections.push(...sectionsOf(markdown(options)));
    return this;
  }

  html(value: string | RichHtmlOptions, title = 'WhaNext'): this {
    const options = typeof value === 'string' ? { html: value, title } : value;
    this.#sections.push(...sectionsOf(richHtml(options)));
    return this;
  }

  code(value: string | RichCodeBlockOptions, language = 'text'): this {
    const options = typeof value === 'string' ? { code: value, language } : value;
    this.#sections.push(...sectionsOf(codeBlock(options)));
    return this;
  }

  table(options: RichTableOptions): this {
    this.#sections.push(...sectionsOf(table(options)));
    return this;
  }

  links(options: RichLinksOptions): this {
    this.#sections.push(...sectionsOf(links(options)));
    return this;
  }

  suggestions(options: RichSuggestionsOptions | readonly string[]): this {
    const value = Array.isArray(options) ? { suggestions: options } : options;
    this.#sections.push(...sectionsOf(suggestions(value as RichSuggestionsOptions)));
    return this;
  }

  tip(value: string | RichTipOptions): this {
    const options = typeof value === 'string' ? { text: value } : value;
    this.#sections.push(...sectionsOf(tip(options)));
    return this;
  }

  raw(section: unknown): this {
    if (section === undefined) throw new TypeError('experimental.RichResponseBuilder.raw: section é obrigatório');
    this.#sections.push(section);
    return this;
  }

  build(options: RichResponseBuildOptions = {}): ExperimentalContent {
    if (this.#sections.length === 0) {
      throw new TypeError('experimental.RichResponseBuilder: adicione ao menos uma seção');
    }
    return {
      __whanextExperimental: true,
      kind: 'rich-response',
      response: {
        unified: { sections: [...this.#sections] },
        ...(options.text ? { submessages: [options.text] } : {}),
        ...(options.botJid ? { botJid: options.botJid } : {}),
        ...(options.disclaimer !== undefined ? { disclaimer: options.disclaimer } : {}),
        ...(options.id !== undefined ? { id: options.id } : {}),
      },
    };
  }
}
