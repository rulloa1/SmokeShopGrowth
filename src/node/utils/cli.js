'use strict';

/**
 * Shared CLI argument parser.
 *
 *   const { getArg, hasFlag } = require('./utils/cli');
 *   const input = getArg('--input', 'default.csv');
 *   const dryRun = hasFlag('--dry-run');
 */

const args = process.argv.slice(2);

function getArg(flag, def) {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
}

function hasFlag(flag) {
    return args.includes(flag);
}

module.exports = { getArg, hasFlag, args };
