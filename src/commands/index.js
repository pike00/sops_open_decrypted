const openDecrypted = require('./openDecrypted');
const newEncryptedFile = require('./newEncryptedFile');
const editorActions = require('./editorActions');
const openApplicableConfig = require('./openApplicableConfig');
const revealInSCM = require('./revealInSCM');
const showRecipients = require('./showRecipients');
const showEncryptionCoverage = require('./showEncryptionCoverage');
const showSopsYaml = require('./showSopsYaml');
const showEffectiveConfig = require('./showEffectiveConfig');
const showLog = require('./showLog');

function registerAll(context) {
    openDecrypted.register(context);
    newEncryptedFile.register(context);
    editorActions.register(context);
    openApplicableConfig.register(context);
    revealInSCM.register(context);
    showRecipients.register(context);
    showEncryptionCoverage.register(context);
    showSopsYaml.register(context);
    showEffectiveConfig.register(context);
    showLog.register(context);
}

module.exports = { registerAll };
