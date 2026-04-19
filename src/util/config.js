const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
            ? vscode.workspace.getWorkspaceFolder(resourceUri)
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
        ? vscode.workspace.getWorkspaceFolder(resourceUri)
        : vscode.workspace.workspaceFolders?.[0];
    return folder ? path.join(folder.uri.fsPath, expanded) : expanded;
}

// Read resolved config for a given file URI. Layering: settings are folded
// user -> workspace -> folder by vscode.getConfiguration(section, resourceUri).
// Env is layered: process.env <- envFile contents <- inline sops.env.
function resolveConfig(resourceUri) {
    const cfg = vscode.workspace.getConfiguration('sops', resourceUri);

    const configPath = resolveToAbsolute(cfg.get('configPath', '') || '', resourceUri) || null;
    const envFile = resolveToAbsolute(cfg.get('envFile', '') || '', resourceUri) || null;
    const inlineEnv = cfg.get('env', {}) || {};
    const binaryPath = expandVars(cfg.get('binaryPath', 'sops') || 'sops', resourceUri);

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

    return { configPath, envFile, envFileError, inlineEnv, binaryPath, env };
}

module.exports = { resolveConfig, expandVars, parseDotenv };
