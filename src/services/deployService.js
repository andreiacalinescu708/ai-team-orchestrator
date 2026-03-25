const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('../utils/logger');

const execAsync = promisify(exec);
const logger = new Logger('DeployService');

/**
 * Service pentru deploy temporar pe Surge.sh
 */
class DeployService {
    constructor() {
        this.activeDeploys = new Map(); // projectId -> {url, teardownTimeout}
    }

    /**
     * Deploy site temporar
     * @param {number} projectId - ID proiect
     * @param {string} projectPath - Calea către folderul cu site-ul
     * @param {number} durationHours - Cât timp rămâne live (default 5 ore)
     * @returns {Promise<{success: boolean, url?: string, message: string}>}
     */
    async deployPreview(projectId, projectPath, durationHours = 5) {
        try {
            // Verificăm dacă există deja un deploy activ
            if (this.activeDeploys.has(projectId)) {
                const existing = this.activeDeploys.get(projectId);
                return {
                    success: true,
                    url: existing.url,
                    message: `ℹ️ Site-ul e deja live!`,
                    expiresAt: existing.expiresAt
                };
            }

            // Verificăm credențialele Surge
            if (!process.env.SURGE_LOGIN || !process.env.SURGE_TOKEN) {
                return {
                    success: false,
                    message: '❌ Surge neconfigurat. Contactează adminul.'
                };
            }

            // Găsim folderul cu build-ul (dist, build, sau root)
            const buildPath = await this.findBuildPath(projectPath);
            if (!buildPath) {
                return {
                    success: false,
                    message: '❌ Nu am găsit fișierele site-ului'
                };
            }

            // Generăm URL unic
            const randomId = Math.random().toString(36).substring(2, 8);
            const subdomain = `project-${projectId}-${randomId}`;
            const url = `https://${subdomain}.surge.sh`;

            // Facem deploy
            await logger.info(`Deploying preview for project ${projectId}`, { url });
            
            const env = {
                ...process.env,
                SURGE_LOGIN: process.env.SURGE_LOGIN,
                SURGE_TOKEN: process.env.SURGE_TOKEN
            };

            await execAsync(
                `npx surge ${buildPath} ${url} --token ${process.env.SURGE_TOKEN}`,
                { 
                    env,
                    timeout: 60000,
                    cwd: buildPath
                }
            );

            // Setăm timer pentru ștergere
            const durationMs = durationHours * 60 * 60 * 1000;
            const expiresAt = new Date(Date.now() + durationMs);
            
            const teardownTimeout = setTimeout(() => {
                this.teardown(projectId);
            }, durationMs);

            // Salvăm în map
            this.activeDeploys.set(projectId, {
                url,
                subdomain,
                teardownTimeout,
                expiresAt
            });

            await logger.info(`Preview deployed`, { projectId, url, expiresAt });

            return {
                success: true,
                url,
                message: `✅ Site-ul e live!`,
                expiresAt,
                durationHours
            };

        } catch (error) {
            await logger.error('Deploy failed', { projectId, error: error.message });
            return {
                success: false,
                message: `❌ Eroare deploy: ${error.message}`
            };
        }
    }

    /**
     * Găsește folderul cu build-ul
     */
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
                const indexPath = path.join(buildPath, 'index.html');
                await fs.access(indexPath);
                return buildPath;
            } catch (e) {
                continue;
            }
        }

        return null;
    }

    /**
     * Șterge deploy-ul
     */
    async teardown(projectId) {
        try {
            const deploy = this.activeDeploys.get(projectId);
            if (!deploy) return;

            await logger.info(`Tearing down preview for project ${projectId}`);

            // Ștergem de pe Surge
            await execAsync(
                `npx surge teardown ${deploy.url} --token ${process.env.SURGE_TOKEN}`,
                { env: process.env, timeout: 30000 }
            );

            // Curățăm timeout-ul
            clearTimeout(deploy.teardownTimeout);
            this.activeDeploys.delete(projectId);

            await logger.info(`Preview torn down`, { projectId, url: deploy.url });

        } catch (error) {
            await logger.error('Teardown failed', { projectId, error: error.message });
        }
    }

    /**
     * Prelungește durata unui deploy
     */
    async extendDuration(projectId, additionalHours) {
        const deploy = this.activeDeploys.get(projectId);
        if (!deploy) {
            return { success: false, message: '❌ Site-ul nu mai e activ' };
        }

        // Resetăm timer-ul
        clearTimeout(deploy.teardownTimeout);
        
        const additionalMs = additionalHours * 60 * 60 * 1000;
        deploy.expiresAt = new Date(deploy.expiresAt.getTime() + additionalMs);
        
        deploy.teardownTimeout = setTimeout(() => {
            this.teardown(projectId);
        }, deploy.expiresAt.getTime() - Date.now());

        return {
            success: true,
            message: `✅ Durata prelungită cu ${additionalHours} ore`,
            newExpiresAt: deploy.expiresAt
        };
    }

    /**
     * Info despre deploy activ
     */
    getDeployInfo(projectId) {
        const deploy = this.activeDeploys.get(projectId);
        if (!deploy) {
            return { active: false };
        }

        const timeLeft = deploy.expiresAt.getTime() - Date.now();
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

        return {
            active: true,
            url: deploy.url,
            expiresAt: deploy.expiresAt,
            timeLeft: `${hoursLeft}h ${minutesLeft}m`
        };
    }

    /**
     * Lista toate deploy-urile active
     */
    getAllActiveDeploys() {
        return Array.from(this.activeDeploys.entries()).map(([projectId, deploy]) => ({
            projectId,
            url: deploy.url,
            expiresAt: deploy.expiresAt
        }));
    }
}

module.exports = { DeployService };
