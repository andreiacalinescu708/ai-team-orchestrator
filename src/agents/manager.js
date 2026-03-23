const { callKimiFast, callKimiThinking } = require('../utils/kimi-optimized');
const { query } = require('../utils/db');
const { PlanExecutor } = require('../executor');
const { Logger } = require('../utils/logger');
const { SkillManagerAgent } = require('./skill-manager');

const logger = new Logger('ManagerAgent');

/**
 * Manager Agent
 * Orchestrază întregul proces de discovery și execuție
 */
class ManagerAgent {
    constructor(bot) {
        this.bot = bot;
    }

    /**
     * Pornește faza de discovery
     */
    async startDiscovery(chatId, projectId, initialRequest) {
        await logger.info('Începe discovery', { projectId, chatId });

        // Salvăm proiectul
        await query(
            'UPDATE projects SET description = $1 WHERE id = $2',
            [initialRequest, projectId]
        );

        // Folosim modelul FAST pentru răspuns rapid
        const messages = [
            {
                role: 'system',
                content: `Ești Manager de Proiect AI. Faci discovery pentru: "${initialRequest}"
Trebuie să aduni informații până ai claritate suficientă.
Pune întrebări one-by-one, nu pe toate odată.
Fii concis și direct.
Când ai suficiente informații, răspunde cu [DISCOVERY_COMPLETE] și sumarul.`
            },
            {
                role: 'user',
                content: `Cerință: ${initialRequest}\n\nPune prima întrebare esențială.`
            }
        ];

        const response = await callKimiFast(messages);
        
        // Salvăm în DB
        await this.saveMessage(projectId, 'assistant', response.content);
        
        // Trimitem în Telegram
        await this.bot.telegram.sendMessage(chatId, `🔍 ${response.content}`, {
            reply_markup: {
                inline_keyboard: [
                    [{text: '⏭️ Sari peste discovery', callback_data: `skip_discovery_${projectId}`}]
                ]
            }
        });

        return response.content;
    }

    /**
     * Procesează răspunsul utilizatorului în faza discovery
     */
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
            content: 'Continui discovery. Dacă ai toate informațiile necesare, răspunde exact cu [DISCOVERY_COMPLETE] urmat de sumar JSON cu: appType, techStack, entities, features.'
        });

        // Afișăm typing indicator
        await this.bot.telegram.sendChatAction(chatId, 'typing');

        const response = await callKimiFast(messages);
        await this.saveMessage(projectId, 'assistant', response.content);

        // Verificăm dacă e complet
        if (response.content.includes('[DISCOVERY_COMPLETE]')) {
            await this.completeDiscovery(chatId, projectId, response.content);
        } else {
            await this.bot.telegram.sendMessage(chatId, `❓ ${response.content}`);
        }
    }

    /**
     * Finalizează faza discovery
     */
    async completeDiscovery(chatId, projectId, completionText) {
        await logger.info('Discovery complet', { projectId });

        // Extragem sumarul
        const summary = completionText.split('[DISCOVERY_COMPLETE]')[1] || completionText;
        
        // Parsăm JSON-ul dacă există
        let discoveryData;
        try {
            const jsonMatch = summary.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                discoveryData = JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            discoveryData = { summary: summary.trim() };
        }
        
        // Salvăm în proiect
        await query(
            'UPDATE projects SET discovery_data = $1, status = $2 WHERE id = $3',
            [JSON.stringify(discoveryData), 'skills_check', projectId]
        );

        await this.bot.telegram.sendMessage(chatId, 
            `✅ Discovery complet!\n\n<b>Sumar:</b>\n${summary.substring(0, 500)}${summary.length > 500 ? '...' : ''}\n\n` +
            `Analizez skills necesare...`,
            { parse_mode: 'HTML' }
        );

        // Verificăm skills necesare
        await this.checkRequiredSkills(chatId, projectId, discoveryData);
    }

    /**
     * Verifică skills necesare și propune generarea automată
     */
    async checkRequiredSkills(chatId, projectId, discoveryData) {
        const skillManager = new SkillManagerAgent(this.bot);
        
        try {
            const analysis = await skillManager.analyzeRequirements(discoveryData);
            
            if (analysis.missing.length > 0) {
                // Avem skills lipsă - oferim opțiuni
                await skillManager.handleMissingSkills(chatId, projectId, analysis);
            } else {
                // Toate skills sunt disponibile
                await this.bot.telegram.sendMessage(chatId, 
                    `✅ Toate skills sunt disponibile!\n\nPornim execuția?`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{text: '🚀 START', callback_data: `start_execution_${projectId}`}]
                            ]
                        }
                    }
                );
            }
        } catch (error) {
            await logger.error('Eroare verificare skills', { projectId, error: error.message });
            // Continuăm chiar dacă verificarea eșuează
            await this.bot.telegram.sendMessage(chatId, 
                `⚠️ Nu am putut verifica skills, dar continuăm cu execuția.`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: '🚀 START', callback_data: `start_execution_${projectId}`}]
                        ]
                    }
                }
            );
        }
    }

    /**
     * Pornește execuția planului
     */
    async startExecution(chatId, projectId) {
        await logger.info('Pornește execuție', { projectId, chatId });

        // Obținem datele proiectului
        const project = await query('SELECT * FROM projects WHERE id = $1', [projectId]);
        if (!project.rows[0]) {
            throw new Error('Proiect negăsit');
        }

        const discoveryData = project.rows[0].discovery_data || {};

        // Pornim execuția în background
        await this.bot.telegram.sendMessage(chatId, '🚀 Execuție pornită! Voi trimite update-uri pe parcurs.');

        // Creăm executor și pornim
        const executor = new PlanExecutor(this.bot, chatId);
        
        // Executăm asincron pentru a nu bloca răspunsul
        executor.executePlan(projectId, discoveryData)
            .then(result => {
                this.sendCompletionMessage(chatId, projectId, result);
            })
            .catch(error => {
                console.error('Eroare execuție:', error);
                this.bot.telegram.sendMessage(chatId, `❌ Execuție eșuată: ${error.message}`);
            });
    }

    /**
     * Trimite mesaj de finalizare cu opțiuni
     */
    async sendCompletionMessage(chatId, projectId, result) {
        const message = `✅ <b>Proiect complet!</b>

⏱️ Durată: ${result.duration}s
📁 Fișiere generate: ${result.files.length}
🏗️ Stack: ${result.architecture?.techStack?.frontend || 'React'} + ${result.architecture?.techStack?.backend || 'Express'}

Ce dorești să faci?`;

        await this.bot.telegram.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{text: '📁 Vezi fișierele', callback_data: `view_files_${projectId}`}],
                    [{text: '⬇️ Download ZIP', callback_data: `download_${projectId}`}],
                    [{text: '🔄 Generează alt proiect', callback_data: 'new_project'}]
                ]
            }
        });
    }

    /**
     * Listează fișierele unui proiect
     */
    async listProjectFiles(chatId, projectId) {
        const { listProjectFiles } = require('../utils/project');
        
        try {
            const files = await listProjectFiles(projectId);
            
            // Împărțim în chunks de 50 de fișiere (limită Telegram)
            const chunks = [];
            for (let i = 0; i < files.length; i += 50) {
                chunks.push(files.slice(i, i + 50));
            }

            for (const chunk of chunks) {
                const fileList = chunk.map((f, i) => `${i + 1}. \`${f}\``).join('\n');
                await this.bot.telegram.sendMessage(chatId, `📁 Fișiere:\n${fileList}`, {
                    parse_mode: 'Markdown'
                });
            }
        } catch (err) {
            await this.bot.telegram.sendMessage(chatId, `❌ Eroare: ${err.message}`);
        }
    }

    async saveMessage(projectId, role, content, metadata = {}) {
        await query(
            'INSERT INTO conversations (project_id, role, content, metadata) VALUES ($1, $2, $3, $4)',
            [projectId, role, content, JSON.stringify(metadata)]
        );
    }
}

module.exports = { ManagerAgent };
