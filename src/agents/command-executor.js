const { exec } = require('child_process');
const { promisify } = require('util');
const { query } = require('../utils/db');
const { Logger } = require('../utils/logger');
const { GitHubExecutor } = require('./github-executor');
const { DownloadExecutor } = require('./download-executor');
const { PDFProcessor } = require('../skills/pdf-processor');

const execAsync = promisify(exec);
const logger = new Logger('CommandExecutor');

/**
 * CommandExecutor - Execută comenzile parsează
 */
class CommandExecutor {
    constructor(bot) {
        this.bot = bot;
        this.railwayToken = process.env.RAILWAY_TOKEN;
        this.github = new GitHubExecutor(bot);
        this.downloader = new DownloadExecutor(bot);
        this.pdf = new PDFProcessor();
    }

    /**
     * Execută o comandă
     */
    async execute(chatId, projectId, intent) {
        console.log(`⚡ Executare comandă: ${intent.type}`, intent);

        switch (intent.type) {
            case 'deploy':
                return await this.deploy(chatId, projectId, intent);
            case 'logs':
                return await this.getLogs(chatId, projectId, intent);
            case 'status':
                return await this.getStatus(chatId, projectId);
            case 'test':
                return await this.runTests(chatId, projectId);
            case 'env':
                return await this.setEnvVar(chatId, projectId, intent);
            case 'restart':
                return await this.restart(chatId, projectId, intent);
            case 'database':
                return await this.manageDatabase(chatId, projectId, intent);
            case 'github':
                return await this.handleGitHub(chatId, projectId, intent);
            case 'download':
                return await this.handleDownload(chatId, projectId, intent);
            case 'pdf':
                return await this.handlePDF(chatId, projectId, intent);
            default:
                return { success: false, message: '❌ Comandă necunoscută' };
        }
    }

    /**
     * Deploy pe Netlify
     */
    async deploy(chatId, projectId, intent) {
        await this.bot.telegram.sendMessage(chatId, '🚀 <b>Deploy în curs...</b>', { parse_mode: 'HTML' });

        try {
            // Exportăm fișierele din PostgreSQL
            const { FileStorageService } = require('../services/fileStorageService');
            const { NetlifyService } = require('../services/netlifyService');
            
            const fileStorage = new FileStorageService();
            const netlify = new NetlifyService();
            
            const projectPath = `./projects/project-${projectId}`;
            
            console.log(`📦 Export fișiere din DB pentru proiect ${projectId}...`);
            const exportResult = await fileStorage.exportToDisk(projectId, projectPath);
            
            if (!exportResult.success || exportResult.fileCount === 0) {
                return {
                    success: false,
                    message: `❌ Proiectul nu există în baza de date.`
                };
            }
            
            console.log(`✅ ${exportResult.fileCount} fișiere exportate`);

            // Deploy pe Netlify
            const result = await netlify.deploy(projectId, projectPath, null, 24);

            if (result.success) {
                return {
                    success: true,
                    message: `🚀 <b>Deploy complet!</b>\n\n🔗 <a href="${result.url}">${result.url}</a>\n\n✅ Site public live!`,
                    url: result.url
                };
            } else {
                return {
                    success: false,
                    message: `❌ <b>Eroare deploy:</b>\n${result.message}`
                };
            }
        } catch (error) {
            await logger.error('Eroare deploy', { projectId, error: error.message });
            return {
                success: false,
                message: `❌ <b>Eroare deploy:</b>\n<code>${error.message}</code>`
            };
        }
    }

    /**
     * Obține logs
     */
    async getLogs(chatId, projectId, intent) {
        await this.bot.telegram.sendMessage(chatId, `📋 <b>Preiau logs pentru ${intent.service}...</b>`, { parse_mode: 'HTML' });

        try {
            // Folosim railway CLI pentru logs
            const service = intent.service === 'backend' ? 'backend' : 'web';
            const { stdout } = await execAsync(`railway logs --service ${service} --tail 50`, {
                cwd: `./projects/project-${projectId}`,
                env: { ...process.env, RAILWAY_TOKEN: this.railwayToken },
                timeout: 30000
            });

            return {
                success: true,
                message: `📋 <b>Logs ${intent.service}:</b>\n\n<pre>${stdout.substring(0, 3500)}</pre>`
            };
        } catch (error) {
            // Fallback - citim din Docker local dacă există
            try {
                const { stdout } = await execAsync(`docker-compose logs --tail 50 ${intent.service}`, {
                    cwd: `./projects/project-${projectId}`,
                    timeout: 10000
                });
                
                return {
                    success: true,
                    message: `📋 <b>Logs locale ${intent.service}:</b>\n\n<pre>${stdout.substring(0, 3500)}</pre>`
                };
            } catch (e) {
                return {
                    success: false,
                    message: `❌ Nu am putut obține logs: ${error.message}`
                };
            }
        }
    }

    /**
     * Verifică status
     */
    async getStatus(chatId, projectId) {
        try {
            const project = await query('SELECT * FROM projects WHERE id = $1', [projectId]);
            if (!project.rows[0]) {
                return { success: false, message: '❌ Proiect negăsit' };
            }

            const p = project.rows[0];
            
            // Încercăm să luăm status de la Railway
            let railwayStatus = '🤔 Necunoscut';
            try {
                const { stdout } = await execAsync('railway status', {
                    cwd: `./projects/project-${projectId}`,
                    env: { ...process.env, RAILWAY_TOKEN: this.railwayToken },
                    timeout: 10000
                });
                railwayStatus = '✅ Online';
            } catch (e) {
                railwayStatus = '⚠️ Offline sau neconfigurat';
            }

            return {
                success: true,
                message: `📊 <b>Status Proiect #${projectId}</b>\n\n` +
                         `📝 Nume: ${p.name}\n` +
                         `📌 Status: ${p.status}\n` +
                         `🚀 Deploy: ${railwayStatus}\n` +
                         `📅 Creat: ${p.created_at.toLocaleDateString()}`
            };
        } catch (error) {
            return { success: false, message: `❌ Eroare: ${error.message}` };
        }
    }

    /**
     * Rulează teste
     */
    async runTests(chatId, projectId) {
        await this.bot.telegram.sendMessage(chatId, '🧪 <b>Rulez testele...</b>', { parse_mode: 'HTML' });

        try {
            // Verificăm dacă există teste
            const fs = require('fs');
            const testPath = `./projects/project-${projectId}/backend/package.json`;
            
            if (!fs.existsSync(testPath)) {
                return {
                    success: false,
                    message: `❌ Nu am găsit backend-ul proiectului.`
                };
            }
            
            const packageJson = JSON.parse(fs.readFileSync(testPath, 'utf8'));
            if (!packageJson.scripts || !packageJson.scripts.test) {
                return {
                    success: false,
                    message: `ℹ️ <b>Nu există teste configurate</b>\n\nProiectul nu are scriptul "test" în package.json.`
                };
            }

            // Verificăm dacă npm e disponibil
            try {
                await execAsync('npm --version');
            } catch (e) {
                return {
                    success: false,
                    message: `❌ <b>NPM nu e disponibil</b>\n\nNu pot rula testele în mediul curent.`
                };
            }

            const { stdout, stderr } = await execAsync('npm test', {
                cwd: `./projects/project-${projectId}/backend`,
                timeout: 60000
            });

            return {
                success: true,
                message: `✅ <b>Teste complete!</b>\n\n<pre>${stdout || stderr}</pre>`
            };
        } catch (error) {
            return {
                success: false,
                message: `❌ <b>Teste eșuate:</b>\n<code>${error.message}</code>\n\n<pre>${error.stdout || ''}</pre>`
            };
        }
    }

    /**
     * Setează variabilă de mediu
     */
    async setEnvVar(chatId, projectId, intent) {
        if (!intent.key) {
            return { success: false, message: '❌ Nu am înțeles ce variabilă să setez' };
        }

        try {
            // Folosim Railway CLI
            await execAsync(`railway variables set ${intent.key}="${intent.value}"`, {
                cwd: `./projects/project-${projectId}`,
                env: { ...process.env, RAILWAY_TOKEN: this.railwayToken }
            });

            await logger.info('Variabilă setată', { projectId, key: intent.key });

            return {
                success: true,
                message: `✅ <b>Variabilă setată:</b>\n<code>${intent.key}=${intent.value}</code>`
            };
        } catch (error) {
            // Fallback - salvăm în .env local
            try {
                const fs = require('fs').promises;
                const envPath = `./projects/project-${projectId}/backend/.env`;
                await fs.appendFile(envPath, `\n${intent.key}=${intent.value}\n`);
                
                return {
                    success: true,
                    message: `✅ <b>Variabilă salvată în .env:</b>\n<code>${intent.key}=${intent.value}</code>\n\n⚠️ Nu am putut seta în Railway, dar e salvată local.`
                };
            } catch (e) {
                return { success: false, message: `❌ Eroare: ${error.message}` };
            }
        }
    }

    /**
     * Restart servicii
     */
    async restart(chatId, projectId, intent) {
        await this.bot.telegram.sendMessage(chatId, `🔄 <b>Restart ${intent.service}...</b>`, { parse_mode: 'HTML' });

        try {
            if (intent.service === 'docker' || intent.service === 'all') {
                await execAsync('docker-compose restart', {
                    cwd: `./projects/project-${projectId}`,
                    timeout: 30000
                });
                
                return { success: true, message: `✅ <b>Docker services restartate!</b>` };
            }

            // Railway restart
            await execAsync(`railway restart`, {
                cwd: `./projects/project-${projectId}`,
                env: { ...process.env, RAILWAY_TOKEN: this.railwayToken }
            });

            return { success: true, message: `✅ <b>Serviciu restartat!</b>` };
        } catch (error) {
            return { success: false, message: `❌ Eroare restart: ${error.message}` };
        }
    }

    /**
     * Management bază de date
     */
    async manageDatabase(chatId, projectId, intent) {
        return {
            success: true,
            message: `🗄️ <b>Management DB</b>\n\n` +
                     `Comenzi disponibile:\n` +
                     `• <code>railway connect postgres</code>\n` +
                     `• <code>railway run psql</code>\n\n` +
                     `Sau poți folosi Adminer/pgAdmin local.`
        };
    }

    /**
     * Gestionează comenzi GitHub
     */
    async handleGitHub(chatId, projectId, intent) {
        const project = await query('SELECT * FROM projects WHERE id = $1', [projectId]);
        const projectName = project.rows[0]?.name || `Project ${projectId}`;

        switch (intent.action) {
            case 'init':
                return await this.github.initRepo(chatId, projectId, projectName);
            case 'push':
                return await this.github.pushCode(chatId, projectId);
            case 'pr':
                return await this.github.createPullRequest(chatId, projectId, 'Update from Telegram');
            case 'status':
                return await this.github.getActionsStatus(chatId, projectId);
            default:
                return { success: false, message: '❌ Acțiune GitHub necunoscută' };
        }
    }

    /**
     * Gestionează comenzi de download
     */
    async handleDownload(chatId, projectId, intent) {
        switch (intent.downloadType) {
            case 'zip':
                return await this.downloader.sendProjectAsZip(chatId, projectId);
            case 'structure':
                return await this.downloader.listProjectStructure(chatId, projectId);
            case 'file':
                // Extragem path-ul fișierului din mesaj
                return {
                    success: true,
                    message: `📁 <b>Fișiere disponibile</b>\n\n` +
                             `Folosește <code>/files</code> pentru a vedea lista completă, ` +
                             `apoi scrie "trimite fișierul backend/src/server.js"`
                };
            default:
                return await this.downloader.sendProjectAsZip(chatId, projectId);
        }
    }

    /**
     * Gestionează comenzi PDF
     */
    async handlePDF(chatId, projectId, intent) {
        return {
            success: true,
            message: `📄 <b>Procesare PDF</b>\n\n` +
                     `Pentru a procesa un PDF, trimite fișierul direct în chat.\n\n` +
                     `Ce pot face:\n` +
                     `• 📖 Extrage text și date\n` +
                     `• 📊 Identifică tabele\n` +
                     `• 📝 Generează rezumat\n` +
                     `• 📄 Creează PDF nou\n\n` +
                     `Trimite un PDF și scrie ce vrei să fac cu el!`
        };
    }
}

module.exports = { CommandExecutor };
