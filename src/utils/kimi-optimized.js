const OpenAI = require('openai');
require('dotenv').config();

const kimi = new OpenAI({
    apiKey: process.env.KIMI_API_KEY,
    baseURL: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    timeout: 60000,
    maxRetries: 0,
});

// Modele disponibile Kimi (Moonshot AI)
const MODELS = {
    // Modele standard (8k context) - pentru conversație rapidă
    FAST: ['moonshot-v1-8k', 'moonshot-v1-32k'],
    
    // Modele pentru generare cod (32k context) - mai puternice
    THINKING: ['moonshot-v1-32k', 'moonshot-v1-8k'],
    
    // Modele cu context lung (128k)
    LONG: ['moonshot-v1-128k', 'moonshot-v1-32k']
};

/**
 * Wrapper cu tracking cost și optimizări
 */
async function callKimi(messages, modelList = MODELS.THINKING, temperature = 0.3, maxRetries = 2) {
    const models = Array.isArray(modelList) ? modelList : [modelList];
    
    let lastError;
    
    for (const model of models) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🤖 Apel API cu model: ${model} (attempt ${attempt + 1})`);
                
                const response = await kimi.chat.completions.create({
                    model: model,
                    messages: messages,
                    temperature: temperature,
                });

                const inputTokens = response.usage?.prompt_tokens || 0;
                const outputTokens = response.usage?.completion_tokens || 0;
                const cost = (inputTokens * 0.60 + outputTokens * 2.50) / 1000000;

                console.log(`✅ Succes cu model: ${model}`);
                
                return {
                    content: response.choices[0].message.content,
                    usage: response.usage,
                    cost: cost,
                    role: response.choices[0].message.role,
                    model: model
                };
                
            } catch (error) {
                lastError = error;
                console.error(`❌ Eroare ${model} (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);
                
                if (error.status === 404 || error.error?.type === 'resource_not_found_error') {
                    console.log(`⏭️ Model ${model} indisponibil, încerc alt model...`);
                    break;
                }
                
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000;
                    console.log(`🔄 Retry în ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
    }
    
    throw new Error(`Toate modelele au eșuat. Ultima eroare: ${lastError.message}`);
}

async function callKimiFast(messages, temperature = 0.5) {
    return callKimi(messages, MODELS.FAST, temperature, 1);
}

async function callKimiThinking(messages, temperature = 0.3) {
    return callKimi(messages, MODELS.THINKING, temperature, 2);
}

module.exports = {
    callKimi,
    callKimiFast,
    callKimiThinking,
    MODELS
};
