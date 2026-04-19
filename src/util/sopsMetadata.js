function parseRecipients(raw) {
    const out = { age: [], kms: [], pgp: [] };
    const push = (arr, val) => { if (val && !arr.includes(val)) arr.push(val); };
    // dotenv/INI flattened metadata
    for (const m of raw.matchAll(/^sops_age__list_\d+__map_recipient=(.+)$/gm)) push(out.age, m[1]);
    for (const m of raw.matchAll(/^sops_kms__list_\d+__map_arn=(.+)$/gm)) push(out.kms, m[1]);
    for (const m of raw.matchAll(/^sops_pgp__list_\d+__map_fp=(.+)$/gm)) push(out.pgp, m[1]);
    // YAML/JSON metadata: line-oriented scan within sops block
    for (const m of raw.matchAll(/^\s*-?\s*["']?recipient["']?\s*:\s*["']?([^"'\s,}]+)/gm)) push(out.age, m[1]);
    for (const m of raw.matchAll(/^\s*-?\s*["']?arn["']?\s*:\s*["']?(arn:aws:kms:[^"'\s,}]+)/gm)) push(out.kms, m[1]);
    for (const m of raw.matchAll(/^\s*-?\s*["']?fp["']?\s*:\s*["']?([A-F0-9]{16,})/gm)) push(out.pgp, m[1]);
    return out;
}

function parseCoverageRules(raw) {
    const rules = { encSuffix: null, unencSuffix: null, encRegex: null, unencRegex: null };
    const grab = (re) => { const m = raw.match(re); return m ? m[1] : null; };
    rules.encSuffix   = grab(/^sops_encrypted_suffix=(.+)$/m)   ?? grab(/^\s*encrypted_suffix:\s*["']?([^"'\n]+?)["']?\s*$/m);
    rules.unencSuffix = grab(/^sops_unencrypted_suffix=(.+)$/m) ?? grab(/^\s*unencrypted_suffix:\s*["']?([^"'\n]+?)["']?\s*$/m);
    rules.encRegex    = grab(/^sops_encrypted_regex=(.+)$/m)    ?? grab(/^\s*encrypted_regex:\s*["']?([^"'\n]+?)["']?\s*$/m);
    rules.unencRegex  = grab(/^sops_unencrypted_regex=(.+)$/m)  ?? grab(/^\s*unencrypted_regex:\s*["']?([^"'\n]+?)["']?\s*$/m);
    const parts = [];
    if (rules.encSuffix)   parts.push(`encrypted_suffix=${rules.encSuffix}`);
    if (rules.unencSuffix) parts.push(`unencrypted_suffix=${rules.unencSuffix}`);
    if (rules.encRegex)    parts.push(`encrypted_regex=${rules.encRegex}`);
    if (rules.unencRegex)  parts.push(`unencrypted_regex=${rules.unencRegex}`);
    rules.summary = parts.join(' · ');
    return rules;
}

function shouldKeyBeEncrypted(key, rules) {
    if (rules.unencSuffix && key.endsWith(rules.unencSuffix)) return false;
    if (rules.encSuffix && !key.endsWith(rules.encSuffix)) return false;
    if (rules.unencRegex) { try { if (new RegExp(rules.unencRegex).test(key)) return false; } catch {} }
    if (rules.encRegex)   { try { if (!new RegExp(rules.encRegex).test(key)) return false; } catch {} }
    return true;
}

module.exports = { parseRecipients, parseCoverageRules, shouldKeyBeEncrypted };
