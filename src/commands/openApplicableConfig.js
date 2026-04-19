const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { activeSopsPath } = require('../util/paths');

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.openApplicableConfig', async () => {
            const sopsPath = activeSopsPath();
            if (!sopsPath) { vscode.window.showErrorMessage('No .sops file active'); return; }
            let dir = path.dirname(sopsPath);
            while (true) {
                for (const name of ['.sops.yaml', '.sops.yml']) {
                    const candidate = path.join(dir, name);
                    if (fs.existsSync(candidate)) {
                        await vscode.window.showTextDocument(vscode.Uri.file(candidate));
                        return;
                    }
                }
                const parent = path.dirname(dir);
                if (parent === dir) break;
                dir = parent;
            }
            vscode.window.showWarningMessage('No .sops.yaml found walking up from ' + path.dirname(sopsPath));
        })
    );
}

module.exports = { register };
