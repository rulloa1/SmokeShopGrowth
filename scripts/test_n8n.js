'use strict';

require('dotenv').config();
const n8nService = require('../src/node/n8n_service');

async function testIntegration() {
    console.log('--- Testing n8n Integration ---');
    console.log('N8N_API_URL:', process.env.N8N_API_URL);
    
    // 1. Test Pipeline Event
    console.log('\n1. Sending mock pipeline "started" event...');
    await n8nService.notifyPipelineEvent('test_started', {
        jobId: 'test-job-123',
        city: 'Miami',
        bizType: 'Smoke Shop'
    });

    // 2. Test New Lead
    console.log('\n2. Sending mock new lead event...');
    await n8nService.notifyNewLead({
        contactName: 'Test User',
        email: 'test@example.com',
        phone: '1234567890',
        businessName: 'The Cloud Shop'
    });

    // 3. Test Call Outcome
    console.log('\n3. Sending mock call outcome event...');
    await n8nService.notifyCallOutcome({
        business_name: 'The Cloud Shop',
        phone: '1234567890',
        outcome: 'completed',
        summary: 'Interested in premium SEO package'
    });

    console.log('\n--- Test Finish ---');
    console.log('Note: If webhook URLs are not set in .env, notifications will be skipped.');
}

testIntegration().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
