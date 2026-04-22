const vscode = require('vscode');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getInputType } = require('../util/paths');
const { findInvalidDotenvLines } = require('../util/dotenv');
const { resolveConfig } = require('../util/config');
const logger = require('../util/logger');

function buildGlobalFlags(configPath) {
    return configPath ? ['--config', configPath] : [];
}

class SopsFileSystemProvider {
    constructor() {
        this._emitter = new vscode.EventEmitter();
        this.onDidChangeFile = this._emitter.event;
    }

    watch() { return new vscode.Disposable(() => {}); }

    stat(uri) {
        const sopsPath = uri.fsPath + '.sops';
        try {
            const s = fs.statSync(sopsPath);
            return { type: vscode.FileType.File, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    readDirectory() { return []; }
    createDirectory() { throw vscode.FileSystemError.NoPermissions(); }
    delete() { throw vscode.FileSystemError.NoPermissions(); }
    rename() { throw vscode.FileSystemError.NoPermissions(); }

    readFile(uri) {
        const sopsPath = uri.fsPath + '.sops';
        const inputType = getInputType(sopsPath);
        const { configPath, configPathError, binaryPath, env } = resolveConfig(uri);
        if (configPathError) {
            logger.getLogger().error(`decrypt aborted: ${configPathError}`);
            throw new Error(configPathError);
        }
        const cwd = path.dirname(sopsPath);
        const args = [
            ...buildGlobalFlags(configPath),
            'decrypt',
            '--input-type', inputType,
            '--output-type', inputType,
            sopsPath,
        ];
        logger.logOpStart('decrypt', { sopsPath, inputType, configPath, cwd, binaryPath, env });
        const t0 = Date.now();
        try {
            // cwd pinned to the .sops file's dir so any SOPS ancestor-walk (when
            // configPath is unset) and any relative path inside .sops.yaml resolve
            // deterministically, regardless of the extension host's CWD.
            const out = execFileSync(binaryPath, args, { cwd, env });
            logger.logOpResult('decrypt', { ok: true, ms: Date.now() - t0, bytes: out.length });
            return out;
        } catch (err) {
            const stderr = err.stderr?.toString() || err.message;
            logger.logOpResult('decrypt', { ok: false, ms: Date.now() - t0, stderr });
            throw new Error(`SOPS decrypt failed: ${stderr}`);
        }
    }

    writeFile(uri, content) {
        const sopsPath = uri.fsPath + '.sops';
        const inputType = getInputType(sopsPath);
        const dir = path.dirname(sopsPath);
        const { configPath, configPathError, binaryPath, env } = resolveConfig(uri);
        if (configPathError) {
            logger.getLogger().error(`encrypt aborted: ${configPathError}`);
            throw new Error(configPathError);
        }

        // Pre-validate dotenv before spawning sops so the error clearly names the bad line.
        // SOPS rejects any non-empty, non-comment line without '=' with a cryptic wrapper otherwise.
        if (inputType === 'dotenv') {
            const bad = findInvalidDotenvLines(content.toString('utf8'));
            if (bad.length) {
                const preview = bad.slice(0, 3).map(b => `line ${b.n}: ${JSON.stringify(b.text)}`).join(', ');
                const more = bad.length > 3 ? ` (+${bad.length - 3} more)` : '';
                const msg = `Invalid dotenv syntax — expected KEY=value at ${preview}${more}`;
                logger.getLogger().error(`encrypt aborted: ${msg}`);
                throw new Error(msg);
            }
        }

        const tmp = `/dev/shm/sops-${crypto.randomBytes(6).toString('hex')}`;
        logger.logOpStart('encrypt', { sopsPath, inputType, configPath, cwd: dir, binaryPath, env });
        const t0 = Date.now();
        try {
            fs.writeFileSync(tmp, content, { mode: 0o600 });
            // --filename-override makes SOPS match creation_rules against the real .sops path
            // instead of the random tmp path, and picks the right input-type fallback.
            const args = [
                ...buildGlobalFlags(configPath),
                'encrypt',
                '--filename-override', sopsPath,
                '--input-type', inputType,
                '--output-type', inputType,
                tmp,
            ];
            const encrypted = execFileSync(binaryPath, args, { cwd: dir, env });
            fs.writeFileSync(sopsPath, encrypted);
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
            logger.logOpResult('encrypt', { ok: true, ms: Date.now() - t0, bytes: encrypted.length });
            vscode.window.showInformationMessage(`SOPS: saved & re-encrypted ${path.basename(sopsPath)}`);
        } catch (err) {
            const stderr = err.stderr?.toString() || err.message;
            logger.logOpResult('encrypt', { ok: false, ms: Date.now() - t0, stderr });
            throw new Error(`SOPS encrypt failed: ${stderr}`);
        } finally {
            try { execFileSync('shred', ['-u', tmp]); } catch { try { fs.unlinkSync(tmp); } catch {} }
        }
    }
}

module.exports = { SopsFileSystemProvider };
