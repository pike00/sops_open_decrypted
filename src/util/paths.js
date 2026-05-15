const vscode = require('vscode');
const { SCHEME } = require('../constants');
const { detectStoreType, detectByExtension } = require('./storeDetection');

// Backward-compatible API: returns just the type string.
// Internally consults content sniffing (storeDetection.detectStoreType)
// with a filename-based fallback when the file is missing or carries no
// SOPS markers. Callers that need the source/confidence metadata should
// call getInputTypeDetailed.
function getInputType(sopsFilePath) {
    return detectStoreType(sopsFilePath).type;
}

function getInputTypeDetailed(sopsFilePath) {
    return detectStoreType(sopsFilePath);
}

function getInputTypeByExtension(sopsFilePath) {
    return detectByExtension(sopsFilePath);
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

module.exports = {
    getInputType,
    getInputTypeDetailed,
    getInputTypeByExtension,
    toVirtualUri,
    activeSopsPath,
};
