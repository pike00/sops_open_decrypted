const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { activeSopsPath, getInputType } = require('../util/paths');
const { parseCoverageRules, shouldKeyBeEncrypted } = require('../util/sopsMetadata');

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.showEncryptionCoverage', async () => {
            const sopsPath = activeSopsPath();
            if (!sopsPath) { vscode.window.showErrorMessage('No .sops file active'); return; }
            const inputType = getInputType(sopsPath);
            if (inputType !== 'dotenv' && inputType !== 'ini') {
                vscode.window.showInformationMessage('Coverage view supports .env / .ini files (got ' + inputType + ')');
                return;
            }
            let raw;
            try { raw = fs.readFileSync(sopsPath, 'utf8'); }
            catch (err) { vscode.window.showErrorMessage(`Cannot read file: ${err.message}`); return; }
            const rules = parseCoverageRules(raw);
            const items = [];
            for (const line of raw.split(/\r?\n/)) {
                if (!line || line.startsWith('#') || line.startsWith('sops_')) continue;
                const eq = line.indexOf('=');
                if (eq < 0) continue;
                const key = line.slice(0, eq);
                const val = line.slice(eq + 1);
                const encrypted = val.startsWith('ENC[');
                const shouldEncrypt = shouldKeyBeEncrypted(key, rules);
                let icon, status;
                if (encrypted && shouldEncrypt !== false) { icon = '$(lock)'; status = 'encrypted'; }
                else if (!encrypted && shouldEncrypt === false) { icon = '$(circle-outline)'; status = 'cleartext (by rule)'; }
                else if (!encrypted && shouldEncrypt !== false) { icon = '$(warning)'; status = 'CLEARTEXT — not encrypted'; }
                else { icon = '$(question)'; status = 'encrypted (rule says skip?)'; }
                items.push({
                    label: `${icon} ${key}`,
                    description: status,
                    detail: encrypted ? '' : val.length > 80 ? val.slice(0, 80) + '…' : val,
                });
            }
            if (items.length === 0) {
                vscode.window.showInformationMessage('No keys found');
                return;
            }
            const encCount = items.filter(i => i.description === 'encrypted').length;
            await vscode.window.showQuickPick(items, {
                title: `${path.basename(sopsPath)} — ${encCount}/${items.length} keys encrypted`,
                placeHolder: rules.summary || 'Encryption status per key',
            });
        })
    );
}

module.exports = { register };
