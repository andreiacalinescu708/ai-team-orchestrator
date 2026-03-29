const { CommandParser } = require('./command-parser');
const { CommandExecutor } = require('./command-executor');
const { Logger } = require('../utils/logger');

const logger = new Logger('AgentCommander');

/**
 * Trunchiază textul pentru a respecta limita Telegram (4096 caractere)
 * Lasă margine de siguranță de 100 caractere pentru tag-uri HTML
 */
function truncateMessage(text, maxLength = 3900) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '\n\n... (mesaj trunchiat)';
}

/**
 * AgentCommander - Orchestrază comenzi autonome
 */
class AgentCommander {
    constructor(bot) {
        this.bot = bot;
        this.parser = new CommandParser();
        this.executor = new CommandExecutor(bot);
        this.pendingCommands = new Map(); // userId -> command
    }

    /**
     * Procesează un mesaj și decide dacă e comandă
     */
    async processMessage(chatId, userId, projectId, message) {
        console.log(`🤖 AgentCommander procesează: "${message.substring(0, 50)}..."`);

        // 1. Parsează intenția
        const intent = await this.parser.parse(message);
        console.log('📋 Intenție detectată:', intent);

        // 2. Dacă nu e comandă, returnează null (va merge la conversație normală)
        if (intent.type === 'unknown') {
            return null;
        }

        // 3. Dacă necesită confirmare, cere aprobare
        if (intent.confirmation) {
            await this.requestConfirmation(chatId, userId, projectId, intent);
            return { handled: true, waitingConfirmation: true };
        }

        // 4. Execută direct
        await this.executeCommand(chatId, projectId, intent);
        return { handled: true };
    }

    /**
     * Cere confirmare pentru comenzi riscante
     */
    async requestConfirmation(chatId, userId, projectId, intent) {
        const commandId = Date.now().toString();
        
        this.pendingCommands.set(userId, {
            id: commandId,
            projectId,
            intent,
            timestamp: Date.now()
        });

        // Cleanup după 5 minute
        setTimeout(() => {
            this.pendingCommands.delete(userId);
        }, 5 * 60 * 1000);

        let warning = '';
        if (intent.type === 'deploy') {
            warning = '⚠️ <b>Atenție:</b> Deploy-ul va suprascrie versiunea curentă!\n\n';
        } else if (intent.type === 'restart') {
            warning = '⚠️ <b>Atenție:</b> Serviciul va fi indisponibil câteva secunde!\n\n';
        }

        await this.bot.telegram.sendMessage(chatId, 
            `${warning}` +
            `🤖 <b>Am înțeles comanda:</b>\n` +
            `<i>${intent.description}</i>\n\n` +
            `Vrei să execut?`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Confirmă', callback_data: `confirm_cmd_${commandId}` },
                            { text: '❌ Anulează', callback_data: `cancel_cmd_${commandId}` }
                        ]
                    ]
                }
            }
        );

        await logger.info('Confirmare cerută', { userId, command: intent.type });
    }

    /**
     * Gestionează confirmarea
     */
    async handleConfirmation(chatId, userId, action, callbackData) {
        const pending = this.pendingCommands.get(userId);
        
        if (!pending) {
            await this.bot.telegram.sendMessage(chatId, '❌ Comanda a expirat sau nu există.');
            return;
        }

        const commandId = callbackData.split('_')[2];
        if (pending.id !== commandId) {
            await this.bot.telegram.sendMessage(chatId, '❌ ID comandă invalid.');
            return;
        }

        // Ștergem din pending
        this.pendingCommands.delete(userId);

        if (action === 'cancel') {
            await this.bot.telegram.sendMessage(chatId, '❌ Comandă anulată.');
            await logger.info('Comandă anulată', { userId, command: pending.intent.type });
            return;
        }

        // Executăm
        await this.executeCommand(chatId, pending.projectId, pending.intent);
    }

    /**
     * Execută comanda
     */
    async executeCommand(chatId, projectId, intent) {
        await this.bot.telegram.sendChatAction(chatId, 'typing');
        
        const startTime = Date.now();
        
        try {
            const result = await this.executor.execute(chatId, projectId, intent);
            
            const duration = Date.now() - startTime;
            console.log(`✅ Comandă executată în ${duration}ms:`, result.success);

            // Trimitem rezultatul (trunchiat dacă e prea lung)
            await this.bot.telegram.sendMessage(chatId, truncateMessage(result.message), {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });

            await logger.info('Comandă executată', { 
                projectId, 
                type: intent.type, 
                success: result.success,
                duration 
            });

        } catch (error) {
            console.error('❌ Eroare execuție comandă:', error);
            const errorMsg = truncateMessage(error.message, 3800); // Mai mic pentru a lăsa loc pentru HTML
            await this.bot.telegram.sendMessage(chatId, 
                `❌ <b>Eroare execuție:</b>\n<pre>${errorMsg}</pre>`,
                { parse_mode: 'HTML' }
            );
            await logger.error('Eroare execuție comandă', { projectId, error: error.message });
        }
    }

    /**
     * Listează comenzi disponibile
     */
    async listCommands(chatId) {
        const commands = `
🤖 <b>Comenzi disponibile:</b>

<b>🚀 Deploy & Infrastructure:</b>
• "Deploy pe Railway" - Publică aplicația
• "Vezi status" - Status servicii
• "Restart backend" - Repornește serviciul

<b>📋 Logs & Debug:</b>
• "Vezi logs backend" - Logs recente
• "Vezi erori" - Doar erorile
• "Debug frontend" - Logs frontend

<b>🧪 Testare:</b>
• "Rulează testele" - Execută teste
• "Test backend" - Teste specifice

<b>📥 Download:</b>
• "Download ZIP" - Descarcă proiectul
• "Vezi structura" - Listează fișierele

<b>📄 PDF Processing:</b>
• Trimite PDF + "Extrage textul"
• Trimite PDF + "Fă-mi rezumat"
• Trimite PDF + "Extrage datele facturii"

<b>⚙️ Configurare:</b>
• "Setează JWT_SECRET=abc123" - Variabilă mediu
• "Configurează DATABASE_URL" - Config DB

<b>🗄️ Baze de date:</b>
• "Crează migrare" - Migrare DB
• "Vezi schema" - Structură tabele

Scrie comanda în limbaj natural sau folosește butoanele de mai sus!`;

        await this.bot.telegram.sendMessage(chatId, commands, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀 Deploy', callback_data: 'cmd_deploy' }],
                    [{ text: '📋 Logs', callback_data: 'cmd_logs' }],
                    [{ text: '📊 Status', callback_data: 'cmd_status' }],
                    [{ text: '📥 Download ZIP', callback_data: 'cmd_download' }]
                ]
            }
        });
    }
}

module.exports = { AgentCommander };
