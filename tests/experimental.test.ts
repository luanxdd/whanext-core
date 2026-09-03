import { describe, expect, it } from 'vitest';
import {
  RichResponseBuilder,
  codeBlock,
  decodeUnifiedResponse,
  encodeUnifiedResponse,
  links,
  markdown,
  richHtml,
  suggestions,
  table,
  unifiedResponse,
} from '@whanext/core/experimental';

describe('experimental', () => {
  it('cria richHtml isolado', () => {
    const content = richHtml({ title: 'Teste', html: '<b>ok</b>', trustedSources: [] });
    expect(content.__whanextExperimental).toBe(true);
    expect(content.response.unified).toBeTruthy();
  });

  it('cria os principais primitives', () => {
    expect(markdown({ markdown: '**ok**' }).kind).toBe('rich-response');
    expect(codeBlock({ code: 'const ok = true', language: 'ts' }).kind).toBe('rich-response');
    expect(table({ headers: ['a'], rows: [['b']] }).kind).toBe('rich-response');
    expect(links({ markdown: '[site](IE_0)', links: ['https://example.com'] }).kind).toBe('rich-response');
    expect(suggestions({ suggestions: ['Ajuda'] }).kind).toBe('rich-response');
    expect(unifiedResponse({ data: { sections: [] } }).kind).toBe('rich-response');
  });

  it('compõe rich responses com builder', () => {
    const content = new RichResponseBuilder().markdown('**ok**').tip('teste').suggestions(['Ajuda']).build();
    expect(content.kind).toBe('rich-response');
  });

  it('codifica e decodifica unified response', () => {
    const input = { response_id: 'x', sections: [] };
    expect(decodeUnifiedResponse(encodeUnifiedResponse(input))).toEqual(input);
  });
});
