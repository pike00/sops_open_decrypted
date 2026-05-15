// Translate raw sops stderr into actionable, plain-English explanations.
// The patterns here are ordered most-specific-first; the first match wins.
// `raw` from sops can contain control codes and multiple stack-trace lines,
// so we always show just the first meaningful line back to the user.

const PATTERNS = [
    {
        re: /no key could decrypt the data|Failed to decrypt sops data key|could not decrypt data key|no MasterKey successfully decrypted/i,
        explain:
            'No available recipient key matched. Check your identity:\n' +
            '  • age: ensure ~/.config/sops/age/keys.txt or $SOPS_AGE_KEY_FILE points to a key listed in the file\'s recipient block.\n' +
            '  • Use "SOPS: Show Recipients" to compare the file\'s recipients with your identities.',
    },
    {
        re: /MAC mismatch|MAC check failed|MAC for new ENC tree/i,
        explain:
            'MAC mismatch — the file was edited outside SOPS or is corrupted. ' +
            'Restore from git or re-encrypt from a known-good plaintext.',
    },
    {
        re: /open .*\.sops\.ya?ml: no such file/i,
        explain:
            'The configured .sops.yaml path does not exist. Fix the "sops.configPath" setting, ' +
            'or unset it to use the default ancestor-walk discovery.',
    },
    {
        re: /unknown input type|unknown output type|invalid input type|invalid output type/i,
        explain:
            'sops rejected the input/output type. The extension picks this by content sniffing; ' +
            'if your sops version is older, update it (https://getsops.io) or re-encrypt with a known store.',
    },
    {
        re: /cannot parse|could not load input|invalid yaml|invalid json|not a valid|cannot unmarshal/i,
        explain:
            'sops could not parse the file in the expected format. The extension auto-detects the ' +
            'storage type from content, so this usually means the file is malformed or uses an unknown ' +
            'layout. Inspect the raw .sops bytes, or re-encrypt from a known-good plaintext.',
    },
    {
        re: /ETIMEDOUT|timed out|context deadline exceeded/i,
        explain:
            'sops timed out after 30 s. Check network connectivity for KMS/cloud keys, ' +
            'or ensure your age key file is accessible.',
    },
    {
        re: /Error getting data key|access denied|AccessDenied|InvalidAuthenticationToken|Could not contact KMS/i,
        explain:
            'KMS/HSM access denied. Check your cloud credentials ($AWS_PROFILE, GOOGLE_APPLICATION_CREDENTIALS, $AZURE_*). ' +
            'Use "SOPS: Show Effective Configuration" to see which env vars the extension is passing to sops.',
    },
];

function firstLine(s, max = 400) {
    const line = String(s).split(/\r?\n/).find(l => l.trim()) || String(s);
    return line.length > max ? line.slice(0, max) + '…' : line;
}

function normalize(stderr) {
    if (!stderr) return 'sops produced no error output.';
    const raw = String(stderr).trim();
    for (const { re, explain } of PATTERNS) {
        if (re.test(raw)) return `${explain}\n— sops said: ${firstLine(raw)}`;
    }
    return firstLine(raw, 500);
}

module.exports = { normalize, firstLine };
