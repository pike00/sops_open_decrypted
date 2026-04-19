const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { SCHEME } = require('../constants');

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
            let dir = startDir();
            if (!dir) { vscode.window.showErrorMessage('No active file or workspace'); return; }
            while (true) {
                for (const name of ['.sops.yaml', '.sops.yml']) {
                    const candidate = path.join(dir, name);
                    if (fs.existsSync(candidate)) {
                        await vscode.window.showTextDocument(vscode.Uri.file(candidate), { preview: true });
                        return;
                    }
                }
                const parent = path.dirname(dir);
                if (parent === dir) break;
                dir = parent;
            }
            vscode.window.showWarningMessage('No .sops.yaml found walking up from ' + startDir());
        })
    );
}

module.exports = { register };
