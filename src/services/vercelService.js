const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('../utils/logger');
const { SecurityService } = require('./securityService');

const logger = new Logger('VercelService');
const security = new SecurityService();

/**
 * Service pentru deploy pe Vercel folosind API REST
 */
class VercelService {
    constructor() {
        this.activeDeploys = new Map();
        this.apiBase = 'https://api.vercel.com';
    }

    /**
     * Deploy site pe Vercel via API
     */
    async deploy(projectId, projectPath, userId, projectName = 'ai-project') {
        try {
            // Validare securitate
            if (!security.validateProjectId(projectId)) {
                security.logSecurityEvent(userId, 'INVALID_PROJECT_ID_DEPLOY', { projectId }, 'warning');
                return { success: false, message: '❌ ID proiect invalid.' };
            }

            if (!process.env.VERCEL_TOKEN) {
                return { success: false, message: '❌ VERCEL_TOKEN neconfigurat.' };
            }

            // Verificăm dacă există deja deploy
            if (this.activeDeploys.has(projectId)) {
                const existing = this.activeDeploys.get(projectId);
                return { success: true, url: existing.url, message: 'ℹ️ Site-ul e deja live!', isExisting: true };
            }

            // Găsim build path
            const buildPath = await this.findBuildPath(projectPath);
            if (!buildPath) {
                return { success: false, message: '❌ Nu am găsit fișierele site-ului.' };
            }

            await logger.info(`Deploying to Vercel for project ${projectId}`);

            // Creăm proiectul în Vercel
            const projectSlug = `ai-project-${projectId}-${Date.now()}`;
            const createProjectResponse = await this.createProject(projectSlug);
            
            if (!createProjectResponse.success) {
                throw new Error(createProjectResponse.error);
            }

            // Facem deploy
            const deployResponse = await this.createDeployment(buildPath, createProjectResponse.projectId);
            
            if (!deployResponse.success) {
                throw new Error(deployResponse.error);
            }

            const url = `https://${deployResponse.url}`;

            this.activeDeploys.set(projectId, {
                url,
                projectId: createProjectResponse.projectId,
                deploymentId: deployResponse.deploymentId,
                deployedAt: new Date()
            });

            await logger.info(`Vercel deploy successful`, { projectId, url });

            return { success: true, url, message: '✅ Site-ul e live pe Vercel!', isPermanent: true };

        } catch (error) {
            await logger.error('Vercel deploy failed', { projectId, error: error.message });
            return { success: false, message: `❌ Eroare deploy: ${error.message}` };
        }
    }

    /**
     * Crează proiect în Vercel
     */
    async createProject(name) {
        try {
            const response = await fetch(`${this.apiBase}/v9/projects`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name,
                    framework: null // Static site
                })
            });

            const data = await response.json();

            if (!response.ok) {
                // Dacă proiectul există deja, e ok
                if (data.error?.code === 'project_already_exists') {
                    return { success: true, projectId: name };
                }
                return { success: false, error: data.error?.message || 'Eroare creare proiect' };
            }

            return { success: true, projectId: data.id || name };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Crează deployment
     */
    async createDeployment(buildPath, projectId) {
        try {
            // Citim toate fișierele
            const files = await this.collectFiles(buildPath);
            
            // Facem upload la fișiere
            const fileUrls = await this.uploadFiles(files);
            
            // Creăm deployment
            const response = await fetch(`${this.apiBase}/v13/deployments`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: projectId,
                    project: projectId,
                    target: 'production',
                    files: fileUrls
                })
            });

            const data = await response.json();

            if (!response.ok) {
                return { success: false, error: data.error?.message || 'Eroare deployment' };
            }

            return { 
                success: true, 
                url: data.url,
                deploymentId: data.id 
            };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Colectează toate fișierele din folder
     */
    async collectFiles(dir, basePath = '') {
        const files = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.join(basePath, entry.name);

            if (entry.isDirectory()) {
                const subFiles = await this.collectFiles(fullPath, relativePath);
                files.push(...subFiles);
            } else {
                const content = await fs.readFile(fullPath);
                files.push({
                    path: relativePath,
                    content: content.toString('base64'),
                    encoding: 'base64'
                });
            }
        }

        return files;
    }

    /**
     * Upload fișiere la Vercel
     */
    async uploadFiles(files) {
        // Simplificat - returnăm direct fișierele pentru deployment
        return files.map(f => ({
            file: f.path,
            data: f.content,
            encoding: f.encoding
        }));
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

    getDeployInfo(projectId) {
        const deploy = this.activeDeploys.get(projectId);
        if (!deploy) return { active: false };
        return { active: true, url: deploy.url, deployedAt: deploy.deployedAt, isPermanent: true };
    }
}

module.exports = { VercelService };
