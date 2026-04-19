const vscode = require('vscode');
const { SCHEME } = require('../constants');

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.saveDecrypted', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.uri.scheme !== SCHEME) return;
            const saved = await editor.document.save();
            if (saved) {
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            }
        }),

        vscode.commands.registerCommand('sops.discardDecrypted',
            () => vscode.commands.executeCommand('workbench.action.files.revert')),

        vscode.commands.registerCommand('sops.revealSource', () => {
            const uri = vscode.window.activeTextEditor?.document.uri;
            if (!uri || uri.scheme !== SCHEME) return;
            return vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(uri.fsPath + '.sops'));
        }),
    );
}

module.exports = { register };
