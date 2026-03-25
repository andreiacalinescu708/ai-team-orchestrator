const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { Logger } = require('../utils/logger');
const { listProjectFiles } = require('../utils/project');
const { SecurityService } = require('../services/securityService');

const logger = new Logger('DownloadExecutor');
const security = new SecurityService();

/**
 * DownloadExecutor - Creează și trimite fișierele ca ZIP
 */
class DownloadExecutor {
    constructor(bot) {
        this.bot = bot;
    }

    /**
     * Creează ZIP și trimite în Telegram
     */
    async sendProjectAsZip(chatId, projectId, userId) {
        // Validare securitate
        if (!security.validateProjectId(projectId)) {
            security.logSecurityEvent(userId, 'INVALID_PROJECT_ID', { projectId }, 'warning');
            return {
                success: false,
                message: '❌ ID proiect invalid.'
            };
        }

        // Validare acces user
        const { query } = require('../utils/db');
        const hasAccess = await security.validateUserAccess(userId, projectId, { query });
        if (!hasAccess) {
            security.logSecurityEvent(userId, 'UNAUTHORIZED_ACCESS', { projectId }, 'critical');
            return {
                success: false,
                message: '❌ Nu ai acces la acest proiect.'
            };
        }

        console.log(`📦 Creare ZIP pentru proiect ${projectId}`);
        
        const projectPath = `./projects/project-${projectId}`;
        const zipPath = `./temp/project-${projectId}.zip`;

        // Validare path
        const validPath = security.validatePath('./projects', `project-${projectId}`);
        if (!validPath) {
            security.logSecurityEvent(userId, 'PATH_TRAVERSAL_ATTEMPT', { projectId }, 'critical');
            return {
                success: false,
                message: '❌ Cale invalidă.'
            };
        }

        // Verificăm dacă există proiectul
        if (!fs.existsSync(projectPath)) {
            return {
                success: false,
                message: '❌ Proiectul nu există pe server.'
            };
        }

        try {
            // Trimitem mesaj că începem
            await this.bot.telegram.sendMessage(chatId, '📦 <b>Creez arhiva...</b>', { parse_mode: 'HTML' });

            // Creăm directorul temp dacă nu există
            if (!fs.existsSync('./temp')) {
                fs.mkdirSync('./temp', { recursive: true });
            }

            // Creăm ZIP
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            await new Promise((resolve, reject) => {
                output.on('close', resolve);
                archive.on('error', reject);
                archive.on('warning', (err) => {
                    if (err.code === 'ENOENT') {
                        console.warn('Archiver warning:', err);
                    } else {
                        reject(err);
                    }
                });

                archive.pipe(output);
                archive.directory(projectPath, false);
                archive.finalize();
            });

            const zipSize = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2);
            console.log(`✅ ZIP creat: ${zipSize} MB`);

            // Trimitem fișierul în Telegram
            await this.bot.telegram.sendMessage(chatId, 
                `📤 <b>Trimit arhiva...</b>\n<i>${zipSize} MB</i>`, 
                { parse_mode: 'HTML' }
            );

            await this.bot.telegram.sendDocument(chatId, {
                source: zipPath,
                filename: `project-${projectId}.zip`
            }, {
                caption: `✅ <b>Proiectul #${projectId}</b>\n\n` +
                         `📁 Descarcă și dezarhivează\n` +
                         `🚀 Poți deploya manual sau pe Railway`,
                parse_mode: 'HTML'
            });

            // Curățăm fișierul temporar
            fs.unlinkSync(zipPath);

            await logger.info('ZIP trimis', { projectId, size: zipSize });

            return {
                success: true,
                message: `✅ Arhiva trimisă! (${zipSize} MB)`
            };

        } catch (error) {
            console.error('❌ Eroare creare ZIP:', error);
            await logger.error('Eroare download', { projectId, error: error.message });
            
            // Curățăm în caz de eroare
            if (fs.existsSync(zipPath)) {
                fs.unlinkSync(zipPath);
            }

            return {
                success: false,
                message: `❌ Eroare la crearea arhivei: ${error.message}`
            };
        }
    }

    /**
     * Listează structura proiectului
     */
    async listProjectStructure(chatId, projectId) {
        try {
            const files = await listProjectFiles(projectId);
            
            if (files.length === 0) {
                return {
                    success: false,
                    message: '❌ Nu am găsit fișiere în proiect.'
                };
            }

            // Grupăm pe directoare
            const structure = {};
            files.forEach(file => {
                const parts = file.split('/');
                const dir = parts[0] || 'root';
                if (!structure[dir]) structure[dir] = 0;
                structure[dir]++;
            });

            let message = `📁 <b>Structură Proiect #${projectId}</b>\n\n`;
            message += `<b>Total fișiere:</b> ${files.length}\n\n`;
            
            Object.entries(structure).forEach(([dir, count]) => {
                message += `📂 ${dir}/ <i>(${count} fișiere)</i>\n`;
            });

            message += `\n<b>Comenzi disponibile:</b>\n`;
            message += `• <code>download zip</code> - Descarcă tot\n`;
            message += `• <code>vezi fișiere</code> - Listează detaliat`;

            return {
                success: true,
                message
            };

        } catch (error) {
            return {
                success: false,
                message: `❌ Eroare: ${error.message}`
            };
        }
    }

    /**
     * Trimite fișier individual
     */
    async sendFile(chatId, projectId, filePath) {
        const fullPath = `./projects/project-${projectId}/${filePath}`;

        try {
            if (!fs.existsSync(fullPath)) {
                return {
                    success: false,
                    message: `❌ Fișierul nu există: ${filePath}`
                };
            }

            const stats = fs.statSync(fullPath);
            
            // Dacă e prea mare (>2MB), trimitem ca document
            if (stats.size > 2 * 1024 * 1024) {
                await this.bot.telegram.sendDocument(chatId, {
                    source: fullPath,
                    filename: path.basename(filePath)
                });
            } else {
                // Citim conținutul pentru fișiere mici
                const content = fs.readFileSync(fullPath, 'utf8');
                const extension = path.extname(filePath).slice(1);
                
                await this.bot.telegram.sendMessage(chatId, 
                    `📄 <b>${filePath}</b>\n\n<pre language="${extension}">${content.substring(0, 3500)}</pre>`,
                    { parse_mode: 'HTML' }
                );
            }

            return { success: true, message: '✅ Fișier trimis!' };

        } catch (error) {
            return {
                success: false,
                message: `❌ Eroare: ${error.message}`
            };
        }
    }
}

module.exports = { DownloadExecutor };
