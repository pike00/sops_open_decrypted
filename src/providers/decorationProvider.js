const vscode = require('vscode');
const path = require('path');
const { SCHEME } = require('../constants');

const decorationProvider = {
    onDidChangeFileDecorations: undefined,
    provideFileDecoration(uri) {
        if (uri.scheme !== SCHEME) return undefined;
        return {
            badge: '🔓',
            tooltip: `Decrypted locally from ${path.basename(uri.fsPath)}.sops`,
            color: new vscode.ThemeColor('charts.green'),
            propagate: false,
        };
    },
};

module.exports = { decorationProvider };
