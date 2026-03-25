require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const { initDB, query } = require('./src/utils/db');
const { initLogsTable } = require('./src/utils/logger');
const { ManagerAgent } = require('./src/agents/manager');
const { SkillManagerAgent } = require('./src/agents/skill-manager');
const { AgentCommander } = require('./src/agents/agent-commander');
const { listProjectFiles } = require('./src/utils/project');

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const manager = new ManagerAgent(bot);
const commander = new AgentCommander(bot);

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
        `<b>📝 Proiect:</b>\n` +
        `/start - Proiect nou\n` +
        `/projects - Listează proiecte\n` +
        `/status - Status proiect\n` +
        `/files - Listează fișiere\n` +
        `/download - Download ZIP\n\n` +
        `<b>🔧 GitHub:</b>\n` +
        `/pr - Creează Pull Request\n` +
        `/push - Push cod pe GitHub\n\n` +
        `<b>🚀 Deploy & Ops:</b>\n` +
        `/deploy - Deploy pe Railway\n` +
        `/logs - Vezi logs\n` +
        `/restart - Restart servicii\n` +
        `/test - Rulează teste\n` +
        `/env KEY value - Setează variabilă\n\n` +
        `<b>💬 Comunicare:</b>\n` +
        `/chat - Mod conversație liberă\n` +
        `/skill desc - Creează skill nou\n\n` +
        `/reset - Resetează sesiunea`,
        { parse_mode: 'HTML' }
    );
});

// ============== COMENZI GITHUB ==============

// /pr - Creează Pull Request
bot.command('pr', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('📭 Nu ai un proiect activ. Folosește /projects');
    }
    
    await ctx.reply('📝 Creez Pull Request...');
    await commander.processMessage(ctx.chat.id, userId, session.projectId, 'crează pull request');
});

// /push - Push cod pe GitHub
bot.command('push', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('📭 Nu ai un proiect activ. Folosește /projects');
    }
    
    await ctx.reply('⬆️ Pushing cod pe GitHub...');
    await commander.processMessage(ctx.chat.id, userId, session.projectId, 'push cod pe github');
});

// ============== COMENZI DEPLOY & OPS ==============

// /deploy - Deploy pe Railway
bot.command('deploy', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('📭 Nu ai un proiect activ. Folosește /projects');
    }
    
    await ctx.reply('🚀 Pornesc deploy pe Railway...');
    await commander.processMessage(ctx.chat.id, userId, session.projectId, 'deploy pe railway');
});

// /logs - Vezi logs
bot.command('logs', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('📭 Nu ai un proiect activ. Folosește /projects');
    }
    
    await ctx.reply('📋 Afișez logs backend...');
    await commander.processMessage(ctx.chat.id, userId, session.projectId, 'vezi logs backend');
});

// /restart - Restart servicii
bot.command('restart', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('📭 Nu ai un proiect activ. Folosește /projects');
    }
    
    await ctx.reply('🔄 Restart servicii...');
    await commander.processMessage(ctx.chat.id, userId, session.projectId, 'restart toate serviciile');
});

// /test - Rulează teste
bot.command('test', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('📭 Nu ai un proiect activ. Folosește /projects');
    }
    
    await ctx.reply('🧪 Rulez testele...');
    await commander.processMessage(ctx.chat.id, userId, session.projectId, 'rulează teste');
});

// /env - Setează variabilă de mediu
bot.command('env', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('📭 Nu ai un proiect activ. Folosește /projects');
    }
    
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
        return ctx.reply(
            `⚙️ <b>Setare variabilă de mediu</b>\n\n` +
            `Folosire: <code>/env KEY value</code>\n` +
            `Exemplu: <code>/env DATABASE_URL postgresql://...</code>\n\n` +
            `Sau scrie natural: "setează JWT_SECRET=abc123"`,
            { parse_mode: 'HTML' }
        );
    }
    
    const key = args[0];
    const value = args.slice(1).join(' ');
    
    await ctx.reply(`⚙️ Setez ${key}...`);
    await commander.processMessage(ctx.chat.id, userId, session.projectId, `setează ${key}=${value}`);
});

// /chat - Mod conversație liberă cu AI (fără interpretare comenzi)
bot.command('chat', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('📭 Nu ai un proiect activ. Folosește /projects');
    }
    
    // Activăm modul chat liber
    session.chatMode = 'free';
    
    await ctx.reply(
        `💬 <b>Mod conversație liberă activat</b>\n\n` +
        `Acum pot vorbi cu tine direct fără să interpretez comenzi.\n` +
        `Spune-mi ce vrei să discutăm despre proiect!\n\n` +
        `Pentru a ieși: <code>/exit</code> sau orice comandă /`,
        { parse_mode: 'HTML' }
    );
});

// /exit - Ieși din modul chat liber
bot.command('exit', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (session) {
        session.chatMode = 'normal';
    }
    
    await ctx.reply('✅ Am revenit la modul normal. Comenzile sunt active din nou.');
});

// /skill - Creează skill nou (autonomie AI)
bot.command('skill', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    
    if (!session) {
        return ctx.reply('📭 Nu ai un proiect activ. Folosește /projects');
    }
    
    const args = ctx.message.text.split(' ').slice(1);
    const skillRequest = args.join(' ');
    
    if (!skillRequest) {
        return ctx.reply(
            `🔧 <b>Creează skill nou</b>\n\n` +
            `Descrie ce vrei să pot face:\n` +
            `<code>/skill să pot genera diagrame din cod</code>\n\n` +
            `Sau spune ce problemă ai:\n` +
            `<code>/skill am nevoie să procesez fișiere CSV</code>`,
            { parse_mode: 'HTML' }
        );
    }
    
    await ctx.reply(`🔧 Analizez și creez skill pentru: "${skillRequest}"...`);
    
    // Apelăm skill manager să genereze
    const skillManager = new SkillManagerAgent(bot);
    await skillManager.generateSkillFromRequest(ctx.chat.id, session.projectId, skillRequest);
});

// ==================== HANDLER FIȘIERE (PDF, etc.) ====================

// Handler pentru documente (PDF)
bot.on('document', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const document = ctx.message.document;
        const chatId = ctx.chat.id;
        
        // Verificăm dacă e PDF
        if (!document.file_name.endsWith('.pdf')) {
            return ctx.reply('📄 Momentan procesez doar fișiere PDF. Trimite un PDF!');
        }

        const session = userSessions[userId];
        if (!session) {
            return ctx.reply('Nu ai un proiect activ. Folosește /start sau /projects');
        }

        await ctx.reply(`📄 Am primit PDF-ul: <b>${document.file_name}</b>\n\nCe vrei să fac cu el?\n\n` +
                       `• "Extrage textul"\n` +
                       `• "Fă-mi un rezumat"\n` +
                       `• "Extrage datele facturii"\n` +
                       `• "Generează PDF nou cu datele extrase"`,
                       { parse_mode: 'HTML' });

        // Salvăm referința la PDF în sesiune
        session.pendingPDF = {
            fileId: document.file_id,
            fileName: document.file_name,
            fileUniqueId: document.file_unique_id
        };

    } catch (error) {
        console.error('❌ Eroare procesare document:', error);
        ctx.reply('❌ Eroare la procesarea documentului.');
    }
});

// Handler pentru mesaje text care procesază PDF-uri
async function handlePDFCommand(ctx, text, session) {
    const { PDFProcessor } = require('./src/skills/pdf-processor');
    const pdf = new PDFProcessor();
    
    if (!session.pendingPDF) {
        return false; // Nu e comandă PDF
    }

    try {
        await ctx.sendChatAction('typing');
        await ctx.reply('📄 <b>Procesez PDF-ul...</b>', { parse_mode: 'HTML' });

        // Descărcăm PDF-ul
        const fileLink = await ctx.telegram.getFileLink(session.pendingPDF.fileId);
        const response = await fetch(fileLink);
        const buffer = await response.arrayBuffer();
        
        const tempPath = `./temp/${session.pendingPDF.fileUniqueId}.pdf`;
        await fs.promises.writeFile(tempPath, Buffer.from(buffer));

        // Determinăm acțiunea
        const action = text.includes('rezumat') ? 'summarize' :
                      text.includes('factur') || text.includes('date') ? 'extract_invoice' :
                      text.includes('tabel') ? 'tables' : 'extract';

        let result;

        if (action === 'summarize') {
            const outputPath = `./temp/${session.pendingPDF.fileUniqueId}_summary.pdf`;
            result = await pdf.processAndSummarize(tempPath, outputPath, { useAI: true, title: 'Rezumat Document' });
            
            if (result.success) {
                await ctx.reply(`✅ <b>Rezumat generat!</b>\n\n<i>${result.summary.substring(0, 500)}...</i>`, { parse_mode: 'HTML' });
                await ctx.replyWithDocument({ source: outputPath, filename: 'rezumat.pdf' });
            }
        } 
        else if (action === 'extract_invoice') {
            result = await pdf.extractStructuredData(tempPath, 'invoice');
            
            if (result.success) {
                let message = `📋 <b>Date extrase:</b>\n\n`;
                const data = result.extracted.data.invoice || {};
                
                if (data.client) message += `👤 <b>Client:</b> ${data.client}\n`;
                if (data.invoiceNumber) message += `🧾 <b>Factura:</b> ${data.invoiceNumber}\n`;
                if (data.date) message += `📅 <b>Data:</b> ${data.date}\n`;
                if (data.total) message += `💰 <b>Total:</b> ${data.total}\n`;
                
                await ctx.reply(message, { parse_mode: 'HTML' });
            }
        }
        else if (action === 'tables') {
            result = await pdf.extractTables(tempPath);
            
            if (result.success) {
                await ctx.reply(`📊 <b>Tabele găsite:</b> ${result.tables.length}`, { parse_mode: 'HTML' });
                
                for (let i = 0; i < Math.min(result.tables.length, 3); i++) {
                    const table = result.tables[i];
                    let tableText = `<b>Tabelul ${i + 1}:</b>\n`;
                    tableText += `Header: ${table.headers.join(' | ')}\n`;
                    tableText += `Rânduri: ${table.rows.length}\n`;
                    await ctx.reply(tableText, { parse_mode: 'HTML' });
                }
            }
        }
        else {
            // Extrage text simplu
            result = await pdf.extractText(tempPath);
            
            if (result.success) {
                const preview = result.text.substring(0, 3000);
                await ctx.reply(`📖 <b>Text extras (${result.pages} pagini):</b>\n\n<pre>${preview}</pre>`, { parse_mode: 'HTML' });
            }
        }

        // Cleanup
        try {
            await fs.promises.unlink(tempPath);
            const outputPath = `./temp/${session.pendingPDF.fileUniqueId}_summary.pdf`;
            if (fs.existsSync(outputPath)) await fs.promises.unlink(outputPath);
        } catch (e) {}

        // Ștergem PDF-ul pending
        delete session.pendingPDF;
        return true;

    } catch (error) {
        console.error('❌ Eroare procesare PDF:', error);
        await ctx.reply(`❌ Eroare: ${error.message}`);
        delete session.pendingPDF;
        return true;
    }
}

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
        // Extragem numele proiectului din prima frază (primele 50 caractere)
        const projectName = text.length > 50 ? text.substring(0, 50) + '...' : text;
        
        // Creăm proiect nou în DB
        const result = await query(
            'INSERT INTO projects (user_id, name, status) VALUES ($1, $2, $3) RETURNING id',
            [userId, projectName, 'discovering']
        );
        
        const projectId = result.rows[0].id;
        userSessions[userId] = { projectId, step: 'discovery', chatId };
        session = userSessions[userId];
        
        console.log(`Nou proiect creat: ${projectId} pentru user ${userId}`);
        
        // Confirmare rapidă că am primit mesajul
        await ctx.reply('✅ Mesaj primit! Analizez...');
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
    } else {
        // Verificăm dacă e comandă PDF pending
        if (session.pendingPDF) {
            const handled = await handlePDFCommand(ctx, text, session);
            if (handled) return;
        }

        // Dacă suntem în modul chat liber, mergem direct la conversație
        if (session.chatMode === 'free') {
            console.log('💬 Mod chat liber - conversație directă');
            await manager.handleGeneralChat(session.chatId, session.projectId, text);
            return;
        }

        // Încercăm mai întâi să vedem dacă e o comandă pentru agenți
        console.log(`💬 Verific dacă e comandă: "${text.substring(0, 30)}..."`);
        
        const commandResult = await commander.processMessage(
            chatId, userId, session.projectId, text
        );
        
        if (commandResult && commandResult.handled) {
            // A fost procesat ca comandă
            console.log('✅ Comandă procesată:', commandResult);
        } else {
            // Conversație generală
            console.log('💬 Conversație generală');
            try {
                await manager.handleGeneralChat(session.chatId, session.projectId, text);
            } catch (chatError) {
                console.error('❌ Eroare handleGeneralChat:', chatError);
                throw chatError;
            }
        }
    }
    } catch (error) {
        console.error('❌ Eroare procesare mesaj:', error.message);
        console.error('Stack:', error.stack);
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
        const { DownloadExecutor } = require('./src/agents/download-executor');
        const downloader = new DownloadExecutor(bot);
        await downloader.sendProjectAsZip(ctx.chat.id, projectId);
    } catch (err) {
        console.error('Eroare download:', err);
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
// Handler pentru confirmări comenzi
bot.action(/confirm_cmd_(.+)/, async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery('⚡ Execut...');
    await commander.handleConfirmation(ctx.chat.id, userId, 'confirm', ctx.match[0]);
});

bot.action(/cancel_cmd_(.+)/, async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery('❌ Anulat');
    await commander.handleConfirmation(ctx.chat.id, userId, 'cancel', ctx.match[0]);
});

// Shortcut commands
bot.action('cmd_deploy', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = userSessions[userId];
    if (!session) {
        return ctx.reply('Nu ai un proiect activ. Folosește /projects');
    }
    await commander.processMessage(ctx.chat.id, userId, session.projectId, 'deploy pe railway');
});

bot.action('cmd_logs', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Scrie "vezi logs backend" sau "vezi logs frontend"');
});

bot.action('cmd_status', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = userSessions[userId];
    if (!session) {
        return ctx.reply('Nu ai un proiect activ. Folosește /projects');
    }
    await commander.processMessage(ctx.chat.id, userId, session.projectId, 'status');
});

bot.action('cmd_download', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = userSessions[userId];
    if (!session) {
        return ctx.reply('Nu ai un proiect activ. Folosește /projects');
    }
    await commander.processMessage(ctx.chat.id, userId, session.projectId, 'download zip');
});

// Comanda /commands - listează comenzi disponibile
bot.command('commands', async (ctx) => {
    await commander.listCommands(ctx.chat.id);
});

// Comanda /download - shortcut pentru download ZIP
bot.command('download', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions[userId];
    if (!session) {
        return ctx.reply('📭 Nu ai un proiect activ. Folosește /projects');
    }
    await commander.processMessage(ctx.chat.id, userId, session.projectId, 'download zip');
});

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

// Handler pentru deploy pe Vercel
bot.action(/deploy_vercel_(.+)/, async (ctx) => {
    const projectId = ctx.match[1];
    const userId = ctx.from.id;
    
    await ctx.answerCbQuery('🚀 Se face deploy pe Vercel...');
    
    try {
        const { ManagerAgent } = require('./src/agents/manager');
        const manager = new ManagerAgent(bot);
        await manager.deployToVercel(ctx.chat.id, projectId);
    } catch (err) {
        console.error('Eroare deploy Vercel:', err);
        ctx.reply('❌ Eroare la deploy. Încearcă din nou.');
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
        
        // Înregistrăm comenzile în Telegram
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Proiect nou' },
            { command: 'projects', description: 'Listează proiecte' },
            { command: 'status', description: 'Status proiect curent' },
            { command: 'files', description: 'Listează fișiere' },
            { command: 'download', description: 'Download ZIP' },
            { command: 'pr', description: 'Creează Pull Request' },
            { command: 'push', description: 'Push cod pe GitHub' },
            { command: 'deploy', description: 'Deploy pe Railway' },
            { command: 'logs', description: 'Vezi logs' },
            { command: 'restart', description: 'Restart servicii' },
            { command: 'test', description: 'Rulează teste' },
            { command: 'env', description: 'Setează variabilă de mediu' },
            { command: 'chat', description: 'Mod conversație liberă' },
            { command: 'skill', description: 'Creează skill nou' },
            { command: 'reset', description: 'Resetează sesiunea' },
            { command: 'help', description: 'Ajutor' }
        ]);
        console.log('✅ Comenzi înregistrate în Telegram');
        
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
