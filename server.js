require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const { initDB, query } = require('./src/utils/db');
const { initLogsTable } = require('./src/utils/logger');
const { ManagerAgent } = require('./src/agents/manager');
const { SkillManagerAgent } = require('./src/agents/skill-manager');
const { listProjectFiles } = require('./src/utils/project');

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const manager = new ManagerAgent(bot);

// Middleware
app.use(express.json());

// Stare sesiuni (cine ce proiect are activ)
const userSessions = {};

// ==================== COMENZI TELEGRAM ====================

// Comanda /start
bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    
    await ctx.reply(`👋 Salut ${username}!\n\nSunt AI Team Orchestrator. Îmi poți cere să creez aplicații web complete.\n\nCe vrei să construim astăzi?`, {
        reply_markup: {
            inline_keyboard: [
                [{text: '📝 Exemple proiecte', callback_data: 'show_examples'}]
            ]
        }
    });
});

// Comanda /status
bot.command('status', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('Nu ai un proiect activ. Folosește /start pentru a începe.');
    }
    
    try {
        const project = await query('SELECT * FROM projects WHERE id = $1', [session.projectId]);
        if (project.rows[0]) {
            const p = project.rows[0];
            ctx.reply(
                `📊 Status proiect #${p.id}:\n\n` +
                `📝 ${p.name}\n` +
                `📌 Status: ${p.status}\n` +
                `💰 Cost estimat: $${p.total_cost || 0}\n` +
                `📅 Creat: ${p.created_at.toLocaleDateString()}`
            );
        }
    } catch (err) {
        ctx.reply('❌ Eroare la obținerea statusului.');
    }
});

// Comanda /files
bot.command('files', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('Nu ai un proiect activ.');
    }
    
    await manager.listProjectFiles(ctx.chat.id, session.projectId);
});

// Comanda /reset
bot.command('reset', async (ctx) => {
    const userId = ctx.from.id;
    delete userSessions[userId];
    await ctx.reply('🔄 Sesiune resetată. Folosește /start pentru a începe un proiect nou.');
});

// Comanda /skills
bot.command('skills', async (ctx) => {
    const skillManager = new SkillManagerAgent(bot);
    await skillManager.listSkills(ctx.chat.id);
});

// Comanda /projects - Listează proiectele userului
bot.command('projects', async (ctx) => {
    const userId = ctx.from.id;
    
    try {
        const result = await query(
            'SELECT id, name, status, created_at FROM projects WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        
        if (result.rows.length === 0) {
            return ctx.reply('📭 Nu ai proiecte încă. Folosește /start pentru a începe un proiect nou.');
        }
        
        let message = `📁 <b>Proiectele tale (${result.rows.length}):</b>\n\n`;
        const buttons = [];
        
        result.rows.forEach((p, i) => {
            const date = new Date(p.created_at).toLocaleDateString('ro-RO');
            const statusEmoji = {
                'discovering': '🔍',
                'skills_check': '🔧',
                'ready_to_execute': '⏳',
                'executing': '⚙️',
                'completed': '✅',
                'failed': '❌'
            }[p.status] || '📋';
            
            message += `${i + 1}. ${statusEmoji} <b>${p.name || 'Proiect #' + p.id}</b>\n`;
            message += `   Status: ${p.status} | ${date}\n\n`;
            
            buttons.push([{text: `Selectează #${p.id}`, callback_data: `select_project_${p.id}`}]);
        });
        
        await ctx.reply(message, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buttons }
        });
        
    } catch (err) {
        console.error('Eroare /projects:', err);
        ctx.reply('❌ Eroare la încărcarea proiectelor.');
    }
});

// Comanda /help
bot.command('help', async (ctx) => {
    await ctx.reply(
        `🤖 <b>AI Team Orchestrator - Comenzi</b>\n\n` +
        `/start - Începe proiect nou\n` +
        `/status - Vezi status proiect curent\n` +
        `/files - Listează fișierele generate\n` +
        `/reset - Resetează sesiunea\n` +
        `/help - Acest mesaj\n\n` +
        `<b>Cum funcționează:</b>\n` +
        `1. Îmi spui ce aplicație vrei\n` +
        `2. Îți pun câteva întrebări (discovery)\n` +
        `3. Generez codul complet\n` +
        `4. Primești fișierele gata de folosit`,
        { parse_mode: 'HTML' }
    );
});

// ==================== HANDLER MESAJE ====================

// Handler mesaje text cu error handling
bot.on('text', async (ctx) => {
    try {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const chatId = ctx.chat.id;
    
    // Ignorăm comenzile
    if (text.startsWith('/')) return;
    
    let session = userSessions[userId];
    
    // Dacă nu există sesiune, creăm una nouă
    if (!session) {
        // Creăm proiect nou în DB
        const result = await query(
            'INSERT INTO projects (user_id, name, status) VALUES ($1, $2, $3) RETURNING id',
            [userId, 'New Project', 'discovering']
        );
        
        const projectId = result.rows[0].id;
        userSessions[userId] = { projectId, step: 'discovery', chatId };
        session = userSessions[userId];
        
        console.log(`Nou proiect creat: ${projectId} pentru user ${userId}`);
    }
    
    // Afișăm typing indicator
    await ctx.sendChatAction('typing');
    
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
    } catch (error) {
        console.error('❌ Eroare procesare mesaj:', error);
        await ctx.reply('❌ A apărut o eroare. Încearcă din nou sau folosește /reset pentru a reîncepe.');
    }
});

// ==================== CALLBACK QUERIES ====================

// Handler butoane (Callback queries)
bot.action(/skip_discovery_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    const userId = ctx.from.id;
    
    await ctx.answerCbQuery();
    
    userSessions[userId] = { 
        projectId: parseInt(projectId), 
        step: 'discovery', 
        chatId: ctx.chat.id 
    };
    
    await manager.completeDiscovery(ctx.chat.id, projectId, 'Skipped by user. Manual specification.');
});

bot.action(/skip_to_execute_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    
    await ctx.answerCbQuery();
    await manager.startExecution(ctx.chat.id, projectId);
});

bot.action(/start_execution_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    const userId = ctx.from.id;
    
    await ctx.answerCbQuery('🚀 Pornim execuția...');
    
    // Salvăm sesiunea pentru /status și /files
    userSessions[userId] = { 
        projectId: parseInt(projectId), 
        step: 'executing', 
        chatId: ctx.chat.id 
    };
    
    await manager.startExecution(ctx.chat.id, projectId);
});

bot.action(/view_files_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    await ctx.answerCbQuery();
    await manager.listProjectFiles(ctx.chat.id, projectId);
});

bot.action(/download_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    await ctx.answerCbQuery('📦 Preparăm fișierele...');
    
    try {
        // TODO: Implementare ZIP download
        await ctx.reply('⬇️ Funcționalitatea de download va fi disponibilă curând!\n\nPoți accesa direct fișierele în folderul `projects/`.');
    } catch (err) {
        await ctx.reply('❌ Eroare la pregătirea fișierelor.');
    }
});

bot.action('new_project', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    delete userSessions[userId];
    await ctx.reply('🆕 Sesiune resetată. Scrie-mi ce vrei să construim!');
});

// Handler pentru generare skills
bot.action(/generate_skills_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    const userId = ctx.from.id;
    
    await ctx.answerCbQuery('🔄 Generez skills...');
    
    // Obținem analysis salvat
    const project = await query('SELECT discovery_data FROM projects WHERE id = $1', [projectId]);
    const analysis = project.rows[0]?.discovery_data?.skill_analysis;
    
    if (!analysis || analysis.missing.length === 0) {
        return ctx.reply('Nu am găsit skills de generat. Pornim execuția?', {
            reply_markup: {
                inline_keyboard: [[{text: '🚀 START', callback_data: `start_execution_${projectId}`}]]
            }
        });
    }
    
    // Salvăm sesiunea
    userSessions[userId] = { projectId: parseInt(projectId), step: 'generating_skills', chatId: ctx.chat.id };
    
    // Generăm skills
    const skillManager = new SkillManagerAgent(bot);
    await skillManager.generateAndSaveSkills(ctx.chat.id, projectId, analysis.missing);
});

bot.action(/manual_skills_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.reply(
        `📝 Pentru a adăuga manual skills:\n\n` +
        `1. Creează un fișier în <code>src/skills/generated/</code>\n` +
        `2. Sau folosește comanda <code>/skills add &lt;nume&gt;</code>\n\n` +
        `După ce adaugi skills, apasă START:`,
        {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{text: '🚀 START', callback_data: `start_execution_${projectId}`}]]
            }
        }
    );
});

bot.action(/skip_skills_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    await ctx.answerCbQuery('⏭️ Sărim peste...');
    await ctx.reply('⏭️ Continuăm fără skills lipsă. Poate nu vor fi necesare sau vom folosi alternative.', {
        reply_markup: {
            inline_keyboard: [[{text: '🚀 START Execuție', callback_data: `start_execution_${projectId}`}]]
        }
    });
});

bot.action(/select_project_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    const userId = ctx.from.id;
    
    await ctx.answerCbQuery('📂 Se încarcă proiectul...');
    
    try {
        // Verificăm că proiectul aparține userului
        const project = await query(
            'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
            [projectId, userId]
        );
        
        if (!project.rows[0]) {
            return ctx.reply('❌ Proiect negăsit sau nu ai acces.');
        }
        
        // Activăm sesiunea
        userSessions[userId] = {
            projectId: parseInt(projectId),
            step: project.rows[0].status === 'discovering' ? 'discovery' : 'executing',
            chatId: ctx.chat.id
        };
        
        const p = project.rows[0];
        await ctx.reply(
            `📂 <b>Proiect activat:</b> #${p.id}\n\n` +
            `📝 ${p.name || 'Proiect nou'}\n` +
            `📌 Status: ${p.status}\n\n` +
            `Poți continua lucrul. Scrie-mi ce vrei să facem!`,
            { parse_mode: 'HTML' }
        );
        
    } catch (err) {
        console.error('Eroare selectare proiect:', err);
        ctx.reply('❌ Eroare la încărcarea proiectului.');
    }
});

bot.action('show_examples', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `💡 <b>Exemple de proiecte pe care le pot genera:</b>\n\n` +
        `• <i>"Task management app cu React și Node.js"</i>\n` +
        `• <i>"Blog platform cu autentificare și comentarii"</i>\n` +
        `• <i>"E-commerce site cu coș de cumpărături"</i>\n` +
        `• <i>"API de booking pentru hoteluri"</i>\n\n` +
        `Ce vrei să construim?`,
        { parse_mode: 'HTML' }
    );
});

// ==================== WEB SERVER ====================

// Health check pentru Railway
app.get('/', (req, res) => {
    res.json({
        status: 'AI Team Orchestrator running',
        timestamp: new Date(),
        version: '2.0.0'
    });
});

// API pentru status proiect
app.get('/api/projects/:id', async (req, res) => {
    try {
        const project = await query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
        if (project.rows[0]) {
            res.json(project.rows[0]);
        } else {
            res.status(404).json({ error: 'Proiect negăsit' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== INIȚIALIZARE ====================

async function start() {
    try {
        // Inițializare DB
        await initDB();
        await initLogsTable();
        
        // Pornim botul
        bot.launch();
        console.log('🤖 Bot Telegram pornit');
        
        // Pornim serverul web (pentru Railway health checks)
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🌐 Server web pornit pe port ${PORT}`);
        });

        // Graceful shutdown
        process.once('SIGINT', () => {
            console.log('🛑 Oprire gracefully...');
            bot.stop('SIGINT');
            process.exit(0);
        });
        
        process.once('SIGTERM', () => {
            console.log('🛑 Oprire gracefully...');
            bot.stop('SIGTERM');
            process.exit(0);
        });
        
    } catch (err) {
        console.error('❌ Eroare pornire:', err);
        process.exit(1);
    }
}

start();
