const { callKimiFast } = require('../utils/kimi-optimized');

/**
 * CommandParser - Parsează limbaj natural în acțiuni structurate
 */
class CommandParser {
    constructor() {
        // Patterns pentru recunoaștere rapidă (fără AI)
        this.patterns = {
            deploy: /deploy|publica|pune pe|lansare/i,
            logs: /log|jurnal|vezi erori|debug/i,
            test: /test|verifica|ruleaza test/i,
            env: /variabila|env|seteaza|configureaza/i,
            database: /baza de date|database|creaza tabela/i,
            // github: eliminat - AI va decide când e o comandă GitHub reală vs conversație
            download: /download|descarc[aă]|salveaz[aă]|zip|export/i,
            pdf: /pdf|extrage|factura|raport|document/i,
            restart: /restart|reporneste|reincarca/i,
            status: /status|stare|cum merge|info/i,
            scale: /scale|scalare|instanțe|replici/i
        };
    }

    /**
     * Parsează un mesaj și returnează intenția
     */
    async parse(message) {
        // 1. Încercăm pattern matching rapid
        const intent = this.matchPattern(message);
        
        if (intent) {
            return intent;
        }

        // 2. Fallback la AI pentru comenzi complexe
        return await this.parseWithAI(message);
    }

    /**
     * Pattern matching rapid
     */
    matchPattern(message) {
        const lowerMsg = message.toLowerCase();

        // Verificăm dacă e o întrebare conversațională (nu comandă)
        const conversationalWords = /\bce|cum|cine|unde|care|cat|de ce\b/i;
        const isConversational = conversationalWords.test(message);
        
        // Dacă e întrebare despre proiect, nu comandă
        if (isConversational && !message.match(/\b(status|deploy|logs|test|github)\b/i)) {
            return null;
        }

        // Deploy
        if (this.patterns.deploy.test(message)) {
            const platform = this.extractPlatform(message);
            return {
                type: 'deploy',
                platform: platform || 'railway',
                confirmation: true,
                description: `Deploy pe ${platform || 'Railway'}`
            };
        }

        // Logs
        if (this.patterns.logs.test(message)) {
            const service = this.extractService(message);
            return {
                type: 'logs',
                service: service || 'backend',
                confirmation: false,
                description: `Vezi logs pentru ${service || 'backend'}`
            };
        }

        // Status
        if (this.patterns.status.test(message)) {
            return {
                type: 'status',
                confirmation: false,
                description: 'Verificare status servicii'
            };
        }

        // Test
        if (this.patterns.test.test(message)) {
            return {
                type: 'test',
                confirmation: false,
                description: 'Rulează teste'
            };
        }

        // Environment variables
        if (this.patterns.env.test(message)) {
            const { key, value } = this.extractEnvVar(message);
            return {
                type: 'env',
                key,
                value,
                confirmation: true,
                description: key ? `Setează ${key}=${value}` : 'Configurează variabile'
            };
        }

        // Database
        if (this.patterns.database.test(message)) {
            return {
                type: 'database',
                action: 'create',
                confirmation: true,
                description: 'Creare/Modificare bază de date'
            };
        }

        // Download
        if (this.patterns.download.test(message)) {
            const type = message.includes('structur') ? 'structure' :
                        message.includes('fișier') || message.includes('file') ? 'file' : 'zip';
            
            return {
                type: 'download',
                downloadType: type,
                confirmation: false,
                description: type === 'zip' ? 'Descarcă proiect ca ZIP' :
                           type === 'structure' ? 'Vezi structura proiectului' :
                           'Descarcă fișier specific'
            };
        }

        // PDF Processing
        if (this.patterns.pdf.test(message)) {
            const action = message.includes('extrage') ? 'extract' :
                          message.includes('rezumat') || message.includes('sumarizeaz') ? 'summarize' :
                          message.includes('genereaz') || message.includes('creaz') ? 'generate' :
                          message.includes('tabel') ? 'tables' : 'extract';
            
            return {
                type: 'pdf',
                action: action,
                confirmation: false,
                description: action === 'extract' ? 'Extrage date din PDF' :
                           action === 'summarize' ? 'Rezumă document PDF' :
                           action === 'generate' ? 'Generează PDF nou' :
                           'Extrage tabele din PDF'
            };
        }

        // Restart
        if (this.patterns.restart.test(message)) {
            const service = this.extractService(message);
            return {
                type: 'restart',
                service: service || 'all',
                confirmation: true,
                description: `Restart ${service || 'toate serviciile'}`
            };
        }

        return null;
    }

    /**
     * Extrage platforma din mesaj
     */
    extractPlatform(message) {
        const platforms = ['railway', 'vercel', 'heroku', 'aws', 'digitalocean'];
        const lower = message.toLowerCase();
        return platforms.find(p => lower.includes(p));
    }

    /**
     * Extrage serviciul din mesaj
     */
    extractService(message) {
        const services = ['backend', 'frontend', 'database', 'postgres', 'redis'];
        const lower = message.toLowerCase();
        return services.find(s => lower.includes(s));
    }

    /**
     * Extrage variabila de mediu din mesaj
     */
    extractEnvVar(message) {
        // Pattern: "seteaza KEY=value" sau "variabila KEY e value"
        const setMatch = message.match(/(?:seteaz[aă]|configureaz[aă]|variabila)\s+(\w+)\s*(?:=|la|este|e)\s*([^\s]+)/i);
        if (setMatch) {
            return { key: setMatch[1], value: setMatch[2] };
        }
        
        // Pattern: "JWT_SECRET=abc123"
        const envMatch = message.match(/(\w+)\s*=\s*([^\s]+)/);
        if (envMatch) {
            return { key: envMatch[1], value: envMatch[2] };
        }

        return { key: null, value: null };
    }

    /**
     * Parsează cu AI pentru comenzi complexe
     */
    async parseWithAI(message) {
        const prompt = [
            {
                role: 'system',
                content: `Ești un parser de comenzi. Analizează mesajul și extrage intenția.

Tipuri posibile: deploy, logs, test, env, database, github, download, pdf, restart, status, scale, unknown

Pentru 'github', include și 'action': 'push|pr|init|status'
Pentru 'pdf', include și 'action': 'extract|summarize|generate|tables'
Pentru 'download', include și 'downloadType': 'zip|structure|file'

IMPORTANT: Dacă mesajul este conversație normală (ex: "ce zici de...", "cum facem...", "putem face..."), returnează type: "unknown"

Răspunde cu JSON:
{
  "type": "tipul_comenzii",
  "action": "pentru github/pdf",
  "platform": "railway|vercel|etc (pentru deploy)",
  "service": "backend|frontend|database (dacă e specificat)",
  "confirmation": true|false (true pentru acțiuni distructive),
  "description": "Descriere prietenoasă",
  "parameters": {} // parametri extra
}`
            },
            {
                role: 'user',
                content: message
            }
        ];

        try {
            const response = await callKimiFast(prompt, 0.3);
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error('Eroare parsing AI:', e);
        }

        return {
            type: 'unknown',
            confirmation: false,
            description: 'Nu am înțeles comanda'
        };
    }
}

module.exports = { CommandParser };
