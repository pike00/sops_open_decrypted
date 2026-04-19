const vscode = require('vscode');
const path = require('path');
const { SCHEME } = require('../constants');

function getInputType(sopsFilePath) {
    const base = sopsFilePath.replace(/\.sops$/, '');
    const basename = path.basename(base).toLowerCase();
    // path.extname returns '' for dotfiles like `.env` / `.envrc`, so match by basename first.
    if (basename === '.env' || basename.endsWith('.env')) return 'dotenv';
    if (basename === '.envrc' || basename.endsWith('.envrc')) return 'dotenv';
    const ext = path.extname(base).toLowerCase();
    return { '.yaml': 'yaml', '.yml': 'yaml', '.json': 'json', '.ini': 'ini' }[ext] ?? 'yaml';
}

// URI convention: sops-decrypted:///abs/path/to/file.env
//   real file on disk: /abs/path/to/file.env.sops
function toVirtualUri(realFsPath) {
    const stripped = realFsPath.replace(/\.sops$/, '');
    return vscode.Uri.from({ scheme: SCHEME, path: stripped });
}

// Resolve the underlying .sops file path from the active editor,
// whether it's the virtual decrypted view or the raw encrypted file.
function activeSopsPath() {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) return null;
    if (uri.scheme === SCHEME) return uri.fsPath + '.sops';
    if (uri.fsPath.endsWith('.sops')) return uri.fsPath;
    return null;
}

module.exports = { getInputType, toVirtualUri, activeSopsPath };
