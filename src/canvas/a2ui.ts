import { randomUUID } from 'node:crypto';

export const A2UI_BASIC_CATALOG =
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

export type A2UIVersion = 'v0.9';
export type A2UIValue<T> = T | { path: string } | A2UIFunctionCall;

export interface A2UIFunctionCall {
  call: string;
  args?: Readonly<Record<string, unknown>>;
}

export interface A2UIAction {
  name: string;
  context?: Readonly<Record<string, unknown>>;
}

export interface A2UITheme {
  primaryColor?: string;
  iconUrl?: string;
  agentDisplayName?: string;
}

export type A2UITextVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'body'
  | 'caption';

export type A2UIImageVariant =
  | 'icon'
  | 'avatar'
  | 'smallFeature'
  | 'mediumFeature'
  | 'largeFeature'
  | 'header';

export type A2UIFit = 'contain' | 'cover' | 'fill' | 'none' | 'scaleDown';
export type A2UIJustify =
  | 'start'
  | 'center'
  | 'end'
  | 'spaceBetween'
  | 'spaceAround'
  | 'spaceEvenly'
  | 'stretch';
export type A2UIAlign = 'start' | 'center' | 'end' | 'stretch';

export interface A2UIComponent {
  readonly id: string;
  readonly component: string;
  readonly [property: string]: unknown;
}

export interface A2UIWidget {
  readonly uuid: string;
  readonly data: string;
  readonly type: 'im_a2ui';
  readonly fallback: string;
}

export interface A2UICanvasOptions {
  catalogId?: string;
  version?: A2UIVersion;
  surfaceId?: string;
  theme?: A2UITheme;
  sendDataModel?: boolean;
}

interface ComponentOptions {
  id?: string;
}

interface LayoutOptions extends ComponentOptions {
  justify?: A2UIJustify;
  align?: A2UIAlign;
}

const MAX_COMPONENTS = 200;
const MAX_WIDGET_BYTES = 256 * 1024;

export class A2UICanvas {
  readonly #catalogId: string;
  readonly #version: A2UIVersion;
  readonly #surfaceId: string;
  readonly #theme: A2UITheme | undefined;
  readonly #sendDataModel: boolean;
  readonly #components = new Map<string, A2UIComponent>();
  readonly #references = new Map<string, readonly string[]>();
  #counter = 0;
  #rootChildren: readonly string[] = [];

  constructor(options: A2UICanvasOptions = {}) {
    this.#catalogId = options.catalogId ?? A2UI_BASIC_CATALOG;
    this.#version = options.version ?? 'v0.9';
    this.#surfaceId = options.surfaceId ?? `whanext-canvas=${randomUUID()}`;
    this.#theme = options.theme;
    this.#sendDataModel = options.sendDataModel ?? false;
  }

  text(
    text: A2UIValue<string>,
    options: ComponentOptions & { variant?: A2UITextVariant } = {},
  ): string {
    return this.#register('Text', {
      text,
      ...(options.variant ? { variant: options.variant } : {}),
    }, options.id);
  }

  image(
    url: A2UIValue<string>,
    options: ComponentOptions & {
      description?: A2UIValue<string>;
      fit?: A2UIFit;
      variant?: A2UIImageVariant;
    } = {},
  ): string {
    if (typeof url === 'string') assertRemoteUrl(url, 'image url');
    return this.#register('Image', {
      url,
      ...(options.description ? { description: options.description } : {}),
      ...(options.fit ? { fit: options.fit } : {}),
      ...(options.variant ? { variant: options.variant } : {}),
    }, options.id);
  }

  audio(
    url: A2UIValue<string>,
    options: ComponentOptions & { description?: A2UIValue<string> } = {},
  ): string {
    if (typeof url === 'string') assertRemoteUrl(url, 'audio url');
    return this.#register('AudioPlayer', {
      url,
      ...(options.description ? { description: options.description } : {}),
    }, options.id);
  }

  video(url: A2UIValue<string>, options: ComponentOptions = {}): string {
    if (typeof url === 'string') assertRemoteUrl(url, 'video url');
    return this.#register('Video', { url }, options.id);
  }

  button(
    child: string,
    action: A2UIAction,
    options: ComponentOptions & { variant?: 'default' | 'primary' | 'borderless' } = {},
  ): string {
    assertText(action.name, 'action name');
    return this.#register('Button', {
      child,
      action,
      ...(options.variant ? { variant: options.variant } : {}),
    }, options.id, [child]);
  }

  card(child: string, options: ComponentOptions = {}): string {
    return this.#register('Card', { child }, options.id, [child]);
  }

  row(children: readonly string[], options: LayoutOptions = {}): string {
    return this.#layout('Row', children, options);
  }

  column(children: readonly string[], options: LayoutOptions = {}): string {
    return this.#layout('Column', children, options);
  }

  list(
    children: readonly string[],
    options: ComponentOptions & {
      direction?: 'vertical' | 'horizontal';
      align?: A2UIAlign;
    } = {},
  ): string {
    assertChildren(children, 'list');
    return this.#register('List', {
      children: [...children],
      ...(options.direction ? { direction: options.direction } : {}),
      ...(options.align ? { align: options.align } : {}),
    }, options.id, children);
  }

  divider(
    options: ComponentOptions & { axis?: 'horizontal' | 'vertical' } = {},
  ): string {
    return this.#register('Divider', {
      ...(options.axis ? { axis: options.axis } : {}),
    }, options.id);
  }

  root(children: readonly string[]): this {
    assertChildren(children, 'root');
    this.#rootChildren = [...children];
    return this;
  }

  build(fallback: string, uuid = randomUUID()): A2UIWidget {
    assertText(fallback, 'canvas fallback');
    if (this.#rootChildren.length === 0) {
      throw new TypeError('Canvas root must contain at least one component.');
    }

    this.#validateReferences(this.#rootChildren);
    const components: A2UIComponent[] = [
      {
        id: 'root',
        component: 'Column',
        children: [...this.#rootChildren],
      },
      ...this.#components.values(),
    ];
    const payload = {
      version: this.#version,
      createSurface: {
        surfaceId: this.#surfaceId,
        catalogId: this.#catalogId,
        components,
        ...(this.#theme ? { theme: this.#theme } : {}),
        ...(this.#sendDataModel ? { sendDataModel: true } : {}),
      },
    };
    const data = JSON.stringify(payload);

    if (Buffer.byteLength(data, 'utf8') > MAX_WIDGET_BYTES) {
      throw new TypeError(`Canvas payload exceeds ${MAX_WIDGET_BYTES} bytes.`);
    }

    return { uuid, data, type: 'im_a2ui', fallback };
  }

  #layout(
    component: 'Row' | 'Column',
    children: readonly string[],
    options: LayoutOptions,
  ): string {
    assertChildren(children, component.toLowerCase());
    return this.#register(component, {
      children: [...children],
      ...(options.justify ? { justify: options.justify } : {}),
      ...(options.align ? { align: options.align } : {}),
    }, options.id, children);
  }

  #register(
    component: string,
    properties: Readonly<Record<string, unknown>>,
    requestedId?: string,
    references: readonly string[] = [],
  ): string {
    if (this.#components.size >= MAX_COMPONENTS) {
      throw new TypeError(`Canvas supports at most ${MAX_COMPONENTS} components.`);
    }

    const id = requestedId ?? `${component.toLowerCase()}_${(this.#counter++).toString(36)}`;
    assertText(id, 'component id');
    if (id === 'root' || this.#components.has(id)) {
      throw new TypeError(`Canvas component id "${id}" is already in use.`);
    }

    this.#components.set(id, { id, component, ...properties });
    this.#references.set(id, [...references]);
    return id;
  }

  #validateReferences(rootChildren: readonly string[]): void {
    for (const id of rootChildren) this.#assertReference(id, 'root');
    for (const [owner, references] of this.#references) {
      for (const id of references) this.#assertReference(id, owner);
    }
  }

  #assertReference(id: string, owner: string): void {
    if (!this.#components.has(id)) {
      throw new TypeError(`Canvas component "${owner}" references unknown id "${id}".`);
    }
  }
}

function assertChildren(children: readonly string[], field: string): void {
  if (children.length === 0) {
    throw new TypeError(`Canvas ${field} must contain at least one component.`);
  }
}

function assertText(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`Canvas ${field} cannot be empty.`);
}

function assertRemoteUrl(value: string, field: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Canvas ${field} must be a valid URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError(`Canvas ${field} must use HTTP or HTTPS.`);
  }
}
