const vscode = require('vscode');
const { toVirtualUri } = require('../util/paths');

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.openDecrypted', async (uri) => {
            const realUri = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (!realUri) { vscode.window.showErrorMessage('No file selected'); return; }
            if (!realUri.fsPath.endsWith('.sops')) { vscode.window.showErrorMessage('Not a .sops file'); return; }
            try {
                await vscode.window.showTextDocument(toVirtualUri(realUri.fsPath), { preview: false });
            } catch (err) {
                vscode.window.showErrorMessage(`SOPS: ${err.message}`);
            }
        })
    );
}

module.exports = { register };
