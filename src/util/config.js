const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

// `vscode.workspace.getWorkspaceFolder(uri)` only matches when `uri.scheme`
// equals the folder's scheme. Our virtual `sops-decrypted://` URIs (and the
// rewrapped `file://` URIs) never match `vscode-remote://` workspace folders
// on SSH remotes. Match on fsPath prefix instead, which is scheme-agnostic.
function getWorkspaceFolderFor(uri) {
    if (!uri || !vscode.workspace.workspaceFolders) return null;
    const fsPath = uri.fsPath;
    let best = null;
    let bestLen = -1;
    for (const wf of vscode.workspace.workspaceFolders) {
        const wfPath = wf.uri.fsPath;
        if ((fsPath === wfPath || fsPath.startsWith(wfPath + path.sep)) && wfPath.length > bestLen) {
            best = wf;
            bestLen = wfPath.length;
        }
    }
    return best;
}

function parseDotenv(text) {
    const out = {};
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        let key = line.slice(0, eq).trim();
        if (key.startsWith('export ')) key = key.slice(7).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        out[key] = value;
    }
    return out;
}

function expandVars(str, resourceUri) {
    if (!str) return str;
    let result = str;
    if (result === '~' || result.startsWith('~/')) {
        result = os.homedir() + result.slice(1);
    }
    result = result.replace(/\$\{userHome\}/g, os.homedir());
    result = result.replace(/\$\{env:([^}]+)\}/g, (_, name) => process.env[name] ?? '');
    if (result.includes('${workspaceFolder')) {
        const folder = resourceUri
            ? getWorkspaceFolderFor(resourceUri)
            : vscode.workspace.workspaceFolders?.[0];
        result = result.replace(/\$\{workspaceFolder\}/g, folder?.uri.fsPath ?? '');
        result = result.replace(/\$\{workspaceFolder:([^}]+)\}/g, (_, name) => {
            const f = vscode.workspace.workspaceFolders?.find(ws => ws.name === name);
            return f?.uri.fsPath ?? '';
        });
    }
    return result;
}

function resolveToAbsolute(p, resourceUri) {
    if (!p) return p;
    const expanded = expandVars(p, resourceUri);
    if (path.isAbsolute(expanded)) return expanded;
    const folder = resourceUri
        ? getWorkspaceFolderFor(resourceUri)
        : vscode.workspace.workspaceFolders?.[0];
    if (folder) return path.join(folder.uri.fsPath, expanded);
    // No workspace folder — resolve against the resource file's own directory
    // so single-file (non-workspace) opens still produce a deterministic path.
    if (resourceUri?.fsPath) return path.resolve(path.dirname(resourceUri.fsPath), expanded);
    return expanded;
}

// Read resolved config for a given file URI. Layering: settings are folded
// user -> workspace -> folder by vscode.getConfiguration(section, resourceUri).
// Env is layered: process.env <- envFile contents <- inline sops.env.
function resolveConfig(resourceUri) {
    // Pass the matched workspace folder's own URI so folder-scoped settings
    // resolve correctly even when the resource URI scheme (sops-decrypted://)
    // doesn't match the workspace scheme (file:// locally, vscode-remote:// on SSH).
    const wf = resourceUri ? getWorkspaceFolderFor(resourceUri) : null;
    const cfg = vscode.workspace.getConfiguration('sops', wf?.uri ?? resourceUri);

    const configPathRaw = cfg.get('configPath', '') || '';
    const envFileRaw = cfg.get('envFile', '') || '';
    const configPath = resolveToAbsolute(configPathRaw, resourceUri) || null;
    const envFile = resolveToAbsolute(envFileRaw, resourceUri) || null;
    const inlineEnv = cfg.get('env', {}) || {};
    const binaryPath = expandVars(cfg.get('binaryPath', 'sops') || 'sops', resourceUri);

    // Pre-flight: if the user configured configPath but we resolved to something
    // that doesn't exist, surface an actionable error instead of letting SOPS
    // emit a cryptic "open <relative path>: no such file or directory".
    let configPathError = null;
    if (configPathRaw && configPath && !fs.existsSync(configPath)) {
        configPathError =
            `sops.configPath is set to ${JSON.stringify(configPathRaw)} but the resolved path ` +
            `${configPath} does not exist. Fix the setting or create the file.`;
    }

    const env = { ...process.env };
    let envFileError = null;
    if (envFile) {
        try {
            const text = fs.readFileSync(envFile, 'utf8');
            Object.assign(env, parseDotenv(text));
        } catch (err) {
            envFileError = err.message;
        }
    }
    for (const [k, v] of Object.entries(inlineEnv)) {
        env[k] = expandVars(String(v), resourceUri);
    }

    return { configPath, configPathError, envFile, envFileError, inlineEnv, binaryPath, env };
}

module.exports = { resolveConfig, expandVars, parseDotenv };
