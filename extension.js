const vscode = require('vscode');
const path = require('path');
const { SCHEME } = require('./src/constants');
const { SopsFileSystemProvider } = require('./src/providers/sopsFileSystemProvider');
const { redirectEditorProvider } = require('./src/providers/redirectEditorProvider');
const { decorationProvider } = require('./src/providers/decorationProvider');
const { registerAll: registerCommands } = require('./src/commands');
const saveReason = require('./src/util/saveReasonTracker');
const logger = require('./src/util/logger');

function activate(context) {
    // Eagerly create the SOPS log channel so it appears in the Output dropdown
    // on activation and its disposal is tied to the extension lifecycle.
    context.subscriptions.push(logger.getLogger());
    try {
        const pkg = require('./package.json');
        logger.info('activate', 'extension activated', {
            version: pkg.version,
            logFile: logger.getLogFilePath(),
            vscodeVersion: vscode.version,
            appHost: vscode.env.appHost,
            remoteName: vscode.env.remoteName ?? '(local)',
        });
    } catch (err) {
        logger.warn('activate', 'activation logging error', { error: err.message });
    }
    const provider = new SopsFileSystemProvider();

    const langStatus = vscode.languages.createLanguageStatusItem('sops.decrypted', { scheme: SCHEME });
    langStatus.name = 'SOPS Decrypted';
    langStatus.text = '$(unlock) decrypted locally';
    langStatus.severity = vscode.LanguageStatusSeverity.Information;

    const updateLangStatus = (editor) => {
        if (editor && editor.document.uri.scheme === SCHEME) {
            langStatus.detail = `${path.basename(editor.document.uri.fsPath)}.sops — in-memory, saves re-encrypt`;
        }
    };
    updateLangStatus(vscode.window.activeTextEditor);

    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(SCHEME, provider, {
            isCaseSensitive: true,
            isReadonly: false,
        }),
        vscode.window.registerCustomEditorProvider('sops.decryptedEditor', redirectEditorProvider, {
            webviewOptions: { retainContextWhenHidden: false },
            supportsMultipleEditorsPerDocument: false,
        }),
        vscode.window.registerFileDecorationProvider(decorationProvider),
        langStatus,
        vscode.window.onDidChangeActiveTextEditor(updateLangStatus),
    );

    registerCommands(context);
    saveReason.register(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
