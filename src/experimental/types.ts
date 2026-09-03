export interface ExperimentalBaseOptions {
  /** Texto auxiliar exibido como submensagem do rich response. */
  text?: string;
  /** JID do bot usado no envelope AI encaminhado. */
  botJid?: string;
  /** Texto de aviso opcional do bot. */
  disclaimer?: string;
  /** ID estável opcional; quando omitido o provider gera um UUID. */
  id?: string;
}

export interface RichHtmlOptions extends ExperimentalBaseOptions {
  html: string;
  title?: string;
  trustedSources?: readonly string[];
}

export interface RichMarkdownOptions extends ExperimentalBaseOptions {
  markdown: string;
}

export interface RichCodeBlockOptions extends ExperimentalBaseOptions {
  code: string;
  language?: string;
  before?: string;
  after?: string;
}

export interface RichTableOptions extends ExperimentalBaseOptions {
  title?: string;
  text?: string;
  footer?: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface RichLinkItem {
  url: string;
  label?: string;
  subtitle?: string;
}

export interface RichLinksOptions extends ExperimentalBaseOptions {
  markdown: string;
  links: readonly (string | RichLinkItem)[];
  showSources?: boolean;
}

export interface RichSuggestionsOptions extends ExperimentalBaseOptions {
  suggestions: readonly string[];
  layout?: 'single' | 'scroll' | 'row';
}

export interface UnifiedResponseOptions extends ExperimentalBaseOptions {
  data: unknown;
}

export interface ExperimentalEnvelope {
  readonly __whanextExperimental: true;
  readonly kind: 'rich-response';
  readonly response: {
    readonly unified: unknown;
    readonly submessages?: readonly string[];
    readonly botJid?: string;
    readonly disclaimer?: string;
    readonly id?: string;
  };
}

export type ExperimentalContent = ExperimentalEnvelope;

export interface RichTipOptions extends ExperimentalBaseOptions {
  text: string;
}

export interface RichResponseBuildOptions extends ExperimentalBaseOptions {}
