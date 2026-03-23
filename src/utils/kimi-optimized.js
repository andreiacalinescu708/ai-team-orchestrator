const OpenAI = require('openai');
require('dotenv').config();

const kimi = new OpenAI({
    apiKey: process.env.KIMI_API_KEY,
    baseURL: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    timeout: 60000, // 60s timeout
    maxRetries: 2,
});

// Modele disponibile
const MODELS = {
    FAST: 'kimi-k2',        // Răspuns rapid pentru conversație
    THINKING: 'kimi-k2-thinking',  // Generare cod
    LONG: 'kimi-k2-72k'     // Context lung
};

/**
 * Wrapper cu tracking cost și optimizări
 * @param {Array} messages - Mesajele pentru LLM
 * @param {string} model - Modelul de folosit
 * @param {number} temperature - Temperatura pentru generare
 * @param {number} maxRetries - Număr de retry-uri
 */
async function callKimi(messages, model = MODELS.THINKING, temperature = 0.3, maxRetries = 2) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
                role: response.choices[0].message.role,
                model: model
            };
        } catch (error) {
            lastError = error;
            console.error(`Eroare Kimi API (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);
            
            if (attempt < maxRetries) {
                // Exponential backoff: 1s, 2s
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`Retry în ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError;
}

/**
 * Apel rapid pentru conversație (folosește modelul FAST)
 */
async function callKimiFast(messages, temperature = 0.5) {
    return callKimi(messages, MODELS.FAST, temperature, 1);
}

/**
 * Apel pentru generare cod (folosește modelul THINKING)
 */
async function callKimiThinking(messages, temperature = 0.3) {
    return callKimi(messages, MODELS.THINKING, temperature, 2);
}

module.exports = {
    callKimi,
    callKimiFast,
    callKimiThinking,
    MODELS
};
