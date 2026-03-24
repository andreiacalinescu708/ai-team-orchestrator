const OpenAI = require('openai');
require('dotenv').config();

const kimi = new OpenAI({
    apiKey: process.env.KIMI_API_KEY,
    baseURL: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    timeout: 120000,
    maxRetries: 0,
});

// Modele - FAST pentru conversație, THINKING pentru cod
const MODELS = {
    FAST: 'moonshot-v1-8k',      // Rapid pentru conversație (1-3s)
    THINKING: 'kimi-k2.5',       // Lent pentru cod (10-30s)
    FALLBACK: 'moonshot-v1-32k'  // Backup
};

/**
 * Apel API cu model potrivit pentru task
 */
async function callKimi(messages, model = MODELS.FAST, temperature = 0.7, maxRetries = 2) {
    const modelsToTry = [model, MODELS.FALLBACK];
    let lastError;
    
    for (const currentModel of modelsToTry) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🤖 API ${currentModel} (attempt ${attempt + 1})`);
                
                // k2.5 acceptă doar temp=1, moonshot acceptă orice
                const effectiveTemp = currentModel.includes('k2.5') ? 1 : temperature;
                
                const startTime = Date.now();
                const response = await kimi.chat.completions.create({
                    model: currentModel,
                    messages: messages,
                    temperature: effectiveTemp,
                    max_tokens: 2048, // Limităm pentru viteză
                });
                const duration = Date.now() - startTime;
                
                console.log(`✅ ${currentModel} în ${duration}ms`);
                
                return {
                    content: response.choices[0].message.content,
                    usage: response.usage,
                    cost: 0,
                    role: response.choices[0].message.role,
                    model: currentModel,
                    duration
                };
                
            } catch (error) {
                lastError = error;
                console.error(`❌ ${currentModel}:`, error.message);
                
                // 429 = rate limit, așteptăm mai mult
                if (error.status === 429) {
                    const delay = (attempt + 1) * 5000; // 5s, 10s, 15s
                    console.log(`⏳ Rate limit, aștept ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue; // Reîncercăm același model
                }
                
                if (error.status === 404) {
                    break; // Model indisponibil, trecem la următorul
                }
                
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
                }
            }
        }
    }
    
    // Fallback final - informăm userul clar
    console.error('❌ Toate modelele au eșuat după multiple încercări');
    return {
        content: '⏳ <b>API Kimi este supraîncărcat</b>\n\nToate modelele sunt ocupate momentan. Te rog să:\n1. Aștepți 30 de secunde\n2. Încerci din nou\n\nDacă problema persistă, încearcă mai târziu.',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        cost: 0,
        role: 'assistant',
        model: 'fallback',
        isError: true,
        error: lastError?.message
    };
}

/**
 * Conversație rapidă (model moonshot-v1-8k)
 */
async function callKimiFast(messages, temperature = 0.7) {
    return callKimi(messages, MODELS.FAST, temperature, 1);
}

/**
 * Generare cod (model k2.5 - mai lent)
 */
async function callKimiThinking(messages, temperature = 1) {
    return callKimi(messages, MODELS.THINKING, temperature, 2);
}

module.exports = {
    callKimi,
    callKimiFast,
    callKimiThinking,
    MODELS
};
