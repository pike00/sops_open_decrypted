const vscode = require('vscode');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { detectStoreType, detectByExtension } = require('../util/storeDetection');
const { findInvalidDotenvLines } = require('../util/dotenv');
const { resolveConfig } = require('../util/config');
const { checkBinaryAsync, checkFileReadable } = require('../util/preflight');
const { normalize: normalizeErr } = require('../util/sopsErrors');
const saveReason = require('../util/saveReasonTracker');
const logger = require('../util/logger');

const execFileAsync = promisify(execFile);

// 50 MB ceiling on sops stdout/stderr — prevents OOM on pathological inputs.
const MAX_SOPS_BUFFER = 50 * 1024 * 1024;

function buildGlobalFlags(configPath) {
    return configPath ? ['--config', configPath] : [];
}

// Errors that smell like SOPS choking on the wrong --input-type. When the
// primary detection wasn't high-confidence, these trigger a one-shot retry
// with the other plausible types before we give up.
const FORMAT_FALLBACK_RE =
    /cannot parse|could not load input|invalid yaml|invalid json|not a valid|cannot unmarshal|unknown input type|invalid input type/i;

const ALL_TYPES = ['binary', 'json', 'yaml', 'dotenv', 'ini'];

// Map sops --input-type to the conventional file extension. sops does not
// honor `-` as a stdin sentinel in `encrypt` mode (it resolves it as a
// relative path against cwd), so we stage plaintext in a tmpfs file with
// the right extension and pass the real path. /dev/shm is RAM-backed on
// Linux; the file never touches the disk. Non-Linux falls back to
// os.tmpdir() which may be on disk — shred + unlink in finally still applies.
const TYPE_EXT = { json: 'json', yaml: 'yaml', dotenv: 'env', ini: 'ini', binary: 'bin' };

function pickTmpDir() {
    if (process.platform === 'linux') {
        try {
            fs.accessSync('/dev/shm', fs.constants.W_OK);
            return '/dev/shm';
        } catch {}
    }
    return os.tmpdir();
}

function shredAndUnlink(p) {
    if (!p) return;
    try {
        const st = fs.statSync(p);
        const fd = fs.openSync(p, 'r+');
        try {
            fs.writeSync(fd, Buffer.alloc(st.size, 0), 0, st.size, 0);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
    } catch (e) {
        if (e.code !== 'ENOENT') logger.warn('fs', 'shred failed', { path: p, error: e.message });
    }
    try { fs.unlinkSync(p); } catch (e) {
        if (e.code !== 'ENOENT') logger.warn('fs', 'tmp unlink failed', { path: p, error: e.message });
    }
}

class SopsFileSystemProvider {
    constructor() {
        this._emitter = new vscode.EventEmitter();
        this.onDidChangeFile = this._emitter.event;
        // Memoize binary-version probes per resolved binaryPath so we don't
        // shell out before every read/write — a single check per session
        // suffices unless the user changes the setting.
        this._binaryChecked = new Map();
        // Coalesce concurrent readFile calls for the same URI. VS Code can ask
        // for the same decrypted view more than once at a time (editor + diff +
        // peek + decoration), and each call would otherwise spawn its own sops
        // process — N simultaneous KMS round-trips for one file. Callers share
        // the in-flight promise; the entry is dropped as soon as it settles.
        this._inflight = new Map();
        this._disposables = [];

        // Drop the binary-probe cache whenever the user changes
        // sops.binaryPath / sops.env / sops.envFile — the resolved binaryPath
        // string is the cache key, but env tweaks can change whether the
        // binary spawns successfully (PATH, SOPS_AGE_KEY_FILE, etc.).
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('sops.binaryPath') ||
                    e.affectsConfiguration('sops.env') ||
                    e.affectsConfiguration('sops.envFile')) {
                    if (this._binaryChecked.size) {
                        logger.info('config', 'sops settings changed; clearing binary preflight cache', {
                            keys: [...this._binaryChecked.keys()],
                        });
                        this._binaryChecked.clear();
                    }
                }
            })
        );
    }

    dispose() {
        for (const d of this._disposables) {
            try { d.dispose(); } catch {}
        }
        this._disposables = [];
        try { this._emitter.dispose(); } catch {}
    }

    watch() { return new vscode.Disposable(() => {}); }

    stat(uri) {
        const sopsPath = uri.fsPath + '.sops';
        try {
            const s = fs.statSync(sopsPath);
            // size 0: the encrypted file size is misleading; decrypted size
            // is unknown without running sops, so report 0 rather than lie.
            return { type: vscode.FileType.File, ctime: s.ctimeMs, mtime: s.mtimeMs, size: 0 };
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    readDirectory() { return []; }
    createDirectory() { throw vscode.FileSystemError.NoPermissions(); }
    delete() { throw vscode.FileSystemError.NoPermissions(); }
    rename() { throw vscode.FileSystemError.NoPermissions(); }

    async _ensureBinary(binaryPath, env) {
        const cached = this._binaryChecked.get(binaryPath);
        if (cached) return cached;
        const r = await checkBinaryAsync(binaryPath, env);
        // Cache both success and failure — repeated failures from a bad config
        // shouldn't shell out on every keystroke. Cache is cleared on settings change.
        this._binaryChecked.set(binaryPath, r);
        if (r.ok) logger.info('preflight', 'sops binary ok', { binaryPath, version: r.version });
        else logger.error('preflight', 'sops binary check failed', { binaryPath, reason: r.reason });
        return r;
    }

    async _runSops(binaryPath, args, opts) {
        return execFileAsync(binaryPath, args, { ...opts, maxBuffer: MAX_SOPS_BUFFER });
    }

    async _tryDecrypt(binaryPath, configPath, inputType, sopsPath, env, cwd) {
        const args = [
            ...buildGlobalFlags(configPath),
            'decrypt',
            '--input-type', inputType,
            '--output-type', inputType,
            sopsPath,
        ];
        const t0 = Date.now();
        try {
            const { stdout } = await this._runSops(binaryPath, args, { cwd, env, timeout: 30000 });
            return { ok: true, content: Buffer.from(stdout), ms: Date.now() - t0, inputType };
        } catch (err) {
            return {
                ok: false,
                stderr: err.stderr?.toString() || err.message,
                ms: Date.now() - t0,
                inputType,
            };
        }
    }

    readFile(uri) {
        const key = uri.toString();
        const existing = this._inflight.get(key);
        if (existing) {
            logger.trace('fs', 'readFile coalesced with in-flight decrypt', { uri: key });
            return existing;
        }
        const p = this._doReadFile(uri).finally(() => this._inflight.delete(key));
        this._inflight.set(key, p);
        return p;
    }

    async _doReadFile(uri) {
        const sopsPath = uri.fsPath + '.sops';
        logger.trace('fs', 'readFile enter', { uri: uri.toString(), fsPath: uri.fsPath, sopsPath });

        const rf = checkFileReadable(sopsPath);
        if (!rf.ok) {
            logger.error('preflight', 'file not readable', { sopsPath, reason: rf.reason });
            throw rf.notFound
                ? vscode.FileSystemError.FileNotFound(rf.reason)
                : vscode.FileSystemError.Unavailable(rf.reason);
        }

        const detection = detectStoreType(sopsPath);
        logger.info('detect', 'store type detected', {
            sopsPath,
            type: detection.type,
            source: detection.source,
            confidence: detection.confidence,
        });

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
            throw vscode.FileSystemError.Unavailable(configPathError);
        }
        if (envFileError) {
            logger.warn('fs', 'envFile read error (continuing without)', { envFile, envFileError });
        }

        const binCheck = await this._ensureBinary(binaryPath, env);
        if (!binCheck.ok) throw vscode.FileSystemError.Unavailable(binCheck.reason);

        const cwd = path.dirname(sopsPath);
        logger.logOpStart('decrypt', {
            sopsPath, inputType: detection.type, configPath, cwd, binaryPath, env,
        });

        // Primary attempt: detected type.
        const primary = await this._tryDecrypt(binaryPath, configPath, detection.type, sopsPath, env, cwd);
        if (primary.ok) {
            logger.logOpResult('decrypt', { ok: true, ms: primary.ms, bytes: primary.content.length });
            return primary.content;
        }

        // Tolerant fallback: only when detection confidence was low/medium AND
        // the failure smells like a format problem. High-confidence content
        // detection should never need a retry, and a non-format error (e.g.
        // missing key) should not be masked by attempting other types.
        if (detection.confidence !== 'high' && FORMAT_FALLBACK_RE.test(primary.stderr || '')) {
            const alternates = ALL_TYPES.filter(t => t !== detection.type);
            logger.warn('fs', 'primary decrypt hit format-like error; trying alternates', {
                primary: detection.type,
                alternates,
                stderrFirstLine: (primary.stderr || '').split(/\r?\n/)[0],
            });
            for (const alt of alternates) {
                const r = await this._tryDecrypt(binaryPath, configPath, alt, sopsPath, env, cwd);
                if (r.ok) {
                    logger.info('fs', 'decrypt succeeded with fallback type', {
                        type: alt, fallbackFrom: detection.type,
                    });
                    logger.logOpResult('decrypt', { ok: true, ms: r.ms, bytes: r.content.length });
                    return r.content;
                }
            }
            logger.error('fs', 'all decrypt fallbacks failed', { tried: [detection.type, ...alternates] });
        }

        // No more avenues — surface the original (most informative) error.
        logger.logOpResult('decrypt', { ok: false, ms: primary.ms, stderr: primary.stderr });
        throw vscode.FileSystemError.Unavailable(`SOPS decrypt failed: ${normalizeErr(primary.stderr)}`);
    }

    async writeFile(uri, content) {
        const sopsPath = uri.fsPath + '.sops';
        const dir = path.dirname(sopsPath);
        const bufLen = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content));
        const reason = saveReason.consume(uri);

        // Round-trip rule: re-encrypt in the same storage format the file is
        // currently in on disk. If this is the first save of a brand-new
        // file, fall back to the filename hint. We deliberately do not let
        // sops.yaml override here — switching format on save would surprise
        // the user; format migrations should be explicit.
        const detection = fs.existsSync(sopsPath)
            ? detectStoreType(sopsPath)
            : { type: detectByExtension(sopsPath), source: 'extension', confidence: 'low' };
        const inputType = detection.type;

        logger.trace('fs', 'writeFile enter', {
            uri: uri.toString(),
            fsPath: uri.fsPath,
            sopsPath,
            inputType,
            bytes: bufLen,
            saveReason: reason,
            detectionSource: detection.source,
            detectionConfidence: detection.confidence,
        });

        // Only re-encrypt on explicit manual saves. Any other reason
        // (AfterDelay, FocusOut, or untracked) is an autosave trigger;
        // rejecting keeps the document dirty so the user can Ctrl+S.
        if (reason !== vscode.TextDocumentSaveReason.Manual) {
            logger.info('fs', 'writeFile blocked (autosave)', { uri: uri.toString(), reason });
            throw vscode.FileSystemError.NoPermissions(
                'SOPS: autosave disabled for .sops files. Press Ctrl+S or run "SOPS: Save & Re-encrypt".'
            );
        }

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
            throw vscode.FileSystemError.Unavailable(configPathError);
        }
        if (envFileError) {
            logger.warn('fs', 'envFile read error (continuing without)', { envFile, envFileError });
        }

        const binCheck = await this._ensureBinary(binaryPath, env);
        if (!binCheck.ok) throw vscode.FileSystemError.Unavailable(binCheck.reason);

        // Pre-validate dotenv before spawning sops so the error clearly names
        // the bad line. SOPS rejects any non-empty, non-comment line without
        // '=' with a cryptic wrapper otherwise.
        if (inputType === 'dotenv') {
            const text = content.toString('utf8');
            const lineCount = text.split(/\r?\n/).length;
            const bad = findInvalidDotenvLines(text);
            logger.trace('validate', 'dotenv checked', { lineCount, badCount: bad.length });
            if (bad.length) {
                const preview = bad.slice(0, 3).map(b => `line ${b.n}: ${JSON.stringify(b.text)}`).join(', ');
                const more = bad.length > 3 ? ` (+${bad.length - 3} more)` : '';
                const msg = `Invalid dotenv syntax — expected KEY=value at ${preview}${more}`;
                logger.error('validate', 'dotenv rejected', {
                    badLines: bad.map(b => b.n),
                    previewLines: bad.slice(0, 3).map(b => ({ n: b.n, text: b.text })),
                });
                throw vscode.FileSystemError.Unavailable(msg);
            }
        }

        // Stage plaintext in a tmpfs file (/dev/shm on Linux) and pass that
        // path to sops. We can't use `-` for stdin — sops resolves it as a
        // relative path against cwd. --filename-override keeps creation_rules
        // matching against the real .sops path.
        const tmpDir = pickTmpDir();
        const ext = TYPE_EXT[inputType] || 'bin';
        const tmpPath = path.join(tmpDir, `sops-encrypt-${crypto.randomBytes(8).toString('hex')}.${ext}`);
        const args = [
            ...buildGlobalFlags(configPath),
            'encrypt',
            '--filename-override', sopsPath,
            '--input-type', inputType,
            '--output-type', inputType,
            tmpPath,
        ];

        let stage = null;
        logger.trace('fs', 'encrypt prep (tmp-file mode)', { cwd: dir, tmpPath });
        logger.logOpStart('encrypt', { sopsPath, inputType, configPath, cwd: dir, binaryPath, env });
        const t0 = Date.now();
        try {
            const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
            const tfd = fs.openSync(tmpPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
            try {
                fs.writeSync(tfd, buf);
                fs.fsyncSync(tfd);
            } finally {
                fs.closeSync(tfd);
            }
            logger.trace('fs', 'spawn encrypt', { binaryPath, args, cwd: dir });
            const { stdout: encrypted } = await this._runSops(binaryPath, args, {
                cwd: dir, env, timeout: 30000,
            });

            // Atomic write: stage in same dir, fsync, rename. If we get killed
            // mid-write the original .sops file is preserved intact.
            const prevMode = (() => {
                try { return fs.statSync(sopsPath).mode & 0o777; } catch { return 0o644; }
            })();
            stage = sopsPath + `.staging.${crypto.randomBytes(4).toString('hex')}`;
            const fd = fs.openSync(stage, 'w', prevMode);
            try {
                fs.writeSync(fd, encrypted);
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            fs.renameSync(stage, sopsPath);
            stage = null; // consumed by rename

            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
            const encryptedLen = Buffer.isBuffer(encrypted) ? encrypted.length : Buffer.byteLength(encrypted);
            logger.logOpResult('encrypt', { ok: true, ms: Date.now() - t0, bytes: encryptedLen });
            vscode.window.showInformationMessage(`SOPS: saved & re-encrypted ${path.basename(sopsPath)}`);
        } catch (err) {
            const stderr = err.stderr?.toString() || err.message;
            logger.logOpResult('encrypt', { ok: false, ms: Date.now() - t0, stderr });
            throw vscode.FileSystemError.Unavailable(`SOPS encrypt failed: ${normalizeErr(stderr)}`);
        } finally {
            // Plaintext tmp file: zero the bytes before unlink. On /dev/shm
            // this is RAM, but the same code path runs on os.tmpdir() where
            // it could be a disk-backed filesystem.
            shredAndUnlink(tmpPath);
            // Stage file only exists if rename never happened — best-effort cleanup.
            if (stage) {
                try { fs.unlinkSync(stage); logger.trace('fs', 'stage unlinked after failure', { stage }); }
                catch (e) {
                    if (e.code !== 'ENOENT') logger.warn('fs', 'stage cleanup failed', { stage, error: e.message });
                }
            }
        }
    }
}

module.exports = { SopsFileSystemProvider };
