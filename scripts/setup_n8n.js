'use strict';

require('dotenv').config();
const axios = require('axios');

const N8N_API_URL = process.env.N8N_API_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;

// Use the Bearer token provided by the user if different from N8N_API_KEY
// The user provided: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
const TOKEN = N8N_API_KEY; 

async function createWorkflow(name, path) {
    const payload = {
        name: `SmokeShopGrowth - ${name}`,
        nodes: [
            {
                parameters: {
                    httpMethod: 'POST',
                    path: path,
                    options: {}
                },
                id: `webhook-${path}`,
                name: 'Webhook',
                type: 'n8n-nodes-base.webhook',
                typeVersion: 1,
                position: [250, 300],
                webhookId: `webhook-${path}`
            },
            {
                parameters: {
                    respondWith: 'text',
                    responseBody: '{"success": true}',
                    options: {}
                },
                id: `respond-${path}`,
                name: 'Respond to Webhook',
                type: 'n8n-nodes-base.respondToWebhook',
                typeVersion: 1,
                position: [500, 300]
            }
        ],
        connections: {
            Webhook: {
                main: [
                    [
                        {
                            node: 'Respond to Webhook',
                            type: 'main',
                            index: 0
                        }
                    ]
                ]
            }
        },
        active: true,
        settings: {}
    };

    try {
        const response = await axios.post(`${N8N_API_URL}/api/v1/workflows`, payload, {
            headers: {
                'X-N8N-API-KEY': TOKEN,
                'Content-Type': 'application/json'
            }
        });
        console.log(`[n8n] Created workflow: ${name}`);
        return response.data;
    } catch (err) {
        // Try Bearer Auth if X-N8N-API-KEY fails
        try {
            const response = await axios.post(`${N8N_API_URL}/api/v1/workflows`, payload, {
                headers: {
                    'Authorization': `Bearer ${TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`[n8n] Created workflow (Bearer): ${name}`);
            return response.data;
        } catch (err2) {
            console.error(`[n8n] Failed to create workflow ${name}: ${err2.response?.data?.message || err2.message}`);
            return null;
        }
    }
}

async function setup() {
    if (!N8N_API_URL || !TOKEN) {
        console.error('N8N_API_URL or N8N_API_KEY (token) missing in .env');
        return;
    }

    console.log(`Using n8n at: ${N8N_API_URL}`);

    const pipeline = await createWorkflow('Pipeline Tracking', 'smokeshop-pipeline');
    const lead = await createWorkflow('Lead Capture', 'smokeshop-lead');
    const call = await createWorkflow('Call Outcomes', 'smokeshop-call');

    console.log('\n--- Setup Complete ---');
    if (pipeline || lead || call) {
        console.log('Update your .env with these URLs:');
        if (pipeline) console.log(`N8N_PIPELINE_WEBHOOK=${N8N_API_URL}/webhook/smokeshop-pipeline`);
        if (lead) console.log(`N8N_LEAD_WEBHOOK=${N8N_API_URL}/webhook/smokeshop-lead`);
        if (call) console.log(`N8N_CALL_WEBHOOK=${N8N_API_URL}/webhook/smokeshop-call`);
    }
}

setup();
