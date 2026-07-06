const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { toVirtualUri } = require('../util/paths');
const logger = require('../util/logger');

// Custom editor that redirects to the virtual sops-decrypted:// URI.
// Registered as the default editor for *.sops files, so double-click,
// "Open With…", and programmatic opens all flow through here.
const redirectEditorProvider = {
    openCustomDocument(uri) {
        return { uri, dispose: () => {} };
    },
    resolveCustomEditor(document, webviewPanel) {
        webviewPanel.webview.html = `
            <html><body style="font-family:sans-serif;padding:2em;color:#888;text-align:center">
                <h2 style="font-weight:300">Showing decrypted view…</h2>
                <p style="font-size:0.9em">If this hangs, run <code>SOPS: Show Log</code> from the command palette.</p>
            </body></html>`;
        const viewColumn = webviewPanel.viewColumn ?? vscode.ViewColumn.Active;
        const sopsPath = document.uri.fsPath;
        const virtualUri = toVirtualUri(sopsPath);

        const findCustomTab = () => vscode.window.tabGroups.all
            .flatMap(g => g.tabs)
            .find(t =>
                t.input instanceof vscode.TabInputCustom &&
                t.input.viewType === 'sops.decryptedEditor' &&
                t.input.uri.toString() === document.uri.toString()
            );

        // If the user dismisses the loading placeholder within the 500ms window,
        // skip the deferred swap so we don't pop a decrypted editor open — or
        // fire a redundant error — after they've already closed the tab.
        let disposed = false;
        webviewPanel.onDidDispose(() => { disposed = true; });

        // A tab restored on window reload — or opened a moment before the file
        // is created — can point at a .sops file that no longer exists on disk.
        // Decryption is impossible and every diagnostic action below (recipients,
        // config, trace) is irrelevant, so close the placeholder and say so
        // plainly instead of surfacing the full decrypt-failure modal.
        if (!fs.existsSync(sopsPath)) {
            webviewPanel.webview.html =
                `<html><body style="font-family:sans-serif;padding:2em;color:#888;text-align:center">` +
                `<h2 style="font-weight:300">Encrypted file not found</h2></body></html>`;
            logger.warn('redirect', 'backing .sops file missing; closing stale tab', { sopsPath });
            setTimeout(async () => {
                try { const t = findCustomTab(); if (t) await vscode.window.tabGroups.close(t); } catch {}
                vscode.window.showWarningMessage(
                    `SOPS: ${path.basename(sopsPath)} does not exist — the encrypted file may have been moved or deleted.`
                );
            }, 0);
            return;
        }

        // Swap to the real editor on the next tick. The work is deferred (not
        // awaited) so resolveCustomEditor returns promptly, but with no artificial
        // delay — the old fixed ~500ms placeholder added that latency to every
        // open. The placeholder webview above covers the brief decrypt window.
        setTimeout(async () => {
            if (disposed) return;
            try {
                await vscode.window.showTextDocument(virtualUri, { preview: false, viewColumn });
                const customTab = findCustomTab();
                if (customTab) await vscode.window.tabGroups.close(customTab);
            } catch (err) {
                // Close the stale webview placeholder even on failure.
                try { const t = findCustomTab(); if (t) await vscode.window.tabGroups.close(t); } catch {}
                logger.error('redirect', 'showTextDocument failed', {
                    sopsPath,
                    message: err.message,
                });
                const choice = await vscode.window.showErrorMessage(
                    `SOPS: ${err.message}`,
                    'Show Log',
                    'Show Trace File',
                    'Show Recipients',
                    'Show Effective Configuration',
                );
                if (choice === 'Show Log') vscode.commands.executeCommand('sops.showLog');
                else if (choice === 'Show Trace File') vscode.commands.executeCommand('sops.showLogFile');
                else if (choice === 'Show Recipients') vscode.commands.executeCommand('sops.showRecipients');
                else if (choice === 'Show Effective Configuration') vscode.commands.executeCommand('sops.showEffectiveConfig');
            }
        }, 0);
    },
};

module.exports = { redirectEditorProvider };
