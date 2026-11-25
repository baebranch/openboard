/**
 * Minimal in-memory stand-in for the `vscode` module, just enough to run src/host/extension.ts
 * (activate, custom editor provider, external-change watcher, commands, LM tools) under vitest.
 * Usage: `vi.mock('vscode', async () => (await import('../helpers/fake-vscode')).vscodeModule)`.
 */
import { vi } from 'vitest';

// ---- events / disposables -------------------------------------------------------------------
export class Disposable {
  constructor(private fn: () => void = () => {}) {}
  static from(...ds: { dispose(): unknown }[]): Disposable {
    return new Disposable(() => ds.forEach((d) => d.dispose()));
  }
  dispose(): void {
    const f = this.fn;
    this.fn = () => {};
    f();
  }
}

export class EventEmitter<T> {
  private listeners = new Set<(e: T) => unknown>();
  event = (l: (e: T) => unknown): Disposable => {
    this.listeners.add(l);
    return new Disposable(() => this.listeners.delete(l));
  };
  fire(e: T): void {
    for (const l of [...this.listeners]) l(e);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

// ---- Uri --------------------------------------------------------------------------------------
export class Uri {
  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query: string,
    readonly fragment: string,
  ) {}
  static file(p: string): Uri {
    let path = p.replace(/\\/g, '/');
    if (!path.startsWith('/')) path = '/' + path;
    return new Uri('file', '', path, '', '');
  }
  static parse(value: string): Uri {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
    if (!m) throw new Error(`Invalid URI: ${value}`);
    const scheme = m[1] ?? '';
    let path = m[3] ?? '';
    if (scheme === 'file' && !path.startsWith('/')) path = '/' + path;
    return new Uri(scheme, m[2] ?? '', path, m[4] ?? '', m[5] ?? '');
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    const path = [base.path.replace(/\/$/, ''), ...parts].join('/');
    return base.with({ path });
  }
  get fsPath(): string {
    return /^\/[a-zA-Z]:/.test(this.path) ? this.path.slice(1) : this.path;
  }
  with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }
  toString(): string {
    const auth = this.scheme === 'file' || this.authority ? `//${this.authority}` : '';
    return `${this.scheme}:${auth}${this.path}${this.query ? `?${this.query}` : ''}${this.fragment ? `#${this.fragment}` : ''}`;
  }
}

export class RelativePattern {
  readonly base: string;
  constructor(base: Uri | { uri: Uri }, readonly pattern: string) {
    this.base = (base instanceof Uri ? base : base.uri).toString().replace(/\/$/, '');
  }
}

export class MarkdownString {
  constructor(readonly value: string = '') {}
}

export class TabInputCustom {
  constructor(
    readonly uri: Uri,
    readonly viewType: string,
  ) {}
}

export class LanguageModelTextPart {
  constructor(readonly value: string) {}
}
export class LanguageModelToolResult {
  constructor(readonly content: unknown[]) {}
}

// ---- harness state ----------------------------------------------------------------------------
export interface FakePanel {
  uri: Uri;
  webview: {
    options: unknown;
    html: string;
    cspSource: string;
    asWebviewUri(u: Uri): Uri;
    postMessage(m: unknown): Promise<boolean>;
    onDidReceiveMessage: EventEmitter<unknown>['event'];
  };
  active: boolean;
  visible: boolean;
  /** Messages posted by the host to the webview. */
  posted: unknown[];
  /** Simulates a message coming from the webview. */
  receive(message: unknown): void;
  onDidChangeViewState: EventEmitter<{ webviewPanel: FakePanel }>['event'];
  onDidDispose: EventEmitter<void>['event'];
  dispose(): void;
}

interface Tab {
  input: unknown;
}

type Watcher = { pattern: RelativePattern; change: EventEmitter<Uri>; create: EventEmitter<Uri> };

class Harness {
  files = new Map<string, Uint8Array>();
  /** Ordered fs mutation log: `write <uri>`, `rename <from> -> <to>`, `delete <uri>`. */
  fsLog: string[] = [];
  watchers = new Set<Watcher>();
  panels: FakePanel[] = [];
  textEditorsOpened: { uri: Uri; text: string }[] = [];
  tabs: Tab[] = [];
  commandHandlers = new Map<string, (...a: unknown[]) => unknown>();
  customEditors = new Map<string, { provider: any; options: unknown }>();
  contentProviders = new Map<string, unknown>();
  /** Custom documents by `uri|viewType`, for the fake `workbench.action.files.save`. */
  customDocs = new Map<string, unknown>();
  /** Number of times the IDE save command ran. */
  ideSaves = 0;
  registeredTools = new Map<string, unknown>();
  outbound: string[] = [];
  trusted = true;
  hasLm = true;
  workspaceRoot = Uri.file('/ws');
  config: Record<string, unknown> = {};
  showInformationMessage = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
  showWarningMessage = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
  showErrorMessage = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
  showInputBox = vi.fn(async (..._a: unknown[]): Promise<string | undefined> => undefined);
  showSaveDialog = vi.fn(async (..._a: unknown[]): Promise<Uri | undefined> => undefined);
  clipboardText = '';
  /** Registered MCP server definition providers by id (only when `hasMcpApi`). */
  mcpProviders = new Map<string, any>();
  hasMcpApi = true;
  foldersEmitter = new EventEmitter<unknown>();
  trustEmitter = new EventEmitter<void>();
  configEmitter = new EventEmitter<{ affectsConfiguration(s: string): boolean }>();

  reset(): void {
    this.files.clear();
    this.fsLog = [];
    this.watchers.clear();
    this.panels = [];
    this.textEditorsOpened = [];
    this.tabs = [];
    this.commandHandlers.clear();
    this.customEditors.clear();
    this.contentProviders.clear();
    this.customDocs.clear();
    this.ideSaves = 0;
    this.registeredTools.clear();
    this.mcpProviders.clear();
    this.hasMcpApi = true;
    this.clipboardText = '';
    this.outbound = [];
    this.trusted = true;
    this.hasLm = true;
    this.config = {};
    for (const f of [this.showInformationMessage, this.showWarningMessage, this.showErrorMessage, this.showInputBox, this.showSaveDialog]) {
      f.mockReset();
      f.mockResolvedValue(undefined);
    }
  }

  /** Writes a file straight to the in-memory disk (external change; no fs log entry). */
  putFile(uri: Uri, text: string | Uint8Array): void {
    this.files.set(uri.toString(), typeof text === 'string' ? new TextEncoder().encode(text) : text);
  }
  readText(uri: Uri): string | undefined {
    const b = this.files.get(uri.toString());
    return b ? new TextDecoder().decode(b) : undefined;
  }
  /** Fires the file-system watchers that cover `uri`. */
  fireFileChange(uri: Uri): void {
    const s = uri.toString();
    for (const w of this.watchers) if (`${w.pattern.base}/${w.pattern.pattern}` === s) w.change.fire(uri);
  }
  /** Runs registered command `id`. */
  run(id: string, ...args: unknown[]): Promise<unknown> {
    return Promise.resolve(vscodeModule.commands.executeCommand(id, ...args));
  }
}

export const harness = new Harness();

function missing(uri: Uri): Error {
  return new Error(`FileNotFound: ${uri.toString()}`);
}

const fs = {
  async stat(uri: Uri) {
    const b = harness.files.get(uri.toString());
    if (!b) throw missing(uri);
    return { type: 1, ctime: 0, mtime: 0, size: b.byteLength };
  },
  async readFile(uri: Uri) {
    const b = harness.files.get(uri.toString());
    if (!b) throw missing(uri);
    return b.slice();
  },
  async writeFile(uri: Uri, bytes: Uint8Array) {
    harness.fsLog.push(`write ${uri.toString()}`);
    harness.files.set(uri.toString(), bytes.slice());
  },
  async rename(from: Uri, to: Uri, o?: { overwrite?: boolean }) {
    const b = harness.files.get(from.toString());
    if (!b) throw missing(from);
    if (!o?.overwrite && harness.files.has(to.toString())) throw new Error('FileExists');
    harness.fsLog.push(`rename ${from.toString()} -> ${to.toString()}`);
    harness.files.set(to.toString(), b);
    harness.files.delete(from.toString());
  },
  async delete(uri: Uri) {
    harness.fsLog.push(`delete ${uri.toString()}`);
    if (!harness.files.delete(uri.toString())) throw missing(uri);
  },
};

function makePanel(uri: Uri): FakePanel {
  const rx = new EventEmitter<unknown>();
  const view = new EventEmitter<{ webviewPanel: FakePanel }>();
  const dispose = new EventEmitter<void>();
  const posted: unknown[] = [];
  const panel: FakePanel = {
    uri,
    webview: {
      options: undefined,
      html: '',
      cspSource: 'fake-csp',
      asWebviewUri: (u) => u,
      postMessage: async (m) => (posted.push(m), true),
      onDidReceiveMessage: rx.event,
    },
    active: true,
    visible: true,
    posted,
    receive: (m) => rx.fire(m),
    onDidChangeViewState: view.event,
    onDidDispose: dispose.event,
    dispose: () => dispose.fire(),
  };
  return panel;
}

async function openWith(uri: Uri, viewType: string): Promise<void> {
  if (viewType === 'default') {
    harness.textEditorsOpened.push({ uri, text: harness.readText(uri) ?? '' });
    return;
  }
  const reg = harness.customEditors.get(viewType);
  if (!reg) throw new Error(`No custom editor ${viewType}`);
  const token = { isCancellationRequested: false, onCancellationRequested: () => new Disposable() };
  const doc = await reg.provider.openCustomDocument(uri, { backupId: undefined, untitledDocumentData: undefined }, token);
  const panel = makePanel(uri);
  harness.panels.push(panel);
  harness.tabs.push({ input: new TabInputCustom(uri, viewType) });
  harness.customDocs.set(`${uri.toString()}|${viewType}`, doc);
  await reg.provider.resolveCustomEditor(doc, panel, token);
}

const commands = {
  registerCommand(id: string, fn: (...a: unknown[]) => unknown): Disposable {
    harness.commandHandlers.set(id, fn);
    return new Disposable(() => harness.commandHandlers.delete(id));
  },
  async executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    if (id === 'vscode.openWith') return openWith(args[0] as Uri, args[1] as string);
    if (id === 'workbench.action.files.save' && !harness.commandHandlers.has(id)) {
      // Like the IDE: saves the active editor; a custom editor goes through its provider's save.
      harness.ideSaves += 1;
      const input = harness.tabs[harness.tabs.length - 1]?.input;
      if (input instanceof TabInputCustom) {
        const reg = harness.customEditors.get(input.viewType);
        const doc = harness.customDocs.get(`${input.uri.toString()}|${input.viewType}`);
        const token = { isCancellationRequested: false, onCancellationRequested: () => new Disposable() };
        if (reg && doc) await reg.provider.saveCustomDocument(doc, token);
      }
      return undefined;
    }
    const h = harness.commandHandlers.get(id);
    if (!h) throw new Error(`command '${id}' not found`);
    return h(...args);
  },
};

const lmApi = {
  registerTool(name: string, tool: unknown): Disposable {
    harness.registeredTools.set(name, tool);
    return new Disposable(() => harness.registeredTools.delete(name));
  },
};

/** Mirrors vscode.McpStdioServerDefinition (1.101+). */
export class McpStdioServerDefinition {
  constructor(
    readonly label: string,
    readonly command: string,
    readonly args: string[] = [],
    readonly env: Record<string, string | number | null> = {},
    readonly version?: string,
  ) {}
}

export const vscodeModule = {
  Disposable,
  EventEmitter,
  Uri,
  RelativePattern,
  MarkdownString,
  TabInputCustom,
  LanguageModelTextPart,
  LanguageModelToolResult,
  // Absent on 1.90 typings; declared so the strict vitest mock proxy does not throw on access.
  LanguageModelDataPart: undefined,
  l10n: { t: (s: string) => s },
  get McpStdioServerDefinition() {
    return harness.hasMcpApi ? McpStdioServerDefinition : undefined;
  },
  env: {
    appName: 'Fake IDE',
    clipboard: {
      writeText: async (t: string) => {
        harness.clipboardText = t;
      },
    },
  },
  // `lm` is looked up on every access so tests can toggle its presence.
  get lm() {
    if (!harness.hasLm) return undefined;
    return harness.hasMcpApi
      ? {
          ...lmApi,
          registerMcpServerDefinitionProvider(id: string, provider: unknown): Disposable {
            harness.mcpProviders.set(id, provider);
            return new Disposable(() => harness.mcpProviders.delete(id));
          },
        }
      : lmApi;
  },
  commands,
  workspace: {
    fs,
    get isTrusted() {
      return harness.trusted;
    },
    get workspaceFolders() {
      return [{ uri: harness.workspaceRoot, name: 'ws', index: 0 }];
    },
    name: 'ws',
    onDidChangeWorkspaceFolders: (l: (e: unknown) => unknown) => harness.foldersEmitter.event(l),
    getConfiguration: (_section?: string) => ({ get: (key: string) => harness.config[key] }),
    onDidChangeConfiguration: (l: (e: { affectsConfiguration(s: string): boolean }) => unknown) => harness.configEmitter.event(l),
    onDidGrantWorkspaceTrust: (l: () => unknown) => harness.trustEmitter.event(l),
    registerTextDocumentContentProvider(scheme: string, p: unknown): Disposable {
      harness.contentProviders.set(scheme, p);
      return new Disposable(() => harness.contentProviders.delete(scheme));
    },
    createFileSystemWatcher(pattern: RelativePattern) {
      const w: Watcher = { pattern, change: new EventEmitter<Uri>(), create: new EventEmitter<Uri>() };
      harness.watchers.add(w);
      return {
        onDidChange: w.change.event,
        onDidCreate: w.create.event,
        onDidDelete: new EventEmitter<Uri>().event,
        dispose: () => harness.watchers.delete(w),
      };
    },
  },
  window: {
    createOutputChannel: (_n: string) => ({ appendLine: (_m: string) => {}, dispose: () => {} }),
    registerCustomEditorProvider(viewType: string, provider: unknown, options: unknown): Disposable {
      harness.customEditors.set(viewType, { provider, options });
      return new Disposable(() => harness.customEditors.delete(viewType));
    },
    showInformationMessage: (...a: unknown[]) => harness.showInformationMessage(...a),
    showWarningMessage: (...a: unknown[]) => harness.showWarningMessage(...a),
    showErrorMessage: (...a: unknown[]) => harness.showErrorMessage(...a),
    showInputBox: (...a: unknown[]) => harness.showInputBox(...a),
    showSaveDialog: (...a: unknown[]) => harness.showSaveDialog(...a),
    tabGroups: {
      get all() {
        return [{ tabs: harness.tabs }];
      },
      get activeTabGroup() {
        return { activeTab: harness.tabs[harness.tabs.length - 1], tabs: harness.tabs };
      },
      async close(tabs: Tab[]) {
        harness.tabs = harness.tabs.filter((t) => !tabs.includes(t));
        return true;
      },
    },
  },
};
