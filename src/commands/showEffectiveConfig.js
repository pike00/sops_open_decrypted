const vscode = require('vscode');
const fs = require('fs');
const { resolveConfig } = require('../util/config');
const { activeSopsPath } = require('../util/paths');

const SECRET_PATTERN = /key|token|secret|password|credential|private/i;

function maskValue(key, value) {
    if (value === undefined || value === null || value === '') return '(empty)';
    const str = String(value);
    if (SECRET_PATTERN.test(key)) {
        if (str.length <= 8) return '***';
        return `${str.slice(0, 3)}…${str.slice(-3)} (${str.length} chars)`;
    }
    return str;
}

function register(context) {
    const channel = vscode.window.createOutputChannel('SOPS Effective Config');
    context.subscriptions.push(channel);

    context.subscriptions.push(
        vscode.commands.registerCommand('sops.showEffectiveConfig', () => {
            const sopsPath = activeSopsPath();
            const uri = vscode.window.activeTextEditor?.document.uri;
            if (!sopsPath || !uri) {
                vscode.window.showErrorMessage('No .sops file active — open an encrypted file or its decrypted view first.');
                return;
            }
            const cfg = resolveConfig(uri);

            channel.clear();
            channel.appendLine(`File:         ${sopsPath}`);
            channel.appendLine(`Binary:       ${cfg.binaryPath}`);
            channel.appendLine('');
            channel.appendLine(`Config path:  ${cfg.configPath || '(unset — SOPS walks up from file dir)'}`);
            if (cfg.configPath) {
                channel.appendLine(`  exists:     ${fs.existsSync(cfg.configPath)}`);
            }
            channel.appendLine(`Env file:     ${cfg.envFile || '(unset)'}`);
            if (cfg.envFile) {
                const exists = fs.existsSync(cfg.envFile);
                channel.appendLine(`  exists:     ${exists}`);
                if (cfg.envFileError) {
                    channel.appendLine(`  error:      ${cfg.envFileError}`);
                }
            }
            channel.appendLine('');
            channel.appendLine('Inline sops.env (workspace settings, masked):');
            const inlineKeys = Object.keys(cfg.inlineEnv);
            if (inlineKeys.length === 0) {
                channel.appendLine('  (none)');
            } else {
                for (const k of inlineKeys) {
                    channel.appendLine(`  ${k} = ${maskValue(k, cfg.inlineEnv[k])}`);
                }
            }
            channel.appendLine('');
            channel.appendLine('SOPS-relevant merged env (masked):');
            const relevant = Object.keys(cfg.env)
                .filter(k => /^(SOPS_|AWS_|AZURE_|GCP_|GOOGLE_|VAULT_)/.test(k))
                .sort();
            if (relevant.length === 0) {
                channel.appendLine('  (no SOPS_* / AWS_* / GCP_* / VAULT_* vars set)');
            } else {
                for (const k of relevant) {
                    channel.appendLine(`  ${k} = ${maskValue(k, cfg.env[k])}`);
                }
            }
            channel.show(true);
        })
    );
}

module.exports = { register };
