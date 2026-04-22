const vscode = require('vscode');

const SOPS_ENV_RE = /^(SOPS_|AWS_|AZURE_|GCP_|GOOGLE_|VAULT_)/;

let channel = null;

// Lazily create the shared LogOutputChannel. `{ log: true }` gives timestamped
// output and a log-level dropdown in the Output panel.
function getLogger() {
    if (!channel) {
        channel = vscode.window.createOutputChannel('SOPS', { log: true });
    }
    return channel;
}

function sopsEnvNames(env) {
    return Object.keys(env || {}).filter(k => SOPS_ENV_RE.test(k)).sort();
}

function logOpStart(op, details) {
    const { sopsPath, inputType, configPath, cwd, binaryPath, env } = details;
    const names = sopsEnvNames(env);
    getLogger().info(
        `${op} ${sopsPath} ` +
        `inputType=${inputType} ` +
        `configPath=${configPath ?? '(unset; ancestor-walk from cwd)'} ` +
        `cwd=${cwd} ` +
        `binary=${binaryPath} ` +
        `sopsEnvNames=${names.length ? names.join(',') : '(none)'}`
    );
}

function logOpResult(op, { ok, ms, bytes, stderr }) {
    const log = getLogger();
    if (ok) {
        log.info(`${op} ok (${ms}ms, ${bytes} bytes)`);
    } else {
        const firstLine = (stderr || '').split(/\r?\n/).find(l => l.trim()) || '(no stderr)';
        log.error(`${op} failed (${ms}ms): ${firstLine}`);
    }
}

function show() {
    getLogger().show(true);
}

module.exports = { getLogger, logOpStart, logOpResult, show };
