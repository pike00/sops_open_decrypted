const vscode = require('vscode');
const fs = require('fs');
const logger = require('../util/logger');

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.showLog', () => logger.show()),
        vscode.commands.registerCommand('sops.showLogFile', async () => {
            const p = logger.getLogFilePath();
            logger.info('command', 'showLogFile invoked', { path: p });
            if (!fs.existsSync(p)) {
                vscode.window.showWarningMessage(
                    `SOPS trace log not yet created at ${p}. It is written on the first decrypt/encrypt.`
                );
                return;
            }
            try {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
                await vscode.window.showTextDocument(doc, { preview: false });
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open ${p}: ${err.message}`);
            }
        })
    );
}

module.exports = { register };
