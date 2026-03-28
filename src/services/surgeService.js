const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('../utils/logger');
const { SecurityService } = require('./securityService');
const { FileStorageService } = require('./fileStorageService');

const logger = new Logger('SurgeService');
const security = new SecurityService();
const fileStorage = new FileStorageService();

/**
 * Service pentru deploy pe Surge.sh folosind API HTTP
 * Evită problemele de permisiune cu CLI în container
 */
class SurgeService {
    constructor() {
        this.activeDeploys = new Map();
        this.apiBase = 'https://surge.sh';
    }

    /**
     * Deploy site pe Surge folosind API
     */
    async deploy(projectId, projectPath, userId, durationHours = 24) {
        try {
            // Validare securitate
            if (!security.validateProjectId(projectId)) {
                return { success: false, message: '❌ ID proiect invalid.' };
            }

            if (!process.env.SURGE_LOGIN || !process.env.SURGE_TOKEN) {
                return { success: false, message: '❌ Surge neconfigurat.' };
            }

            // Exportăm fișierele din DB pe disk
            console.log(`📦 Export fișiere din DB pentru proiect ${projectId}...`);
            const exportResult = await fileStorage.exportToDisk(projectId, projectPath);
            if (!exportResult.success) {
                console.warn('⚠️ Export eșuat:', exportResult.error);
            } else {
                console.log(`✅ ${exportResult.fileCount} fișiere exportate`);
            }

            // Găsim folderul cu build-ul
            const buildPath = await this.findBuildPath(projectPath);
            if (!buildPath) {
                return { success: false, message: '❌ Nu am găsit fișierele site-ului.' };
            }

            await logger.info(`Deploying to Surge for project ${projectId}`);

            // Generăm URL unic
            const randomId = Math.random().toString(36).substring(2, 10);
            const subdomain = `ai-${projectId}-${randomId}`;
            const url = `${subdomain}.surge.sh`;

            // Uploadăm fișierele folosind API-ul Surge
            const uploadResult = await this.uploadFiles(buildPath, url);
            
            if (!uploadResult.success) {
                throw new Error(uploadResult.error);
            }

            // Setăm timer pentru ștergere
            const durationMs = durationHours * 60 * 60 * 1000;
            const expiresAt = new Date(Date.now() + durationMs);
            
            const teardownTimeout = setTimeout(() => {
                this.teardown(projectId);
            }, durationMs);

            const fullUrl = `https://${url}`;
            this.activeDeploys.set(projectId, {
                url: fullUrl,
                subdomain,
                teardownTimeout,
                expiresAt
            });

            await logger.info(`Surge deploy successful`, { projectId, url: fullUrl });

            return {
                success: true,
                url: fullUrl,
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

    /**
     * Upload fișiere pe Surge via API
     */
    async uploadFiles(buildPath, domain) {
        try {
            const FormData = require('form-data');
            const fetch = require('node-fetch');
            
            const form = new FormData();
            
            // Colectăm toate fișierele
            const files = await this.collectFiles(buildPath);
            
            for (const file of files) {
                const relativePath = path.relative(buildPath, file);
                const content = await fs.readFile(file);
                form.append(relativePath, content, { filename: relativePath });
            }

            // Facem upload
            const response = await fetch(`https://surge.sh/${domain}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${process.env.SURGE_TOKEN}`,
                    ...form.getHeaders()
                },
                body: form
            });

            if (!response.ok) {
                const errorText = await response.text();
                return { success: false, error: `Surge API error: ${response.status} - ${errorText}` };
            }

            return { success: true };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Colectează toate fișierele din folder
     */
    async collectFiles(dir, files = []) {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await this.collectFiles(fullPath, files);
            } else {
                files.push(fullPath);
            }
        }

        return files;
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
                await fs.access(path.join(buildPath, 'index.html'));
                return buildPath;
            } catch (e) { continue; }
        }

        return null;
    }

    async teardown(projectId) {
        // Implementare ștergere dacă e necesar
        this.activeDeploys.delete(projectId);
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
