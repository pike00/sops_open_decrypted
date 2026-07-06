const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { resolveConfig } = require('../util/config');
const { checkBinaryAsync } = require('../util/preflight');
const { toVirtualUri } = require('../util/paths');
const { normalize: normalizeErr } = require('../util/sopsErrors');
const logger = require('../util/logger');

const execFileAsync = promisify(execFile);
const MAX_SOPS_BUFFER = 50 * 1024 * 1024;

// Store type -> filename extension + a single seed entry. The seed gives sops a
// non-empty tree to encrypt (an empty file makes some stores error); the user
// replaces it once the file opens decrypted.
const STORE_TYPES = [
    { label: 'dotenv (.env)',  type: 'dotenv', ext: 'env',  defaultName: '.env',         seed: 'PLACEHOLDER=changeme\n' },
    { label: 'YAML',           type: 'yaml',   ext: 'yaml', defaultName: 'secrets.yaml', seed: 'placeholder: changeme\n' },
    { label: 'JSON',           type: 'json',   ext: 'json', defaultName: 'secrets.json', seed: '{\n  "placeholder": "changeme"\n}\n' },
    { label: 'INI',            type: 'ini',    ext: 'ini',  defaultName: 'secrets.ini',  seed: '[default]\nplaceholder = changeme\n' },
    { label: 'Binary / text',  type: 'binary', ext: 'bin',  defaultName: 'secret.txt',   seed: 'changeme\n' },
];

// Plaintext staging mirrors the provider's encrypt path: tmpfs on Linux so the
// seed never hits disk, shredded in finally. Kept self-contained here rather
// than reaching into the provider's private encrypt internals.
function pickTmpDir() {
    if (process.platform === 'linux') {
        try { fs.accessSync('/dev/shm', fs.constants.W_OK); return '/dev/shm'; } catch {}
    }
    return os.tmpdir();
}

function shredAndUnlink(p) {
    try {
        const st = fs.statSync(p);
        const fd = fs.openSync(p, 'r+');
        try { fs.writeSync(fd, Buffer.alloc(st.size, 0), 0, st.size, 0); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
    } catch (e) { if (e.code !== 'ENOENT') logger.warn('newfile', 'seed shred failed', { error: e.message }); }
    try { fs.unlinkSync(p); } catch (e) {
        if (e.code !== 'ENOENT') logger.warn('newfile', 'seed unlink failed', { error: e.message });
    }
}

// Where to create the file: an Explorer-selected folder, else the active file's
// directory, else the first workspace folder, else home.
function defaultDir(arg) {
    if (arg?.fsPath) {
        try {
            const st = fs.statSync(arg.fsPath);
            return st.isDirectory() ? arg.fsPath : path.dirname(arg.fsPath);
        } catch {}
    }
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active?.scheme === 'file') return path.dirname(active.fsPath);
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
}

function register(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sops.newEncryptedFile', async (arg) => {
            const choice = await vscode.window.showQuickPick(
                STORE_TYPES.map(s => ({ label: s.label, store: s })),
                {
                    title: 'New SOPS file: store type',
                    placeHolder: 'Recipients come from the governing .sops.yaml creation_rules',
                }
            );
            if (!choice) return;
            const store = choice.store;
            const dir = defaultDir(arg);

            const name = await vscode.window.showInputBox({
                title: 'New SOPS file: name',
                prompt: `Created in ${dir}. The .sops suffix is added automatically.`,
                value: store.defaultName,
                validateInput: (v) => {
                    const t = (v || '').trim();
                    if (!t) return 'Enter a file name.';
                    if (t.includes('/') || t.includes(path.sep)) return 'Enter a name only — no path separators.';
                    return null;
                },
            });
            if (name === undefined) return;

            const base = name.trim().replace(/\.sops$/i, '');
            const sopsPath = path.join(dir, base + '.sops');
            const fileUri = vscode.Uri.file(sopsPath);

            if (fs.existsSync(sopsPath)) {
                vscode.window.showErrorMessage(`SOPS: ${base}.sops already exists — open it instead.`);
                return;
            }

            const { configPath, configPathError, binaryPath, env } = resolveConfig(fileUri);
            if (configPathError) { vscode.window.showErrorMessage(`SOPS: ${configPathError}`); return; }
            const bin = await checkBinaryAsync(binaryPath, env);
            if (!bin.ok) { vscode.window.showErrorMessage(`SOPS: ${bin.reason}`); return; }

            const tmpPath = path.join(pickTmpDir(), `sops-new-${crypto.randomBytes(8).toString('hex')}.${store.ext}`);
            const globalFlags = configPath ? ['--config', configPath] : [];
            const args = [
                ...globalFlags, 'encrypt',
                '--filename-override', sopsPath,
                '--input-type', store.type, '--output-type', store.type,
                tmpPath,
            ];
            try {
                const fd = fs.openSync(tmpPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
                try { fs.writeSync(fd, Buffer.from(store.seed)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
                logger.logOpStart('encrypt(new)', { sopsPath, inputType: store.type, configPath, cwd: dir, binaryPath, env });
                const t0 = Date.now();
                const { stdout: encrypted } = await execFileAsync(binaryPath, args, {
                    cwd: dir, env, timeout: 30000, maxBuffer: MAX_SOPS_BUFFER,
                });
                // New file — no existing bytes to corrupt, so a direct write is safe.
                fs.writeFileSync(sopsPath, encrypted, { mode: 0o644 });
                logger.logOpResult('encrypt(new)', { ok: true, ms: Date.now() - t0, bytes: Buffer.byteLength(encrypted) });
            } catch (err) {
                const stderr = err.stderr?.toString() || err.message;
                logger.logOpResult('encrypt(new)', { ok: false, stderr });
                vscode.window.showErrorMessage(`SOPS: could not create encrypted file — ${normalizeErr(stderr)}`);
                return;
            } finally {
                shredAndUnlink(tmpPath);
            }

            try {
                await vscode.window.showTextDocument(toVirtualUri(sopsPath), { preview: false });
            } catch (err) {
                vscode.window.showWarningMessage(`SOPS: created ${base}.sops but could not open it: ${err.message}`);
            }
        })
    );
}

module.exports = { register };
