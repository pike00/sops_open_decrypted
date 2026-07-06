const path = require('path');
const { runTests } = require('@vscode/test-electron');

// Downloads a throwaway VS Code, launches it with this extension loaded, and
// runs the mocha suite in test/suite/. Requires a display (or xvfb) and network
// access for the one-time VS Code download — it cannot run in a headless CI
// sandbox without xvfb. Run locally with: npm install && npm run test:integration
async function main() {
    try {
        // When this script is run from VS Code's integrated terminal, the
        // extension host exports ELECTRON_RUN_AS_NODE=1. The downloaded VS Code
        // would inherit it and boot as plain Node (rejecting --no-sandbox et al.
        // with "bad option"), so strip it before launching the test instance.
        delete process.env.ELECTRON_RUN_AS_NODE;

        const extensionDevelopmentPath = path.resolve(__dirname, '..');
        const extensionTestsPath = path.resolve(__dirname, './suite/index.js');
        await runTests({ extensionDevelopmentPath, extensionTestsPath });
    } catch (err) {
        console.error('Integration tests failed:', err);
        process.exit(1);
    }
}

main();
