const OpenAI = require('openai');
require('dotenv').config();

const kimi = new OpenAI({
    apiKey: process.env.KIMI_API_KEY,
    baseURL: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    timeout: 120000, // 120s pentru thinking
    maxRetries: 0,
});

// Modele disponibile Kimi (Moonshot AI) - conform documentație oficială
const MODELS = {
    // Model principal k2.5
    FAST: 'kimi-k2.5',
    
    // Pentru generare cod (k2.5 cu thinking activat by default)
    THINKING: 'kimi-k2.5',
    
    // Fallback dacă k2.5 nu e disponibil
    FALLBACK: 'moonshot-v1-32k'
};

// Delay între request-uri pentru rate limiting
let lastRequestTime = 0;
const MIN_DELAY_MS = 1000; // Minim 1s între request-uri

/**
 * Așteaptă dacă e necesar pentru rate limiting
 */
async function rateLimitDelay() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < MIN_DELAY_MS) {
        const waitTime = MIN_DELAY_MS - timeSinceLastRequest;
        console.log(`⏱️ Rate limiting: aștept ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastRequestTime = Date.now();
}

/**
 * Wrapper cu tracking cost și optimizări
 */
async function callKimi(messages, model = MODELS.THINKING, temperature = 0.3, maxRetries = 3) {
    await rateLimitDelay();
    
    const modelsToTry = [model, MODELS.FALLBACK];
    let lastError;
    
    for (const currentModel of modelsToTry) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🤖 Apel API cu model: ${currentModel} (attempt ${attempt + 1})`);
                
                // k2.5 acceptă doar temperature=1
                const effectiveTemp = currentModel.includes('k2.5') ? 1 : temperature;
                
                const response = await kimi.chat.completions.create({
                    model: currentModel,
                    messages: messages,
                    temperature: effectiveTemp,
                    max_tokens: 4096,
                });

                const inputTokens = response.usage?.prompt_tokens || 0;
                const outputTokens = response.usage?.completion_tokens || 0;
                const cost = (inputTokens * 0.60 + outputTokens * 2.50) / 1000000;

                console.log(`✅ Succes cu model: ${currentModel}, tokens: ${inputTokens}+${outputTokens}`);
                
                return {
                    content: response.choices[0].message.content,
                    usage: response.usage,
                    cost: cost,
                    role: response.choices[0].message.role,
                    model: currentModel
                };
                
            } catch (error) {
                lastError = error;
                console.error(`❌ Eroare ${currentModel} (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);
                
                // Rate limit (429) sau model indisponibil - trecem la următorul model
                if (error.status === 429 || error.status === 404) {
                    console.log(`⏭️ Model ${currentModel} supraîncărcat/indisponibil (${error.status}), încerc fallback...`);
                    break; // Ieșim din loop-ul de retry și trecem la următorul model
                }
                
                // Alte erori - retry cu backoff crescut
                if (attempt < maxRetries) {
                    const delay = (attempt + 1) * 5000; // 5s, 10s, 15s
                    console.log(`🔄 Retry în ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
    }
    
    // Toate modelele au eșuat - returnăm un răspuns de fallback pentru a nu bloca userul
    console.error('❌ Toate modelele au eșuat, returnez fallback');
    
    // Pentru conversații simple, returnăm un răspuns generic
    return {
        content: 'Îmi pare rău, serviciul AI este momentan supraîncărcat. Te rog să încerci din nou în câteva secunde.',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        cost: 0,
        role: 'assistant',
        model: 'fallback',
        error: lastError.message
    };
}

async function callKimiFast(messages, temperature = 0.5) {
    return callKimi(messages, MODELS.FAST, temperature, 2);
}

async function callKimiThinking(messages, temperature = 0.3) {
    return callKimi(messages, MODELS.THINKING, temperature, 3);
}

module.exports = {
    callKimi,
    callKimiFast,
    callKimiThinking,
    MODELS
};
