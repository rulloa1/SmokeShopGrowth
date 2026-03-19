'use strict';

const axios = require('axios');

const URL = 'https://n8n.srv1488690.hstgr.cloud/mcp-server/http';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3YzY2MzU1ZC1iZjY2LTRiOTEtYjI4Ni0zZTU1OWMzN2EyYWMiLCJpc3MiOiJuOG4iLCJhdWQiOiJtY3Atc2VydmVyLWFwaSIsImp0aSI6IjZlNTdlYTFjLWI2M2QtNDIxYy1hNzRlLTgwOTY2NDU0YTNiYyIsImlhdCI6MTc3MzM5MjE4OH0.s5RoxjWLR1B3FVDJ2zmYg5Rqa9FMhkS1ukjbtkuHBg4';

async function listTools() {
    try {
        console.log('Sending listTools request...');
        const response = await axios.post(URL, {
            jsonrpc: '2.0',
            id: 1,
            method: 'listTools',
            params: {}
        }, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (err) {
        console.error('Error:', err.response?.data || err.message);
        if (err.response?.status === 301 || err.response?.status === 302) {
             console.log('Redirecting to:', err.response.headers.location);
        }
    }
}

listTools();
