const vscode = require('vscode');
const logger = require('../util/logger');

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.showLog', () => logger.show())
    );
}

module.exports = { register };
