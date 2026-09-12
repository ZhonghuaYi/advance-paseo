// Typecheck-only ambient DOM surface for the web wallpaper enhancement.
// Paseo plugins compile without the DOM library, so declare exactly what
// client/wallpaper/engine.ts and client/web.ts touch. Every runtime entry
// point guards on `typeof document === "undefined"` (or Blob/URL/atob/File
// presence), which keeps native hosts on the no-op path. This file ships no
// runtime code; the Paseo bundler never reaches it.

interface AdvanceCssStyleDeclaration {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
}

interface AdvanceDomRect {
  readonly width: number;
  readonly height: number;
  readonly left: number;
}

interface AdvanceMutationObserverInit {
  attributes?: boolean;
  childList?: boolean;
  subtree?: boolean;
  attributeFilter?: string[];
}

interface Element {
  id: string;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  remove(): void;
  prepend(node: Element): void;
  append(node: Element): void;
  closest<T extends Element = Element>(selector: string): T | null;
  matches(selector: string): boolean;
  querySelector<T extends Element = Element>(selector: string): T | null;
  querySelectorAll<T extends Element = Element>(selector: string): T[];
  getBoundingClientRect(): AdvanceDomRect;
  readonly parentElement: HTMLElement | null;
  readonly children: HTMLElement[];
}

interface HTMLElement extends Element {
  dataset: Record<string, string>;
  readonly style: AdvanceCssStyleDeclaration;
}

interface HTMLDivElement extends HTMLElement {}

interface KeyboardEvent {
  readonly key: string;
}

interface MutationRecord {
  readonly type: string;
  readonly target: Element;
  readonly addedNodes: readonly unknown[];
  readonly removedNodes: readonly unknown[];
}

interface MutationObserver {
  observe(target: Element, options?: AdvanceMutationObserverInit): void;
  disconnect(): void;
}

declare var HTMLElement: {
  prototype: HTMLElement;
  new (): HTMLElement;
};

declare var MutationObserver: {
  prototype: MutationObserver;
  new (callback: (records: MutationRecord[], observer: MutationObserver) => void): MutationObserver;
};

// --- File picker and canvas re-encoding surface (client/web.ts only) ---

interface AdvanceFile {
  readonly name: string;
  readonly size: number;
}

interface AdvanceFileList {
  readonly length: number;
  readonly [index: number]: AdvanceFile;
}

interface AdvanceInputElement extends HTMLElement {
  type: string;
  accept: string;
  readonly files: AdvanceFileList | null;
  click(): void;
  onchange: ((event: { readonly target: AdvanceInputElement | null }) => void) | null;
}

interface AdvanceImageElement extends HTMLElement {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

interface AdvanceCanvasContext {
  drawImage(
    image: AdvanceImageElement,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

interface AdvanceCanvasElement extends HTMLElement {
  width: number;
  height: number;
  getContext(contextId: "2d"): AdvanceCanvasContext | null;
  toDataURL(type?: string, quality?: number): string;
}

interface AdvanceFileReader {
  readAsDataURL(file: AdvanceFile): void;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readonly result: string | null;
}

declare var Image: {
  prototype: AdvanceImageElement;
  new (): AdvanceImageElement;
};

declare var FileReader: {
  prototype: AdvanceFileReader;
  new (): AdvanceFileReader;
};

interface AdvanceEventLike {
  readonly target: { readonly result: string | null } | null;
}

declare const document: {
  getElementById(id: string): HTMLElement | null;
  querySelector(selector: string): HTMLElement | null;
  readonly documentElement: HTMLElement;
  readonly head: Element;
  readonly body: Element;
  createElement(tagName: "div"): HTMLDivElement;
  createElement(tagName: "input"): AdvanceInputElement;
  createElement(tagName: "img"): AdvanceImageElement;
  createElement(tagName: "canvas"): AdvanceCanvasElement;
  createElement(tagName: string): HTMLElement;
  addEventListener(
    type: string,
    listener: (event: KeyboardEvent) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: KeyboardEvent) => void,
    capture?: boolean,
  ): void;
};

/** Read-only computed-style fields the settings-card fingerprint and the
 * transitional-surface rescue read. */
interface AdvanceComputedStyle {
  readonly backgroundColor: string;
  readonly borderRadius: string;
  readonly borderTopWidth: string;
  readonly position: string;
  readonly zIndex: string;
}

declare const window: {
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(id: number): void;
  readonly innerWidth: number;
  readonly innerHeight: number;
  getComputedStyle(element: Element): AdvanceComputedStyle;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

declare const URL: {
  createObjectURL(blob: object): string;
  revokeObjectURL(url: string): void;
};

declare const Blob: {
  new (parts: Uint8Array[], options?: { type?: string }): object;
};

declare function atob(data: string): string;

// --- App-settings persistence surface (theme switcher only) ---

declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

// --- Locale detection surface (client/web.ts only) ---

declare const navigator: {
  readonly language: string | undefined;
};
