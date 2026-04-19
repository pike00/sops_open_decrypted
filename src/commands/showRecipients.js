const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { activeSopsPath } = require('../util/paths');
const { parseRecipients } = require('../util/sopsMetadata');

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.showRecipients', async () => {
            const sopsPath = activeSopsPath();
            if (!sopsPath) { vscode.window.showErrorMessage('No .sops file active'); return; }
            let raw;
            try { raw = fs.readFileSync(sopsPath, 'utf8'); }
            catch (err) { vscode.window.showErrorMessage(`Cannot read file: ${err.message}`); return; }
            const recipients = parseRecipients(raw);
            const items = [
                ...recipients.age.map(r => ({ label: '$(key) age', description: r })),
                ...recipients.kms.map(r => ({ label: '$(cloud) KMS', description: r })),
                ...recipients.pgp.map(r => ({ label: '$(shield) PGP', description: r })),
            ];
            if (items.length === 0) {
                vscode.window.showInformationMessage('No recipients found in ' + path.basename(sopsPath));
                return;
            }
            const pick = await vscode.window.showQuickPick(items, {
                title: `${path.basename(sopsPath)} — ${items.length} recipient${items.length === 1 ? '' : 's'}`,
                placeHolder: 'Enter to copy to clipboard',
            });
            if (pick?.description) {
                await vscode.env.clipboard.writeText(pick.description);
                vscode.window.setStatusBarMessage('Recipient copied to clipboard', 3000);
            }
        })
    );
}

module.exports = { register };
