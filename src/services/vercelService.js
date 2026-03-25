const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('../utils/logger');
const { SecurityService } = require('./securityService');

const execAsync = promisify(exec);
const logger = new Logger('VercelService');
const security = new SecurityService();

/**
 * Service pentru deploy pe Vercel
 */
class VercelService {
    constructor() {
        this.activeDeploys = new Map(); // projectId -> {url, deploymentId}
    }

    /**
     * Deploy site pe Vercel
     * @param {number} projectId - ID proiect
     * @param {string} projectPath - Calea către folderul cu site-ul
     * @param {string} projectName - Numele proiectului
     * @returns {Promise<{success: boolean, url?: string, message: string}>}
     */
    async deploy(projectId, projectPath, userId, projectName = 'ai-project') {
        // Validare securitate
        if (!security.validateProjectId(projectId)) {
            security.logSecurityEvent(userId, 'INVALID_PROJECT_ID_DEPLOY', { projectId }, 'warning');
            return {
                success: false,
                message: '❌ ID proiect invalid.'
            };
        }

        // Validare path
        const validPath = security.validatePath('./projects', `project-${projectId}`);
        if (!validPath) {
            security.logSecurityEvent(userId, 'PATH_TRAVERSAL_DEPLOY', { projectId }, 'critical');
            return {
                success: false,
                message: '❌ Cale invalidă.'
            };
        }

        try {
            // Verificăm dacă există deja un deploy activ
            if (this.activeDeploys.has(projectId)) {
                const existing = this.activeDeploys.get(projectId);
                return {
                    success: true,
                    url: existing.url,
                    message: `ℹ️ Site-ul e deja live!`,
                    isExisting: true
                };
            }

            // Verificăm credențialele Vercel
            if (!process.env.VERCEL_TOKEN) {
                return {
                    success: false,
                    message: '❌ VERCEL_TOKEN neconfigurat. Contactează adminul.'
                };
            }

            // Găsim folderul cu build-ul
            const buildPath = await this.findBuildPath(projectPath);
            if (!buildPath) {
                return {
                    success: false,
                    message: '❌ Nu am găsit fișierele site-ului (index.html)'
                };
            }

            await logger.info(`Deploying to Vercel for project ${projectId}`, { buildPath });

            // Facem deploy cu Vercel CLI
            const projectSlug = `ai-project-${projectId}`;
            
            const env = {
                ...process.env,
                VERCEL_TOKEN: process.env.VERCEL_TOKEN
            };

            // Comanda de deploy
            const deployCmd = `npx vercel ${buildPath} --token ${process.env.VERCEL_TOKEN} --name ${projectSlug} --yes --prod`;
            
            const { stdout, stderr } = await execAsync(deployCmd, { 
                env,
                timeout: 120000,
                cwd: buildPath
            });

            // Extragem URL-ul din output
            const urlMatch = stdout.match(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app/) 
                          || stderr.match(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app/);
            
            if (!urlMatch) {
                throw new Error('Nu am putut extrage URL-ul din răspunsul Vercel');
            }

            const url = urlMatch[0];

            // Salvăm în map
            this.activeDeploys.set(projectId, {
                url,
                projectSlug,
                deployedAt: new Date()
            });

            await logger.info(`Vercel deploy successful`, { projectId, url });

            return {
                success: true,
                url,
                message: `✅ Site-ul e live pe Vercel!`,
                isPermanent: true
            };

        } catch (error) {
            await logger.error('Vercel deploy failed', { projectId, error: error.message });
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
     * Info despre deploy
     */
    getDeployInfo(projectId) {
        const deploy = this.activeDeploys.get(projectId);
        if (!deploy) {
            return { active: false };
        }

        return {
            active: true,
            url: deploy.url,
            deployedAt: deploy.deployedAt,
            isPermanent: true
        };
    }

    /**
     * Lista toate deploy-urile active
     */
    getAllActiveDeploys() {
        return Array.from(this.activeDeploys.entries()).map(([projectId, deploy]) => ({
            projectId,
            url: deploy.url,
            deployedAt: deploy.deployedAt
        }));
    }
}

module.exports = { VercelService };
