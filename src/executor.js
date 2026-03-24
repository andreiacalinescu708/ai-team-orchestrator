const { ArchitectWorker } = require('./agents/workers/architect');
const { BackendWorker } = require('./agents/workers/backend');
const { FrontendWorker } = require('./agents/workers/frontend');
const { DevOpsWorker } = require('./agents/workers/devops');
const { createProjectStructure } = require('./utils/project');
const { query } = require('./utils/db');
const { Logger } = require('./utils/logger');

const logger = new Logger('Executor');

/**
 * Executor - Rulează planul de generare pas cu pas
 */
class PlanExecutor {
    constructor(bot, chatId) {
        this.bot = bot;
        this.chatId = chatId;
        this.workers = {
            architect: new ArchitectWorker(this),
            backend: new BackendWorker(this),
            frontend: new FrontendWorker(this),
            devops: new DevOpsWorker(this)
        };
    }

    /**
     * Trimite progres către utilizator
     */
    async sendProgress(projectId, message) {
        try {
            // Salvăm în DB
            await query(
                'INSERT INTO logs (level, module, message, metadata) VALUES ($1, $2, $3, $4)',
                ['INFO', 'Executor', message, JSON.stringify({ projectId, type: 'progress' })]
            );

            // Trimitem în Telegram dacă avem chatId
            if (this.chatId) {
                await this.bot.telegram.sendMessage(this.chatId, message);
            }
        } catch (err) {
            console.error('Eroare trimitere progres:', err);
        }
    }

    /**
     * Execută planul complet pentru un proiect
     */
    async executePlan(projectId, discoveryData) {
        const startTime = Date.now();
        
        await logger.info('Începe execuție plan', { projectId });
        await this.sendProgress(projectId, '🚀 <b>Pornim execuția!</b>\nGenerăm codul complet...');
        
        // ETA estimat
        await this.sendProgress(projectId, '⏱️ <i>ETA: ~3-5 minute</i>');

        // Update status în DB
        await query(
            'UPDATE projects SET status = $1 WHERE id = $2',
            ['executing', projectId]
        );

        try {
            // 1. Creăm structura de proiect
            await this.sendProgress(projectId, '📁 Creăm structura de proiect...');
            await createProjectStructure(projectId, discoveryData.summary?.substring(0, 50) || 'Project');

            // 2. Executăm workerii secvențial
            const results = {
                architect: null,
                backend: null,
                frontend: null,
                devops: null
            };

            // Architect
            try {
                results.architect = await this.workers.architect.execute(projectId, discoveryData);
            } catch (err) {
                await logger.error('Eroare ArchitectWorker', { projectId, error: err.message });
                throw new Error(`ArchitectWorker failed: ${err.message}`);
            }

            // Backend (depinde de architectură)
            try {
                results.backend = await this.workers.backend.execute(
                    projectId, 
                    discoveryData, 
                    results.architect.architecture
                );
            } catch (err) {
                await logger.error('Eroare BackendWorker', { projectId, error: err.message });
                throw new Error(`BackendWorker failed: ${err.message}`);
            }

            // Frontend (depinde de arhitectură)
            try {
                results.frontend = await this.workers.frontend.execute(
                    projectId, 
                    discoveryData, 
                    results.architect.architecture
                );
            } catch (err) {
                await logger.error('Eroare FrontendWorker', { projectId, error: err.message });
                throw new Error(`FrontendWorker failed: ${err.message}`);
            }

            // DevOps (depinde de toți ceilalți)
            try {
                results.devops = await this.workers.devops.execute(
                    projectId, 
                    discoveryData, 
                    results.architect.architecture
                );
            } catch (err) {
                await logger.error('Eroare DevOpsWorker', { projectId, error: err.message });
                throw new Error(`DevOpsWorker failed: ${err.message}`);
            }

            // 3. Finalizare
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            
            await query(
                'UPDATE projects SET status = $1, updated_at = NOW() WHERE id = $2',
                ['completed', projectId]
            );

            const allFiles = [
                ...results.architect.files,
                ...results.backend.files,
                ...results.frontend.files,
                ...results.devops.files
            ];

            await logger.info('Plan executat cu succes', { 
                projectId, 
                duration, 
                files: allFiles.length 
            });

            await this.sendProgress(projectId, `✅ Proiect complet în ${duration}s!`);

            return {
                success: true,
                projectId,
                duration,
                files: allFiles,
                architecture: results.architect.architecture
            };

        } catch (error) {
            await query(
                'UPDATE projects SET status = $1 WHERE id = $2',
                ['failed', projectId]
            );

            await logger.error('Execuție plan eșuată', { projectId, error: error.message });
            await this.sendProgress(projectId, `❌ Eroare: ${error.message}`);

            throw error;
        }
    }
}

module.exports = { PlanExecutor };
