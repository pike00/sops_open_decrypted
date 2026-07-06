const path = require('path');
const Mocha = require('mocha');
const { glob } = require('glob');

// Mocha entry point invoked inside the VS Code extension host by runTest.js.
async function run() {
    const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });
    const testsRoot = __dirname;
    const files = await glob('**/*.test.js', { cwd: testsRoot });
    files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));
    return new Promise((resolve, reject) => {
        try {
            mocha.run(failures => failures > 0 ? reject(new Error(`${failures} test(s) failed`)) : resolve());
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = { run };
