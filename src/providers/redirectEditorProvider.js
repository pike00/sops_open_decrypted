const vscode = require('vscode');
const { toVirtualUri } = require('../util/paths');

// Custom editor that redirects to the virtual sops-decrypted:// URI.
// Registered as the default editor for *.sops files, so double-click, "Open With...",
// and programmatic opens all flow through here.
const redirectEditorProvider = {
    openCustomDocument(uri) {
        return { uri, dispose: () => {} };
    },
    resolveCustomEditor(document, webviewPanel) {
        webviewPanel.webview.html = `
            <html><body style="font-family:sans-serif;padding:2em;color:#888;text-align:center">
                <h2 style="font-weight:300">Showing decrypted view...</h2>
            </body></html>`;
        const viewColumn = webviewPanel.viewColumn ?? vscode.ViewColumn.Active;
        const virtualUri = toVirtualUri(document.uri.fsPath);

        // Show the placeholder for ~500ms before swapping to the real editor
        setTimeout(async () => {
            try {
                await vscode.window.showTextDocument(virtualUri, { preview: false, viewColumn });

                // Close the custom-editor tab for this .sops file
                const customTab = vscode.window.tabGroups.all
                    .flatMap(g => g.tabs)
                    .find(t =>
                        t.input instanceof vscode.TabInputCustom &&
                        t.input.viewType === 'sops.decryptedEditor' &&
                        t.input.uri.toString() === document.uri.toString()
                    );
                if (customTab) await vscode.window.tabGroups.close(customTab);
            } catch (err) {
                vscode.window.showErrorMessage(`SOPS: ${err.message}`);
            }
        }, 500);
    },
};

module.exports = { redirectEditorProvider };
