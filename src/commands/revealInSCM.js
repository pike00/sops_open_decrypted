const vscode = require('vscode');
const { activeSopsPath } = require('../util/paths');

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.revealInSCM', async () => {
            const sopsPath = activeSopsPath();
            if (!sopsPath) { vscode.window.showErrorMessage('No .sops file active'); return; }
            try {
                await vscode.commands.executeCommand('git.openChange', vscode.Uri.file(sopsPath));
            } catch {
                await vscode.commands.executeCommand('workbench.view.scm');
            }
        })
    );
}

module.exports = { register };
