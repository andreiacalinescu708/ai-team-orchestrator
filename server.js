require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const { initDB, query } = require('./src/utils/db');
const { ManagerAgent } = require('./src/agents/manager');

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const manager = new ManagerAgent(bot);

// Middleware
app.use(express.json());

// Stare sesiuni (cine ce proiect are activ)
const userSessions = {};

// Comanda /start
bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    
    await ctx.reply('🤖 AI Team Manager pornit.\n\nCe vrei să construim astăzi?\n(describe your project idea)');
    
    // Creăm proiect nou în DB
    const result = await query(
        'INSERT INTO projects (name, status) VALUES ($1, $2) RETURNING id',
        ['New Project', 'discovering']
    );
    
    const projectId = result.rows[0].id;
    userSessions[userId] = { projectId, step: 'discovery', chatId };
    
    console.log(`Nou proiect creat: ${projectId} pentru user ${userId}`);
});

// Handler mesaje text (Discovery)
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('Folosește /start pentru a începe un proiect nou.');
    }
    
    if (session.step === 'discovery') {
        // Verificăm dacă e primul mesaj sau continuare
        const history = await query(
            'SELECT COUNT(*) as count FROM conversations WHERE project_id = $1',
            [session.projectId]
        );
        
        if (history.rows[0].count === 0) {
            // Primul mesaj = cerința inițială
            await manager.startDiscovery(session.chatId, session.projectId, text);
        } else {
            // Răspuns la întrebare
            await manager.handleDiscoveryResponse(session.chatId, session.projectId, text);
        }
    }
});

// Handler butoane (Callback queries)
bot.action(/skip_discovery_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    await ctx.answerCbQuery();
    await manager.completeDiscovery(ctx.chat.id, projectId, 'Skipped by user. Manual specification.');
});

bot.action(/start_execution_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.reply('🚀 Execuție pornită! (Aici vine logica cu workers)');
    // TODO: Implementare workers
});

// Health check pentru Railway
app.get('/', (req, res) => {
    res.json({status: 'AI Team Orchestrator running', timestamp: new Date()});
});

// Inițializare
async function start() {
    await initDB();
    
    // Pornim botul
    bot.launch();
    console.log('🤖 Bot Telegram pornit');
    
    // Pornim serverul web (pentru Railway health checks)
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🌐 Server web pornit pe port ${PORT}`);
    });
}

start();