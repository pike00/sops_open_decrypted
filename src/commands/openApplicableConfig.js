const vscode = require('vscode');
const path = require('path');
const { activeSopsPath } = require('../util/paths');
const { findSopsYaml } = require('../util/findSopsYaml');

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.openApplicableConfig', async () => {
            const sopsPath = activeSopsPath();
            if (!sopsPath) { vscode.window.showErrorMessage('No .sops file active'); return; }
            const found = findSopsYaml(path.dirname(sopsPath));
            if (found) {
                await vscode.window.showTextDocument(vscode.Uri.file(found));
                return;
            }
            vscode.window.showWarningMessage('No .sops.yaml found walking up from ' + path.dirname(sopsPath));
        })
    );
}

module.exports = { register };
