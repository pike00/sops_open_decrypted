const vscode = require('vscode');
const fs = require('fs');
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
        // Dispose the provider itself so its internal onDidChangeConfiguration
        // listener and EventEmitter are released on deactivate.
        provider,
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

    // VS Code persists swapped-in `sops-decrypted://` text-editor tabs (and,
    // mid-race, `sops.decryptedEditor` custom tabs) and restores them on reload.
    // For a secrets extension that re-runs `sops decrypt` on restore this is
    // undesirable — it silently re-materializes plaintext the user didn't ask to
    // reopen, and a missing backing file additionally renders a broken erroring
    // tab. Close every restored decrypted tab once at startup, regardless of
    // whether the backing `.sops` still exists; dirty tabs are left alone so we
    // never discard unsaved edits.
    closeDecryptedTabs();

    // Closing tabs covers restored views, but an *unsaved* decrypted buffer is
    // a different leak: VS Code hot-exit can write its cleartext contents to
    // backup storage on disk. There's no API to opt a scheme out of that, so
    // surface the trade-off once and offer the one real mitigation.
    maybeWarnHotExit(context);
}

async function maybeWarnHotExit(context) {
    try {
        if (!vscode.workspace.getConfiguration('sops').get('warnOnHotExit', true)) return;
        if (vscode.workspace.getConfiguration('files').get('hotExit', 'onExit') === 'off') return;
        const STATE_KEY = 'sops.hotExitWarningAcknowledged';
        if (context.globalState.get(STATE_KEY)) return;

        const SET_OFF = 'Set files.hotExit: off';
        const DISMISS = "Don't show again";
        const choice = await vscode.window.showWarningMessage(
            'SOPS: VS Code hot-exit can persist unsaved editor contents — including decrypted secrets — to backup storage as cleartext. ' +
            'Set files.hotExit to "off" (you will be prompted to save on exit instead), or avoid leaving decrypted files unsaved.',
            SET_OFF,
            DISMISS,
        );
        if (choice === SET_OFF) {
            await vscode.workspace.getConfiguration('files').update('hotExit', 'off', vscode.ConfigurationTarget.Global);
            await context.globalState.update(STATE_KEY, true);
            vscode.window.showInformationMessage('SOPS: files.hotExit set to "off".');
        } else if (choice === DISMISS) {
            await context.globalState.update(STATE_KEY, true);
        }
        // Escape/dismiss without a choice: leave unacknowledged so it reminds once more.
    } catch (err) {
        logger.warn('activate', 'hot-exit warning failed', { error: err.message });
    }
}

// Identify a tab backed by our decrypted view, returning the `.sops` path it
// depends on (for logging) or null if the tab is not one of ours. Custom-editor
// tabs open the `.sops` file directly; text-editor tabs use the virtual scheme
// whose fsPath drops the `.sops` suffix.
function decryptedTabSopsPath(input) {
    if (input instanceof vscode.TabInputText && input.uri.scheme === SCHEME) {
        return input.uri.fsPath + '.sops';
    }
    if (input instanceof vscode.TabInputCustom && input.viewType === 'sops.decryptedEditor') {
        return input.uri.fsPath;
    }
    return null;
}

function closeDecryptedTabs() {
    try {
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const sopsPath = decryptedTabSopsPath(tab.input);
                if (!sopsPath) continue;
                if (tab.isDirty) {
                    logger.info('activate', 'keeping dirty decrypted tab (unsaved edits)', { sopsPath });
                    continue;
                }
                logger.info('activate', 'closing restored decrypted tab', {
                    sopsPath, exists: fs.existsSync(sopsPath),
                });
                vscode.window.tabGroups.close(tab).then(undefined, () => {});
            }
        }
    } catch (err) {
        logger.warn('activate', 'decrypted-tab sweep failed', { error: err.message });
    }
}

function deactivate() {}

module.exports = { activate, deactivate };
