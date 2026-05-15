const fs = require('fs');
const { execFileSync } = require('child_process');

// Confirms the configured sops binary exists and is callable.
// Returns { ok, version } on success or { ok: false, reason } on failure.
function checkBinary(binaryPath, env) {
    try {
        const out = execFileSync(binaryPath, ['--version'], { timeout: 5000, env });
        const firstLine = out.toString().split(/\r?\n/).find(l => l.trim()) || '';
        return { ok: true, version: firstLine.trim() };
    } catch (err) {
        if (err.code === 'ENOENT') {
            return {
                ok: false,
                reason:
                    `sops binary not found at ${JSON.stringify(binaryPath)}. ` +
                    `Install sops (https://getsops.io) or set "sops.binaryPath" in settings.`,
            };
        }
        const stderr = (err.stderr && err.stderr.toString()) || err.message || '';
        return {
            ok: false,
            reason: `sops binary at ${JSON.stringify(binaryPath)} is not callable: ` +
                    (stderr.split(/\r?\n/)[0] || 'unknown error'),
        };
    }
}

function checkFileReadable(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
        const s = fs.statSync(filePath);
        if (!s.isFile()) return { ok: false, reason: `${filePath} is not a regular file.` };
        if (s.size === 0) return { ok: false, reason: `${filePath} is empty — nothing to decrypt.` };
        return { ok: true, size: s.size };
    } catch (err) {
        if (err.code === 'ENOENT') return { ok: false, reason: `Encrypted file not found: ${filePath}` };
        if (err.code === 'EACCES') return { ok: false, reason: `Permission denied reading ${filePath}.` };
        return { ok: false, reason: `Cannot read ${filePath}: ${err.message}` };
    }
}

module.exports = { checkBinary, checkFileReadable };
