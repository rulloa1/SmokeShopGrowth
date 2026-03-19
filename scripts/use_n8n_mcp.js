'use strict';

const { spawn } = require('child_process');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3YzY2MzU1ZC1iZjY2LTRiOTEtYjI4Ni0zZTU1OWMzN2EyYWMiLCJpc3MiOiJuOG4iLCJhdWQiOiJtY3Atc2VydmVyLWFwaSIsImp0aSI6IjZlNTdlYTFjLWI2M2QtNDIxYy1hNzRlLTgwOTY2NDU0YTNiYyIsImlhdCI6MTc3MzM5MjE4OH0.s5RoxjWLR1B3FVDJ2zmYg5Rqa9FMhkS1ukjbtkuHBg4';
const URL = 'https://n8n.srv1488690.hstgr.cloud/mcp-server/http';

async function callMcpTool(method, params, requestId = 1) {
    return new Promise((resolve, reject) => {
        console.log(`[MCP] Calling ${method}...`);
        const child = spawn('npx', [
            '-y', 'supergateway',
            '--streamableHttp', URL,
            '--header', `authorization:Bearer ${TOKEN}`
        ], { shell: true });

        let output = '';
        child.stdout.on('data', (data) => {
            const raw = data.toString();
            output += raw;
            process.stdout.write(`[DEBUG STDOUT] ${raw}`);

            try {
                // MCP over stdio often sends one JSON per line or just contiguous JSONs
                const matches = output.match(/\{.*\}/g);
                if (matches) {
                    for (const match of matches) {
                        try {
                            const res = JSON.parse(match);
                            if (res.id === requestId || (res.id === null && res.error)) {
                                child.kill();
                                resolve(res);
                                return;
                            }
                        } catch (e) {}
                    }
                }
            } catch (e) {}
        });

        child.stderr.on('data', (data) => {
             process.stderr.write(`[DEBUG STDERR] ${data.toString()}`);
        });

        child.on('error', (err) => {
            console.error('Spawn error:', err);
            reject(err);
        });

        setTimeout(() => {
            const request = {
                jsonrpc: '2.0',
                id: requestId,
                method: method,
                params: params
            };
            console.log(`[MCP] Sending request: ${JSON.stringify(request)}`);
            child.stdin.write(JSON.stringify(request) + '\n');
        }, 3000);

        setTimeout(() => {
            child.kill();
            reject(new Error('Timeout'));
        }, 15000);
    });
}

async function run() {
    try {
        const result = await callMcpTool('listTools', {});
        console.log('\nFinal Response:', JSON.stringify(result, null, 2));
    } catch (err) {
        console.error('\nError:', err.message);
    }
}

run();
