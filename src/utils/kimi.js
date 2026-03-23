const OpenAI = require('openai');
require('dotenv').config();

const kimi = new OpenAI({
    apiKey: process.env.KIMI_API_KEY,
    baseURL: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
});

// Wrapper cu tracking cost
async function callKimi(messages, model = 'kimi-k2-1', temperature = 0.3) {
    try {
        const response = await kimi.chat.completions.create({
            model: model,
            messages: messages,
            temperature: temperature,
        });

        // Estimare cost (aproximativă)
        const inputTokens = response.usage?.prompt_tokens || 0;
        const outputTokens = response.usage?.completion_tokens || 0;
        const cost = (inputTokens * 0.60 + outputTokens * 2.50) / 1000000; // $ per 1M tokens

        return {
            content: response.choices[0].message.content,
            usage: response.usage,
            cost: cost,
            role: response.choices[0].message.role
        };
    } catch (error) {
        console.error('Eroare Kimi API:', error);
        throw error;
    }
}

module.exports = { callKimi };