const vscode = require('vscode');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getInputType } = require('../util/paths');
const { findInvalidDotenvLines } = require('../util/dotenv');

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
        try {
            return execFileSync('sops', ['decrypt', '--input-type', inputType, '--output-type', inputType, sopsPath]);
        } catch (err) {
            throw new Error(`SOPS decrypt failed: ${err.stderr?.toString() || err.message}`);
        }
    }

    writeFile(uri, content) {
        const sopsPath = uri.fsPath + '.sops';
        const inputType = getInputType(sopsPath);
        const dir = path.dirname(sopsPath);

        // Pre-validate dotenv before spawning sops so the error clearly names the bad line.
        // SOPS rejects any non-empty, non-comment line without '=' with a cryptic wrapper otherwise.
        if (inputType === 'dotenv') {
            const bad = findInvalidDotenvLines(content.toString('utf8'));
            if (bad.length) {
                const preview = bad.slice(0, 3).map(b => `line ${b.n}: ${JSON.stringify(b.text)}`).join(', ');
                const more = bad.length > 3 ? ` (+${bad.length - 3} more)` : '';
                throw new Error(`Invalid dotenv syntax — expected KEY=value at ${preview}${more}`);
            }
        }

        const tmp = `/dev/shm/sops-${crypto.randomBytes(6).toString('hex')}`;
        try {
            fs.writeFileSync(tmp, content, { mode: 0o600 });
            const encrypted = execFileSync(
                'sops', ['encrypt', '--input-type', inputType, '--output-type', inputType, tmp],
                { cwd: dir }
            );
            fs.writeFileSync(sopsPath, encrypted);
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        } catch (err) {
            throw new Error(`SOPS encrypt failed: ${err.stderr?.toString() || err.message}`);
        } finally {
            try { execFileSync('shred', ['-u', tmp]); } catch { try { fs.unlinkSync(tmp); } catch {} }
        }
    }
}

module.exports = { SopsFileSystemProvider };
