const vscode = require('vscode');
const path = require('path');
const { SCHEME } = require('../constants');
const { findSopsYaml } = require('../util/findSopsYaml');

function startDir() {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri) {
        const fsPath = uri.scheme === SCHEME ? uri.fsPath + '.sops' : uri.fsPath;
        return path.dirname(fsPath);
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.showSopsYaml', async () => {
            const dir = startDir();
            if (!dir) { vscode.window.showErrorMessage('No active file or workspace'); return; }
            const found = findSopsYaml(dir);
            if (found) {
                await vscode.window.showTextDocument(vscode.Uri.file(found), { preview: true });
                return;
            }
            vscode.window.showWarningMessage('No .sops.yaml found walking up from ' + startDir());
        })
    );
}

module.exports = { register };
