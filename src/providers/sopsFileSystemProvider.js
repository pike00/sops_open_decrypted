const vscode = require('vscode');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { detectStoreType, detectByExtension } = require('../util/storeDetection');
const { findInvalidDotenvLines } = require('../util/dotenv');
const { resolveConfig } = require('../util/config');
const { checkBinary, checkFileReadable } = require('../util/preflight');
const { normalize: normalizeErr } = require('../util/sopsErrors');
const saveReason = require('../util/saveReasonTracker');
const logger = require('../util/logger');

function buildGlobalFlags(configPath) {
    return configPath ? ['--config', configPath] : [];
}

// Errors that smell like SOPS choking on the wrong --input-type. When the
// primary detection wasn't high-confidence, these trigger a one-shot retry
// with the other plausible types before we give up.
const FORMAT_FALLBACK_RE =
    /cannot parse|could not load input|invalid yaml|invalid json|not a valid|cannot unmarshal|unknown input type|invalid input type/i;

const ALL_TYPES = ['binary', 'json', 'yaml', 'dotenv', 'ini'];

class SopsFileSystemProvider {
    constructor() {
        this._emitter = new vscode.EventEmitter();
        this.onDidChangeFile = this._emitter.event;
        // Memoize binary-version probes per resolved binaryPath so we don't
        // shell out before every read/write — a single check per session
        // suffices unless the user changes the setting.
        this._binaryChecked = new Map();
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
            return { type: vscode.FileType.File, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    readDirectory() { return []; }
    createDirectory() { throw vscode.FileSystemError.NoPermissions(); }
    delete() { throw vscode.FileSystemError.NoPermissions(); }
    rename() { throw vscode.FileSystemError.NoPermissions(); }

    _ensureBinary(binaryPath, env) {
        const cached = this._binaryChecked.get(binaryPath);
        if (cached) return cached;
        const r = checkBinary(binaryPath, env);
        this._binaryChecked.set(binaryPath, r);
        if (r.ok) logger.info('preflight', 'sops binary ok', { binaryPath, version: r.version });
        else logger.error('preflight', 'sops binary check failed', { binaryPath, reason: r.reason });
        return r;
    }

    _runSops(binaryPath, args, opts) {
        return execFileSync(binaryPath, args, opts);
    }

    _tryDecrypt(binaryPath, configPath, inputType, sopsPath, env, cwd) {
        const args = [
            ...buildGlobalFlags(configPath),
            'decrypt',
            '--input-type', inputType,
            '--output-type', inputType,
            sopsPath,
        ];
        const t0 = Date.now();
        try {
            const out = this._runSops(binaryPath, args, { cwd, env });
            return { ok: true, content: out, ms: Date.now() - t0, inputType };
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
        const sopsPath = uri.fsPath + '.sops';
        logger.trace('fs', 'readFile enter', { uri: uri.toString(), fsPath: uri.fsPath, sopsPath });

        const rf = checkFileReadable(sopsPath);
        if (!rf.ok) {
            logger.error('preflight', 'file not readable', { sopsPath, reason: rf.reason });
            throw vscode.FileSystemError.FileNotFound(uri);
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
            throw new Error(configPathError);
        }
        if (envFileError) {
            logger.warn('fs', 'envFile read error (continuing without)', { envFile, envFileError });
        }

        const binCheck = this._ensureBinary(binaryPath, env);
        if (!binCheck.ok) throw new Error(binCheck.reason);

        const cwd = path.dirname(sopsPath);
        logger.logOpStart('decrypt', {
            sopsPath, inputType: detection.type, configPath, cwd, binaryPath, env,
        });

        // Primary attempt: detected type.
        const primary = this._tryDecrypt(binaryPath, configPath, detection.type, sopsPath, env, cwd);
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
                const r = this._tryDecrypt(binaryPath, configPath, alt, sopsPath, env, cwd);
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
        throw new Error(`SOPS decrypt failed: ${normalizeErr(primary.stderr)}`);
    }

    writeFile(uri, content) {
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

        // Only re-encrypt on explicit saves. AfterDelay and FocusOut come
        // from files.autoSave; rejecting here keeps the document dirty so
        // the user can retry, and skips the decrypt/encrypt round-trip
        // per keystroke.
        if (reason === vscode.TextDocumentSaveReason.AfterDelay ||
            reason === vscode.TextDocumentSaveReason.FocusOut) {
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
            throw new Error(configPathError);
        }
        if (envFileError) {
            logger.warn('fs', 'envFile read error (continuing without)', { envFile, envFileError });
        }

        const binCheck = this._ensureBinary(binaryPath, env);
        if (!binCheck.ok) throw new Error(binCheck.reason);

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
                throw new Error(msg);
            }
        }

        const tmp = `/dev/shm/sops-${crypto.randomBytes(6).toString('hex')}`;
        let stage = null;
        logger.trace('fs', 'encrypt prep', { tmp, cwd: dir });
        logger.logOpStart('encrypt', { sopsPath, inputType, configPath, cwd: dir, binaryPath, env });
        const t0 = Date.now();
        try {
            fs.writeFileSync(tmp, content, { mode: 0o600 });
            const args = [
                ...buildGlobalFlags(configPath),
                'encrypt',
                // --filename-override makes SOPS match creation_rules against the
                // real .sops path instead of the random tmp path.
                '--filename-override', sopsPath,
                '--input-type', inputType,
                '--output-type', inputType,
                tmp,
            ];
            logger.trace('fs', 'spawn encrypt', { binaryPath, args, cwd: dir });
            const encrypted = this._runSops(binaryPath, args, { cwd: dir, env });

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
            logger.logOpResult('encrypt', { ok: true, ms: Date.now() - t0, bytes: encrypted.length });
            vscode.window.showInformationMessage(`SOPS: saved & re-encrypted ${path.basename(sopsPath)}`);
        } catch (err) {
            const stderr = err.stderr?.toString() || err.message;
            logger.logOpResult('encrypt', { ok: false, ms: Date.now() - t0, stderr });
            throw new Error(`SOPS encrypt failed: ${normalizeErr(stderr)}`);
        } finally {
            // Plaintext tmp file always gets shredded.
            try { execFileSync('shred', ['-u', tmp]); logger.trace('fs', 'tmp shredded', { tmp }); }
            catch (e1) {
                try { fs.unlinkSync(tmp); logger.trace('fs', 'tmp unlinked (shred unavailable)', { tmp, shredError: e1.message }); }
                catch (e2) {
                    if (e2.code !== 'ENOENT') {
                        logger.warn('fs', 'tmp cleanup failed', { tmp, shredError: e1.message, unlinkError: e2.message });
                    }
                }
            }
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
