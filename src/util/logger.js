const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SOPS_ENV_RE = /^(SOPS_|AWS_|AZURE_|GCP_|GOOGLE_|VAULT_)/;
const DEFAULT_LOG_SUBPATH = path.join('sops-open-decrypted', 'trace.log');

let channel = null;
let fileSink = null; // { path, stream }
let fileSinkError = null;

function getLogger() {
    if (!channel) {
        channel = vscode.window.createOutputChannel('SOPS', { log: true });
    }
    return channel;
}

function defaultLogPath() {
    const xdgState = process.env.XDG_STATE_HOME;
    const base = xdgState && xdgState.trim()
        ? xdgState
        : path.join(os.homedir(), '.local', 'state');
    return path.join(base, DEFAULT_LOG_SUBPATH);
}

function configuredLogPath() {
    try {
        const cfg = vscode.workspace.getConfiguration('sops');
        const raw = (cfg.get('debugLogFile', '') || '').trim();
        if (!raw) return defaultLogPath();
        // Expand ~ and a couple of cheap env tokens inline; avoid importing config.js
        // to keep logger loadable before config machinery is ready.
        let p = raw;
        if (p === '~' || p.startsWith('~/')) p = os.homedir() + p.slice(1);
        p = p.replace(/\$\{userHome\}/g, os.homedir());
        p = p.replace(/\$\{env:([^}]+)\}/g, (_, name) => process.env[name] ?? '');
        return path.isAbsolute(p) ? p : path.resolve(os.homedir(), p);
    } catch {
        return defaultLogPath();
    }
}

function ensureFileSink() {
    if (fileSink || fileSinkError) return fileSink;
    const target = configuredLogPath();
    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const stream = fs.createWriteStream(target, { flags: 'a', mode: 0o600 });
        stream.on('error', (err) => {
            fileSinkError = err.message;
            fileSink = null;
            getLogger().warn(`trace-log write error (${target}): ${err.message}`);
        });
        fileSink = { path: target, stream };
        // Session boundary marker — makes it easy to see where a new extension host started.
        writeFileLine('info', 'logger', `=== session start pid=${process.pid} node=${process.version} platform=${process.platform} target=${target} ===`);
    } catch (err) {
        fileSinkError = err.message;
        getLogger().warn(`trace-log init failed (${target}): ${err.message}`);
    }
    return fileSink;
}

function writeFileLine(level, component, message) {
    const sink = ensureFileSink();
    if (!sink) return;
    const ts = new Date().toISOString();
    try {
        sink.stream.write(`${ts} ${level.toUpperCase().padEnd(5)} [${component}] ${message}\n`);
    } catch (err) {
        fileSinkError = err.message;
        fileSink = null;
    }
}

function stringifyKV(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const parts = [];
    for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        let s;
        if (v === null) s = 'null';
        else if (typeof v === 'string') s = JSON.stringify(v);
        else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
        else if (Array.isArray(v)) s = JSON.stringify(v);
        else s = JSON.stringify(v);
        parts.push(`${k}=${s}`);
    }
    return parts.join(' ');
}

function emit(level, component, message, kv) {
    const suffix = kv ? (' ' + stringifyKV(kv)) : '';
    const line = `[${component}] ${message}${suffix}`;
    const log = getLogger();
    switch (level) {
        case 'trace': log.trace(line); break;
        case 'debug': log.debug(line); break;
        case 'warn':  log.warn(line);  break;
        case 'error': log.error(line); break;
        default:      log.info(line);
    }
    writeFileLine(level, component, `${message}${suffix}`);
}

function trace(component, message, kv) { emit('trace', component, message, kv); }
function debug(component, message, kv) { emit('debug', component, message, kv); }
function info(component, message, kv)  { emit('info',  component, message, kv); }
function warn(component, message, kv)  { emit('warn',  component, message, kv); }
function error(component, message, kv) { emit('error', component, message, kv); }

function sopsEnvNames(env) {
    return Object.keys(env || {}).filter(k => SOPS_ENV_RE.test(k)).sort();
}

function logOpStart(op, details) {
    const { sopsPath, inputType, configPath, cwd, binaryPath, env } = details;
    const names = sopsEnvNames(env);
    info('op', `${op} start`, {
        sopsPath,
        inputType,
        configPath: configPath ?? '(unset; ancestor-walk from cwd)',
        cwd,
        binary: binaryPath,
        sopsEnvNames: names.length ? names.join(',') : '(none)',
    });
}

function logOpResult(op, { ok, ms, bytes, stderr }) {
    if (ok) {
        info('op', `${op} ok`, { ms, bytes });
    } else {
        const firstLine = (stderr || '').split(/\r?\n/).find(l => l.trim()) || '(no stderr)';
        // Full stderr goes to the file sink for debugging; the channel gets the first line
        // so the Output panel doesn't explode on multi-line errors.
        error('op', `${op} failed`, { ms, stderrFirstLine: firstLine });
        if (stderr && stderr !== firstLine) {
            writeFileLine('error', 'op', `${op} stderr full:\n${stderr}`);
        }
    }
}

function show() {
    getLogger().show(true);
}

function getLogFilePath() {
    ensureFileSink();
    return fileSink?.path || configuredLogPath();
}

module.exports = {
    getLogger,
    logOpStart,
    logOpResult,
    show,
    trace, debug, info, warn, error,
    getLogFilePath,
};
