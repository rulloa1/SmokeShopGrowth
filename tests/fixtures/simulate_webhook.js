const axios = require('axios');

async function simulateWebhook() {
    const payload = {
        message: {
            type: 'end-of-call-report',
            call: {
                id: 'test_call_123',
                customer: { number: '+15550001234', name: 'Test Smoke Shop' },
                metadata: { business_name: 'Test Smoke Shop', city: 'Houston' },
                startedAt: new Date(Date.now() - 60000).toISOString(),
                endedAt: new Date().toISOString()
            },
            analysis: {
                summary: 'The user was interested and provided their email address: test@example.com',
                successEvaluation: 'success'
            },
            artifact: {
                messages: [
                    { role: 'assistant', content: 'What email should I send it to?' },
                    { role: 'user', content: 'Send it to test@example.com please.' }
                ]
            }
        }
    };

    try {
        console.log('Sending mock Vapi webhook to http://localhost:3000/webhook/vapi...');
        const res = await axios.post('http://localhost:3000/webhook/vapi', payload);
        console.log('Response Status:', res.status);
        console.log('Response Data:', res.data);
    } catch (err) {
        console.error('Error sending webhook:', err.message);
        if (err.response) {
            console.error('Response:', err.response.data);
        }
    }
}

simulateWebhook();
