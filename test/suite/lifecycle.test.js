const assert = require('assert');
const vscode = require('vscode');

const SCHEME = 'sops-decrypted';
const MISSING = vscode.Uri.from({ scheme: SCHEME, path: '/nonexistent/definitely-not-here.env' });

// These exercise the lifecycle paths that the pure-node unit suite can't reach:
// command registration, and the missing-backing-file behavior that produced the
// recurring "Unable to resolve nonexistent file" modal. They need only the
// extension host — no sops binary or age key — because every assertion is on a
// path that returns before sops is ever spawned.
suite('sops-open-decrypted lifecycle', () => {
    suiteSetup(async () => {
        const ext = vscode.extensions.getExtension('pike00.sops-open-decrypted');
        assert.ok(ext, 'extension not found by id');
        if (!ext.isActive) await ext.activate();
    });

    test('registers expected commands', async () => {
        const cmds = await vscode.commands.getCommands(true);
        for (const id of ['sops.openDecrypted', 'sops.newEncryptedFile', 'sops.saveDecrypted', 'sops.showRecipients']) {
            assert.ok(cmds.includes(id), `missing command ${id}`);
        }
    });

    test('stat of a missing backing file rejects with FileNotFound', async () => {
        await assert.rejects(
            () => Promise.resolve(vscode.workspace.fs.stat(MISSING)),
            (err) => err instanceof vscode.FileSystemError && err.code === 'FileNotFound',
        );
    });

    test('readFile of a missing backing file rejects', async () => {
        await assert.rejects(() => Promise.resolve(vscode.workspace.fs.readFile(MISSING)));
    });

    test('openDecrypted on a non-.sops uri returns without throwing', async () => {
        // Shows an error message and returns; must not throw into the caller.
        await vscode.commands.executeCommand('sops.openDecrypted', vscode.Uri.file('/tmp/not-a-sops-file.txt'));
    });
});
