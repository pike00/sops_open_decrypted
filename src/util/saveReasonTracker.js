const vscode = require('vscode');
const { SCHEME } = require('../constants');

// VSCode's FileSystemProvider.writeFile doesn't receive the save reason, but
// onWillSaveTextDocument fires just before with the reason attached. Stash it
// per-URI so the provider can distinguish Manual saves from autosaves.
const reasons = new Map();

function register(context) {
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(event => {
            if (event.document.uri.scheme === SCHEME) {
                reasons.set(event.document.uri.toString(), event.reason);
            }
        })
    );
}

function consume(uri) {
    const key = uri.toString();
    const reason = reasons.get(key);
    reasons.delete(key);
    return reason;
}

module.exports = { register, consume };
