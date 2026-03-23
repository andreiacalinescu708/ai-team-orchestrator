const { callKimi } = require('../utils/kimi');
const { query } = require('../utils/db');

class ManagerAgent {
    constructor(bot) {
        this.bot = bot; // Referință la botul Telegram pentru a răspunde
    }

    async startDiscovery(chatId, projectId, initialRequest) {
        // Salvăm proiectul
        await query(
            'UPDATE projects SET description = $1 WHERE id = $2',
            [initialRequest, projectId]
        );

        // Primul mesaj pentru a obține prima întrebare
        const messages = [
            {
                role: 'system',
                content: `Ești Manager de Proiect AI. Faci discovery pentru: "${initialRequest}"
Trebuie să aduni informații până ai 90% claritate.
Pune întrebări one-by-one, nu pe toate odată.
Când ai suficiente informații, răspunde cu [DISCOVERY_COMPLETE] și sumarul.
Primești răspunsurile userului și decizi dacă mai ai nevoie de întrebări.`
            },
            {
                role: 'user',
                content: `Cerință: ${initialRequest}\n\nPune prima întrebare esențială.`
            }
        ];

        const response = await callKimi(messages);
        
        // Salvăm în DB
        await this.saveMessage(projectId, 'assistant', response.content);
        
        // Trimitem în Telegram
        await this.bot.telegram.sendMessage(chatId, `🔍 [Discovery] ${response.content}`, {
            reply_markup: {
                inline_keyboard: [
                    [{text: '⏭️ Sari peste discovery', callback_data: `skip_discovery_${projectId}`}]
                ]
            }
        });

        return response.content;
    }

    async handleDiscoveryResponse(chatId, projectId, userResponse) {
        // Salvăm răspunsul userului
        await this.saveMessage(projectId, 'user', userResponse);

        // Luăm istoricul complet
        const result = await query(
    'SELECT role, content FROM conversations WHERE project_id = $1 ORDER BY created_at',
    [projectId]
);
const history = result.rows;
const messages = history.map(h => ({role: h.role, content: h.content}));
        
        // Adăugăm instrucțiunea de system la început
        messages.unshift({
            role: 'system',
            content: 'Continui discovery. Dacă ai toate informațiile necesare, răspunde exact cu [DISCOVERY_COMPLETE] urmat de sumar JSON.'
        });

        const response = await callKimi(messages);
        await this.saveMessage(projectId, 'manager', response.content);

        // Verificăm dacă e complet
        if (response.content.includes('[DISCOVERY_COMPLETE]')) {
            await this.completeDiscovery(chatId, projectId, response.content);
        } else {
            await this.bot.telegram.sendMessage(chatId, `❓ ${response.content}`);
        }
    }

    async completeDiscovery(chatId, projectId, completionText) {
        // Extragem sumarul (după [DISCOVERY_COMPLETE])
        const summary = completionText.split('[DISCOVERY_COMPLETE]')[1] || completionText;
        
        // Salvăm în proiect
        await query(
            'UPDATE projects SET discovery_data = $1, status = $2 WHERE id = $3',
            [JSON.stringify({summary}), 'skills_check', projectId]
        );

        await this.bot.telegram.sendMessage(chatId, 
            `✅ Discovery complet!\n\n${summary}\n\nAcum verific ce skills am nevoie...`,
            {parse_mode: 'HTML'}
        );

        // Trecem la verificare skills
        await this.checkRequiredSkills(chatId, projectId);
    }

    async checkRequiredSkills(chatId, projectId) {
        const project = await query('SELECT * FROM projects WHERE id = $1', [projectId]);
        const discovery = project.rows[0].discovery_data;

        const messages = [
            {
                role: 'system',
                content: `Analizează cerința și determină ce skill-uri sunt necesare din lista:
- write_file (scriere fișiere)
- read_file (citire fișiere)  
- query_database (PostgreSQL)
- generate_react_component (UI React)
- create_express_route (API Node.js)
- web_scraper (extragere web - dacă e cazul)
- excel_generator (dacă generezi Excel)
- email_sender (dacă trimite email)

Răspunde JSON: {"required": ["skill1", "skill2"], "reasoning": "pentru că..."}`
            },
            {
                role: 'user',
                content: JSON.stringify(discovery)
            }
        ];

        const analysis = await callKimi(messages);
        const required = JSON.parse(analysis.content).required;

        // Verificăm ce avem în DB
        const available = await query('SELECT name FROM skills WHERE status = $1', ['active']);
        const availableNames = available.rows.map(r => r.name);
        
        const missing = required.filter(r => !availableNames.includes(r));

        if (missing.length === 0) {
            await this.bot.telegram.sendMessage(chatId, 
                `✅ Am toate skill-urile necesare: ${required.join(', ')}`
            );
            await this.createPlan(chatId, projectId);
        } else {
            await this.bot.telegram.sendMessage(chatId,
                `⚠️ Lipsesc skill-uri: ${missing.join(', ')}\n\n` +
                `Ce facem?\n` +
                `1. Folosim variante alternative disponibile\n` +
                `2. Tu adaugi manual skill-urile în Dashboard\n` +
                `3. Simplificăm cerința`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: '🔧 Folosește alternative', callback_data: `adapt_skills_${projectId}`}],
                            [{text: '➕ Adaug eu skill-uri', callback_data: `manual_skills_${projectId}`}],
                            [{text: '✂️ Simplifică', callback_data: `simplify_${projectId}`}]
                        ]
                    }
                }
            );
        }
    }

    async createPlan(chatId, projectId) {
        await this.bot.telegram.sendMessage(chatId, '📋 Creez planul de execuție...');
        
        // Aici va fi logica de planificare cu cei 5 workers
        // Pentru MVP, facem un plan simplu secvențial
        
        const plan = [
            {step: 1, worker: 'architect', task: 'Proiectează schema DB', status: 'pending'},
            {step: 2, worker: 'backend', task: 'Generează API Express', status: 'pending'},
            {step: 3, worker: 'frontend', task: 'Crează componente React', status: 'pending'},
            {step: 4, worker: 'devops', task: 'Configurare deploy', status: 'pending'}
        ];

        await query(
            'UPDATE projects SET status = $1 WHERE id = $2',
            ['ready_to_execute', projectId]
        );

        await this.bot.telegram.sendMessage(chatId,
            `✅ Plan creat:\n\n` +
            plan.map(p => `${p.step}. ${p.worker}: ${p.task}`).join('\n') +
            `\n\nStart execuție?`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{text: '🚀 START', callback_data: `start_execution_${projectId}`}],
                        [{text: '✏️ Modifică plan', callback_data: `modify_plan_${projectId}`}]
                    ]
                }
            }
        );
    }

    async saveMessage(projectId, role, content, metadata = {}) {
        await query(
            'INSERT INTO conversations (project_id, role, content, metadata) VALUES ($1, $2, $3, $4)',
            [projectId, role, content, JSON.stringify(metadata)]
        );
    }
}

module.exports = { ManagerAgent };