const vscode = require('vscode');
const { toVirtualUri } = require('../util/paths');
const logger = require('../util/logger');

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.openDecrypted', async (uri) => {
            const realUri = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (!realUri) { vscode.window.showErrorMessage('No file selected'); return; }
            if (!realUri.fsPath.endsWith('.sops')) { vscode.window.showErrorMessage('Not a .sops file'); return; }
            try {
                await vscode.window.showTextDocument(toVirtualUri(realUri.fsPath), { preview: false });
            } catch (err) {
                logger.error('cmd.openDecrypted', 'showTextDocument failed', {
                    sopsPath: realUri.fsPath, message: err.message,
                });
                const choice = await vscode.window.showErrorMessage(
                    `SOPS: ${err.message}`,
                    'Show Log',
                    'Show Recipients',
                    'Show Effective Configuration',
                );
                if (choice === 'Show Log') vscode.commands.executeCommand('sops.showLog');
                else if (choice === 'Show Recipients') vscode.commands.executeCommand('sops.showRecipients');
                else if (choice === 'Show Effective Configuration') vscode.commands.executeCommand('sops.showEffectiveConfig');
            }
        })
    );
}

module.exports = { register };
