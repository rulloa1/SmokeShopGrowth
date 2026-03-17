'use strict';

function log(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${ts}] ${msg}`);
}

function error(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.error(`[${ts}] [ERROR] ${msg}`);
}

function warn(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.warn(`[${ts}] [WARN] ${msg}`);
}

function debug(msg) {
    if (process.env.DEBUG) {
        const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
        console.log(`[${ts}] [DEBUG] ${msg}`);
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = { log, error, warn, debug, sleep };
