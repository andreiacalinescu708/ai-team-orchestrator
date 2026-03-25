const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('../utils/logger');
const { SecurityService } = require('./securityService');

const execAsync = promisify(exec);
const logger = new Logger('SurgeService');
const security = new SecurityService();

/**
 * Service pentru deploy temporar pe Surge.sh
 * Site-uri publice, accesibile instant fără login
 */
class SurgeService {
    constructor() {
        this.activeDeploys = new Map();
    }

    /**
     * Deploy site pe Surge - PUBLIC, fără autentificare pentru vizitatori
     */
    async deploy(projectId, projectPath, userId, durationHours = 24) {
        try {
            // Validare securitate
            if (!security.validateProjectId(projectId)) {
                return { success: false, message: '❌ ID proiect invalid.' };
            }

            // Verificăm credențialele
            if (!process.env.SURGE_LOGIN || !process.env.SURGE_TOKEN) {
                return {
                    success: false,
                    message: '❌ Surge neconfigurat. Contactează adminul.'
                };
            }

            // Găsim folderul cu build-ul
            const buildPath = await this.findBuildPath(projectPath);
            if (!buildPath) {
                return { success: false, message: '❌ Nu am găsit fișierele site-ului.' };
            }

            await logger.info(`Deploying to Surge for project ${projectId}`);

            // Generăm URL unic (random)
            const randomId = Math.random().toString(36).substring(2, 10);
            const subdomain = `ai-${projectId}-${randomId}`;
            const url = `https://${subdomain}.surge.sh`;

            // Facem deploy cu Surge CLI
            const env = {
                ...process.env,
                SURGE_LOGIN: process.env.SURGE_LOGIN,
                SURGE_TOKEN: process.env.SURGE_TOKEN
            };

            await execAsync(
                `npx surge ${buildPath} ${url} --token ${process.env.SURGE_TOKEN}`,
                { env, timeout: 60000 }
            );

            // Setăm timer pentru ștergere
            const durationMs = durationHours * 60 * 60 * 1000;
            const expiresAt = new Date(Date.now() + durationMs);
            
            const teardownTimeout = setTimeout(() => {
                this.teardown(projectId);
            }, durationMs);

            this.activeDeploys.set(projectId, {
                url,
                subdomain,
                teardownTimeout,
                expiresAt
            });

            await logger.info(`Surge deploy successful`, { projectId, url, expiresAt });

            return {
                success: true,
                url,
                message: `🚀 Site public live!`,
                expiresAt,
                durationHours,
                isPublic: true
            };

        } catch (error) {
            await logger.error('Surge deploy failed', { projectId, error: error.message });
            return { success: false, message: `❌ Eroare: ${error.message}` };
        }
    }

    async findBuildPath(projectPath) {
        const possiblePaths = [
            path.join(projectPath, 'frontend', 'dist'),
            path.join(projectPath, 'frontend', 'build'),
            path.join(projectPath, 'dist'),
            path.join(projectPath, 'build'),
            path.join(projectPath, 'frontend'),
            projectPath
        ];

        for (const buildPath of possiblePaths) {
            try {
                await fs.access(path.join(buildPath, 'index.html'));
                return buildPath;
            } catch (e) { continue; }
        }
        return null;
    }

    async teardown(projectId) {
        try {
            const deploy = this.activeDeploys.get(projectId);
            if (!deploy) return;

            await execAsync(
                `npx surge teardown ${deploy.url} --token ${process.env.SURGE_TOKEN}`,
                { timeout: 30000 }
            );

            clearTimeout(deploy.teardownTimeout);
            this.activeDeploys.delete(projectId);

        } catch (error) {
            console.error('Teardown error:', error);
        }
    }

    getDeployInfo(projectId) {
        const deploy = this.activeDeploys.get(projectId);
        if (!deploy) return { active: false };

        const timeLeft = deploy.expiresAt.getTime() - Date.now();
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        
        return {
            active: true,
            url: deploy.url,
            expiresAt: deploy.expiresAt,
            timeLeft: `${hoursLeft}h`,
            isPublic: true
        };
    }
}

module.exports = { SurgeService };
