const fs = require('fs');
const path = require('path');

// Walk up from startDir looking for .sops.yaml or .sops.yml.
// Returns the absolute path of the first match, or null if none found.
function findSopsYaml(startDir) {
    let dir = startDir;
    while (true) {
        for (const name of ['.sops.yaml', '.sops.yml']) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate)) return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

module.exports = { findSopsYaml };
