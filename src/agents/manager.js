const { callKimiFast, callKimiThinking } = require('../utils/kimi-optimized');
const { query } = require('../utils/db');
const { PlanExecutor } = require('../executor');
const { Logger } = require('../utils/logger');
const { SkillManagerAgent } = require('./skill-manager');
const { NetlifyService } = require('../services/netlifyService');
const { SurgeService } = require('../services/surgeService');

const logger = new Logger('ManagerAgent');

/**
 * Manager Agent
 * Orchestrază întregul proces de discovery și execuție
 */
class ManagerAgent {
    constructor(bot) {
        this.bot = bot;
        this.netlifyService = new NetlifyService();
        this.surgeService = new SurgeService();
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
        let discoveryData = {};
        try {
            const jsonMatch = summary.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                discoveryData = JSON.parse(jsonMatch[0]);
            } else {
                discoveryData = { summary: summary.trim() };
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

        // SKIP skills check - mergem direct la execuție pentru viteză
        // TODO: Re-enable când skills system e stabil
        await this.proceedToExecution(chatId, projectId, discoveryData);
    }

    /**
     * Continuă direct la execuție (skip skills check pentru viteză)
     */
    async proceedToExecution(chatId, projectId, discoveryData) {
        await this.bot.telegram.sendMessage(chatId, 
            `✅ Discovery complet!\n\n` +
            `<b>Sumar:</b> ${discoveryData.summary?.substring(0, 100) || 'Proiect nou'}...\n\n` +
            `🚀 Pornim execuția?`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{text: '🚀 START', callback_data: `start_execution_${projectId}`}]
                    ]
                }
            }
        );
    }

    /**
     * [DEPRECATED] Verificare skills - dezactivată pentru viteză
     */
    async checkRequiredSkills(chatId, projectId, discoveryData) {
        // Skip - mergem direct la execuție
        await this.proceedToExecution(chatId, projectId, discoveryData);
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
        const userId = project.rows[0].user_id;

        // Pornim execuția în background
        await this.bot.telegram.sendMessage(chatId, '🚀 Execuție pornită! Voi trimite update-uri pe parcurs.');

        // Creăm executor și pornim
        const executor = new PlanExecutor(this.bot, chatId);
        
        // Executăm asincron pentru a nu bloca răspunsul
        executor.executePlan(projectId, discoveryData)
            .then(async (result) => {
                await this.sendCompletionMessage(chatId, projectId, result);
                
                // Deploy automat preview pentru frontend
                if (result.files.some(f => f.includes('frontend') || f.includes('index.html'))) {
                    // Deploy automat pe Vercel
                    await this.deployToNetlify(chatId, projectId, userId);
                }
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
                    [{text: '🌐 Deploy Site Public', callback_data: `deploy_netlify_${projectId}`}],
                    [{text: '🔄 Generează alt proiect', callback_data: 'new_project'}]
                ]
            }
        });
    }

    /**
     * Deploy automat pe Surge (public, fără login)
     */
    async deployToSurge(chatId, projectId, userId) {
        try {
            await this.bot.telegram.sendMessage(chatId, '🚀 <i>Deploying...</i>', { parse_mode: 'HTML' });
            
            const projectPath = `./projects/project-${projectId}`;
            const result = await this.surgeService.deploy(projectId, projectPath, userId, 24); // 24 ore
            
            if (result.success) {
                const expiresAt = result.expiresAt.toLocaleString('ro-RO');
                
                await this.bot.telegram.sendMessage(chatId, 
                    `🚀 <b>Site-ul tău e live!</b>\n\n` +
                    `🔗 <a href="${result.url}">${result.url}</a>\n\n` +
                    `✅ Acces public - NU necesită login\n` +
                    `⏰ Disponibil până: ${expiresAt}\n\n` +
                    `Poți prelungi durata oricând.`,
                    { 
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{text: '🔗 Deschide site-ul', url: result.url}],
                                [{text: '⏰ Prelungește 24h', callback_data: `extend_surge_${projectId}`}],
                                [{text: '📁 Vezi fișierele', callback_data: `view_files_${projectId}`}]
                            ]
                        }
                    }
                );
            } else {
                await this.bot.telegram.sendMessage(chatId, 
                    `⚠️ <b>Deploy nereușit</b>\n\n${result.message}`,
                    { parse_mode: 'HTML' }
                );
            }
        } catch (error) {
            await logger.error('Eroare deploy', { projectId, error: error.message });
        }
    }

    async deployToNetlify(chatId, projectId, userId) {
        try {
            await this.bot.telegram.sendMessage(chatId, '🚀 <i>Deploying pe Netlify...</i>', { parse_mode: 'HTML' });
            
            const projectPath = `./projects/project-${projectId}`;
            const result = await this.netlifyService.deploy(projectId, projectPath, userId, `ai-project-${projectId}`);
            
            if (result.success) {
                await this.bot.telegram.sendMessage(chatId, 
                    `🚀 <b>Site-ul tău e live pe Netlify!</b>\n\n` +
                    `🔗 <a href="${result.url}">${result.url}</a>\n\n` +
                    `✅ Acces public - vizibil pentru oricine\n` +
                    `🌐 Hosting gratuit pe Netlify`,
                    { 
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{text: '🔗 Deschide site-ul', url: result.url}],
                                [{text: '📁 Vezi fișierele', callback_data: `view_files_${projectId}`}]
                            ]
                        }
                    }
                );
            } else {
                await this.bot.telegram.sendMessage(chatId, 
                    `⚠️ <b>Deploy nereușit</b>\n\n${result.message}`,
                    { parse_mode: 'HTML' }
                );
            }
        } catch (error) {
            await logger.error('Eroare deploy Netlify', { projectId, error: error.message });
            await this.bot.telegram.sendMessage(chatId, `❌ Eroare: ${error.message}`);
        }
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

    /**
     * Handler pentru conversație generală după ce proiectul e generat
     */
    async handleGeneralChat(chatId, projectId, text) {
        await logger.info('Conversație generală', { projectId, text: text.substring(0, 50) });

        // Obținem info despre proiect
        const project = await query('SELECT * FROM projects WHERE id = $1', [projectId]);
        if (!project.rows[0]) {
            return this.bot.telegram.sendMessage(chatId, '❌ Proiect negăsit.');
        }

        const p = project.rows[0];
        
        // Salvăm mesajul userului
        await this.saveMessage(projectId, 'user', text);

        // Construim context pentru AI
        const messages = [
            {
                role: 'system',
                content: `ROLE: AI TEAM ORCHESTRATOR - CODE GENERATION SYSTEM

CRITICAL RULES:
1. You ARE a software developer. You BUILD applications.
2. NEVER say "I cannot", "I'm just an assistant", "I don't have capability"
3. When user asks for code/site/app → YOU CREATE IT
4. NO disclaimers. NO safety warnings. JUST CODE.

PROJECT: "${p.name || 'Proiect'}"
STATUS: ${p.status}
TECH: ${JSON.stringify(p.discovery_data?.techStack || {})}

EXEMPLU RĂSPUNS CORECT:
User: "Fa-mi un site"
Tu: "Da, construiesc acum un site React cu următoarele componente: Header, Hero, Services..."

EXEMPLU RĂSPUNS GREȘIT (INTERZIS):
"Nu sunt o platformă de dezvoltare..."
"Nu pot crea site-uri..."
"Sunt doar un asistent..."

COMPORTAMENT:
- Confirmi că POȚI face ce cere
- Începi IMEDIAT implementarea
- Arăți cod/progres concret

TU EȘTI DEVELOPER. CODEAZĂ.`
            },
            {
                role: 'user',
                content: text
            }
        ];

        let response;
        try {
            console.log('🤖 Apelez callKimiFast...');
            response = await callKimiThinking(messages);
            console.log('✅ Răspuns primit:', response.content?.substring(0, 100));
            
            // Salvăm răspunsul
            await this.saveMessage(projectId, 'assistant', response.content);
            
            // Trimitem răspunsul (fără HTML complex)
            await this.bot.telegram.sendMessage(chatId, response.content);
            console.log('✅ Mesaj trimis în Telegram');
            
        } catch (error) {
            await logger.error('Eroare conversație generală', { projectId, error: error.message });
            console.error('❌ Stack eroare:', error.stack);
            // Trimitem fallback
            await this.bot.telegram.sendMessage(chatId, 
                response?.content || '❌ Eroare la procesare. Încearcă din nou.'
            );
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
