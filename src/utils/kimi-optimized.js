const OpenAI = require('openai');
require('dotenv').config();

const kimi = new OpenAI({
    apiKey: process.env.KIMI_API_KEY,
    baseURL: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    timeout: 60000,
    maxRetries: 0, // Gestionăm noi retry-urile
});

// Modele disponibile - fallback dacă primul eșuează
const MODELS = {
    FAST: ['kimi-latest', 'kimi-k2-thinking', 'moonshot-v1-8k'],
    THINKING: ['kimi-k2-thinking', 'kimi-latest', 'moonshot-v1-32k'],
    LONG: ['kimi-k2-72k', 'moonshot-v1-128k']
};

/**
 * Wrapper cu tracking cost și optimizări
 */
async function callKimi(messages, modelList = MODELS.THINKING, temperature = 0.3, maxRetries = 2) {
    // Asigurăm că avem un array de modele
    const models = Array.isArray(modelList) ? modelList : [modelList];
    
    let lastError;
    
    // Încercăm fiecare model din listă
    for (const model of models) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🤖 Apel API cu model: ${model} (attempt ${attempt + 1})`);
                
                const response = await kimi.chat.completions.create({
                    model: model,
                    messages: messages,
                    temperature: temperature,
                });

                // Estimare cost
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
                
                // Dacă e 404 (model not found), trecem la următorul model imediat
                if (error.status === 404 || error.error?.type === 'resource_not_found_error') {
                    console.log(`⏭️ Model ${model} indisponibil, încerc alt model...`);
                    break; // Ieșim din loop-ul de retry și trecem la următorul model
                }
                
                // Alte erori - retry cu backoff
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000;
                    console.log(`🔄 Retry în ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
    }
    
    // Toate modelele au eșuat
    throw new Error(`Toate modelele au eșuat. Ultima eroare: ${lastError.message}`);
}

/**
 * Apel rapid pentru conversație
 */
async function callKimiFast(messages, temperature = 0.5) {
    return callKimi(messages, MODELS.FAST, temperature, 1);
}

/**
 * Apel pentru generare cod
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
