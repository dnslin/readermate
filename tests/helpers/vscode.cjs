const Module = require('node:module');

function installVscodeMock(options = {}) {
  const configuration = new Map(Object.entries(options.configuration || {}));
  const globalState = new Map(Object.entries(options.globalState || {}));
  const commands = new Map();
  const messages = [];
  class Disposable {
    constructor(callback = () => {}) { this.callback = callback; }
    dispose() { this.callback(); }
    static from(...items) { return new Disposable(() => items.forEach(item => item.dispose())); }
  }
  class EventEmitter {
    constructor() {
      this.listeners = new Set();
      this.event = (listener, thisArg, disposables) => {
        const bound = thisArg ? listener.bind(thisArg) : listener;
        this.listeners.add(bound);
        const disposable = new Disposable(() => this.listeners.delete(bound));
        disposables?.push(disposable);
        return disposable;
      };
    }
    fire(value) { for (const listener of this.listeners) listener(value); }
    dispose() { this.listeners.clear(); }
  }
  class Uri {
    constructor(value) { this.value = value; this.fsPath = value; }
    toString() { return this.value; }
    static parse(value) { return new Uri(value); }
    static file(value) { return new Uri(value); }
    static joinPath(base, ...segments) { return new Uri([base.toString(), ...segments].join('/')); }
  }
  class Range {
    constructor(startLine, startCharacter, endLine, endCharacter) {
      this.start = { line: startLine, character: startCharacter };
      this.end = { line: endLine, character: endCharacter };
    }
  }
  class Selection extends Range { constructor(...args) { super(...args); this.active = this.end; this.anchor = this.start; } }
  class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }
  class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } }
  class ThemeColor { constructor(id) { this.id = id; } }
  const events = {};
  const event = name => (events[name] ||= new EventEmitter()).event;
  function createWebview() {
    const received = new EventEmitter();
    let html = '';
    return {
      messages: [], options: {}, cspSource: 'test:',
      get html() { return html; }, set html(value) { html = value; this.messages.length = 0; },
      postMessage(message) { this.messages.push(message); return Promise.resolve(true); },
      asWebviewUri: value => value,
      onDidReceiveMessage: received.event,
      receive: value => received.fire(value),
    };
  }
  function createPanel() {
    const disposed = new EventEmitter();
    let isDisposed = false;
    return {
      webview: createWebview(), title: '', active: true,
      reveal() {}, onDidDispose: disposed.event, onDidChangeViewState: event('panelState'),
      dispose() { if (!isDisposed) { isDisposed = true; disposed.fire(); } },
    };
  }
  function createEditor() {
    return {
      document: { fileName: 'test.ts', languageId: 'typescript', lineCount: 20, lineAt: () => ({ text: 'const value = 1;' }) },
      selection: new Selection(1, 0, 1, 0), visibleRanges: [new Range(0, 0, 19, 0)],
      decorations: [], setDecorations(_type, value) { this.decorations = value; }, revealRange() {}, viewColumn: 1,
    };
  }
  const outputChannel = () => ({ appendLine() {}, show() {}, dispose() {}, clear() {} });
  const vscode = {
    Disposable, EventEmitter, Uri, Range, Selection, TreeItem, ThemeIcon, ThemeColor,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ViewColumn: { One: 1 }, ConfigurationTarget: { Global: 1 },
    DecorationRangeBehavior: { ClosedClosed: 0 }, TextEditorRevealType: { AtTop: 0, InCenterIfOutsideViewport: 1 },
    window: {
      activeTextEditor: options.editor, visibleTextEditors: [],
      createOutputChannel: outputChannel,
      createTextEditorDecorationType: () => new Disposable(),
      createWebviewPanel: createPanel,
      registerWebviewViewProvider: () => new Disposable(), registerWebviewPanelSerializer: () => new Disposable(),
      createTreeView: () => ({ dispose() {}, reveal: async () => {} }),
      registerTreeDataProvider: () => new Disposable(),
      showQuickPick: async items => options.pick ? options.pick(items) : undefined,
      showInputBox: async () => undefined,
      showInformationMessage: async message => { messages.push(message); },
      showWarningMessage: async message => { messages.push(message); },
      showErrorMessage: async message => { messages.push(message); },
      setStatusBarMessage: () => new Disposable(),
      onDidChangeActiveTextEditor: event('editor'), onDidChangeTextEditorSelection: event('selection'),
      onDidChangeWindowState: event('window'), onDidChangeTextEditorVisibleRanges: event('ranges'),
    },
    workspace: {
      getConfiguration: section => ({
        get(key, fallback) { return configuration.has(key) ? configuration.get(key) : configuration.has(`${section}.${key}`) ? configuration.get(`${section}.${key}`) : fallback; },
        async update(key, value) { configuration.set(`${section}.${key}`, value); events.configuration?.fire({ affectsConfiguration: name => name === section || name === `${section}.${key}` }); },
      }),
      onDidChangeTextDocument: event('document'), onDidChangeConfiguration: event('configuration'),
    },
    commands: {
      registerCommand(name, handler) { commands.set(name, handler); return new Disposable(() => commands.delete(name)); },
      async executeCommand(name, ...args) { return commands.get(name)?.(...args); },
    },
    env: { openExternal: async () => true, clipboard: { writeText: async () => {} } },
  };
  const context = {
    extensionUri: Uri.file('/extension'), subscriptions: [],
    globalState: { get: (key, fallback) => globalState.has(key) ? globalState.get(key) : fallback, update: async (key, value) => { globalState.set(key, value); } },
  };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) { return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain); };
  return { vscode, commands, messages, configuration, globalState, context, createWebview, createPanel, createEditor, events, restore() { Module._load = originalLoad; } };
}

module.exports = { installVscodeMock };
