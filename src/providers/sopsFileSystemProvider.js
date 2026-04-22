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
        logger.trace('fs', 'readFile enter', { uri: uri.toString(), fsPath: uri.fsPath, sopsPath, inputType });
        const { configPath, configPathError, binaryPath, env, envFile, envFileError, inlineEnv } = resolveConfig(uri);
        logger.trace('config', 'resolved for readFile', {
            configPath: configPath ?? null,
            configPathError,
            envFile: envFile ?? null,
            envFileError,
            inlineEnvKeys: Object.keys(inlineEnv || {}),
            binaryPath,
        });
        if (configPathError) {
            logger.error('fs', 'decrypt aborted (configPathError)', { configPathError });
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
        logger.trace('fs', 'spawn decrypt', { binaryPath, args, cwd });
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
        const bufLen = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content));
        logger.trace('fs', 'writeFile enter', {
            uri: uri.toString(), fsPath: uri.fsPath, sopsPath, inputType, bytes: bufLen,
        });
        const { configPath, configPathError, binaryPath, env, envFile, envFileError, inlineEnv } = resolveConfig(uri);
        logger.trace('config', 'resolved for writeFile', {
            configPath: configPath ?? null,
            configPathError,
            envFile: envFile ?? null,
            envFileError,
            inlineEnvKeys: Object.keys(inlineEnv || {}),
            binaryPath,
        });
        if (configPathError) {
            logger.error('fs', 'encrypt aborted (configPathError)', { configPathError });
            throw new Error(configPathError);
        }

        // Pre-validate dotenv before spawning sops so the error clearly names the bad line.
        // SOPS rejects any non-empty, non-comment line without '=' with a cryptic wrapper otherwise.
        if (inputType === 'dotenv') {
            const text = content.toString('utf8');
            const lineCount = text.split(/\r?\n/).length;
            const bad = findInvalidDotenvLines(text);
            logger.trace('validate', 'dotenv checked', { lineCount, badCount: bad.length });
            if (bad.length) {
                const preview = bad.slice(0, 3).map(b => `line ${b.n}: ${JSON.stringify(b.text)}`).join(', ');
                const more = bad.length > 3 ? ` (+${bad.length - 3} more)` : '';
                const msg = `Invalid dotenv syntax — expected KEY=value at ${preview}${more}`;
                // Log every offending line number (not value — callers may have partial typed secrets),
                // plus the safe text of the first few where we already showed it to the user.
                logger.error('validate', 'dotenv rejected', {
                    badLines: bad.map(b => b.n),
                    previewLines: bad.slice(0, 3).map(b => ({ n: b.n, text: b.text })),
                });
                throw new Error(msg);
            }
        }

        const tmp = `/dev/shm/sops-${crypto.randomBytes(6).toString('hex')}`;
        logger.trace('fs', 'encrypt prep', { tmp, cwd: dir });
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
            logger.trace('fs', 'spawn encrypt', { binaryPath, args, cwd: dir });
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
            try { execFileSync('shred', ['-u', tmp]); logger.trace('fs', 'tmp shredded', { tmp }); }
            catch (e1) {
                try { fs.unlinkSync(tmp); logger.trace('fs', 'tmp unlinked (shred unavailable)', { tmp, shredError: e1.message }); }
                catch (e2) { logger.warn('fs', 'tmp cleanup failed', { tmp, shredError: e1.message, unlinkError: e2.message }); }
            }
        }
    }
}

module.exports = { SopsFileSystemProvider };
