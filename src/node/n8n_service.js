'use strict';

const axios = require('axios');

/**
 * N8NService
 * ==========
 * Sends lead generation and pipeline events to n8n webhooks for automation.
 */
class N8NService {
    constructor() {
        this.apiKey = process.env.N8N_API_KEY;
        this.baseUrl = process.env.N8N_API_URL;
        this.pipelineWebhook = process.env.N8N_PIPELINE_WEBHOOK;
        this.leadWebhook = process.env.N8N_LEAD_WEBHOOK;
        this.callWebhook = process.env.N8N_CALL_WEBHOOK;
    }

    /**
     * Notify n8n of a pipeline event (start, step completion, or failure).
     */
    async notifyPipelineEvent(event, data = {}) {
        if (!this.pipelineWebhook) {
            console.log(`[n8n] Skip pipeline event: N8N_PIPELINE_WEBHOOK not set.`);
            return;
        }
        
        try {
            await axios.post(this.pipelineWebhook, {
                event,
                timestamp: new Date().toISOString(),
                ...data
            }, {
                headers: this._getHeaders()
            });
            console.log(`[n8n] Pipeline event "${event}" sent.`);
        } catch (err) {
            console.error(`[n8n] Failed to send pipeline event: ${err.message}`);
        }
    }

    /**
     * Notify n8n when a new lead is captured via the demo submit form.
     */
    async notifyNewLead(leadData) {
        if (!this.leadWebhook) {
            console.log(`[n8n] Skip lead notification: N8N_LEAD_WEBHOOK not set.`);
            return;
        }

        try {
            await axios.post(this.leadWebhook, {
                event: 'new_lead_captured',
                timestamp: new Date().toISOString(),
                lead: leadData
            }, {
                headers: this._getHeaders()
            });
            console.log(`[n8n] New lead notification sent for ${leadData.email}`);
        } catch (err) {
            console.error(`[n8n] Failed to send lead notification: ${err.message}`);
        }
    }

    /**
     * Notify n8n of a Vapi call outcome/summary.
     */
    async notifyCallOutcome(payload) {
        if (!this.callWebhook) {
            console.log(`[n8n] Skip call outcome: N8N_CALL_WEBHOOK not set.`);
            return;
        }

        try {
            await axios.post(this.callWebhook, {
                event: 'vapi_call_outcome',
                timestamp: new Date().toISOString(),
                ...payload
            }, {
                headers: this._getHeaders()
            });
            console.log(`[n8n] Call outcome notification sent for ${payload.business_name}`);
        } catch (err) {
            console.error(`[n8n] Failed to send call outcome: ${err.message}`);
        }
    }

    _getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }
}

module.exports = new N8NService();
