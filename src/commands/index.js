const openDecrypted = require('./openDecrypted');
const editorActions = require('./editorActions');
const openApplicableConfig = require('./openApplicableConfig');
const revealInSCM = require('./revealInSCM');
const showRecipients = require('./showRecipients');
const showEncryptionCoverage = require('./showEncryptionCoverage');
const showSopsYaml = require('./showSopsYaml');

function registerAll(context) {
    openDecrypted.register(context);
    editorActions.register(context);
    openApplicableConfig.register(context);
    revealInSCM.register(context);
    showRecipients.register(context);
    showEncryptionCoverage.register(context);
    showSopsYaml.register(context);
}

module.exports = { registerAll };
