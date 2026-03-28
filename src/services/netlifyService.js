const fetch = require('node-fetch');
const FormData = require('form-data');
const { Logger } = require('../utils/logger');
const { SecurityService } = require('./securityService');
const { FileStorageService } = require('./fileStorageService');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const logger = new Logger('NetlifyService');
const security = new SecurityService();
const fileStorage = new FileStorageService();

/**
 * Service pentru deploy pe Netlify folosind REST API
 * Site-uri publice, fără autentificare pentru vizitatori
 */
class NetlifyService {
    constructor() {
        this.activeDeploys = new Map();
        this.apiBase = 'https://api.netlify.com/api/v1';
        this.token = process.env.NETLIFY_TOKEN;
    }

    /**
     * Deploy site pe Netlify
     */
    async deploy(projectId, projectPath, userId, durationHours = 24) {
        try {
            // Validare
            if (!security.validateProjectId(projectId)) {
                return { success: false, message: '❌ ID proiect invalid.' };
            }

            if (!this.token) {
                return { success: false, message: '❌ NETLIFY_TOKEN neconfigurat.' };
            }

            // Exportăm fișierele din DB pe disk
            console.log(`📦 Export fișiere din DB pentru proiect ${projectId}...`);
            const exportResult = await fileStorage.exportToDisk(projectId, projectPath);
            if (!exportResult.success) {
                return { success: false, message: '❌ Nu am putut exporta fișierele.' };
            }
            console.log(`✅ ${exportResult.fileCount} fișiere exportate`);

            // Verificăm dacă e proiect Node.js și facem build
            const hasPackageJson = await this.fileExists(path.join(projectPath, 'package.json'));
            if (hasPackageJson) {
                console.log(`📦 Proiect Node.js detectat, facem build...`);
                const buildResult = await this.buildProject(projectPath);
                if (!buildResult.success) {
                    return { success: false, message: `❌ Eroare build: ${buildResult.error}` };
                }
                console.log(`✅ Build complet`);
            }

            // Găsim folderul cu build-ul
            const buildPath = await this.findBuildPath(projectPath);
            console.log(`🔍 Build path găsit: ${buildPath}`);
            
            if (!buildPath) {
                // Listăm ce fișiere există în proiect pentru debug
                try {
                    const files = await fs.readdir(projectPath, { recursive: true });
                    console.log(`📂 Fișiere în ${projectPath}:`, files.slice(0, 20));
                } catch (e) {
                    console.log(`❌ Nu pot citi ${projectPath}:`, e.message);
                }
                return { success: false, message: '❌ Nu am găsit fișierele site-ului (lipsă index.html).' };
            }

            // Verificăm ce fișiere sunt în buildPath
            try {
                const buildFiles = await fs.readdir(buildPath, { recursive: true });
                console.log(`📂 Fișiere în build path (${buildPath}):`, buildFiles.slice(0, 20));
            } catch (e) {
                console.log(`❌ Nu pot citi build path:`, e.message);
            }

            await logger.info(`Deploying to Netlify for project ${projectId} from ${buildPath}`);

            // Creăm site-ul pe Netlify
            const siteName = `ai-project-${projectId}-${Date.now()}`;
            const site = await this.createSite(siteName);
            
            if (!site.success) {
                throw new Error(site.error);
            }

            // Facem deploy
            const deploy = await this.deploySite(site.siteId, buildPath);
            
            if (!deploy.success) {
                throw new Error(deploy.error);
            }

            // Setăm timer pentru ștergere
            const durationMs = durationHours * 60 * 60 * 1000;
            const expiresAt = new Date(Date.now() + durationMs);
            
            const teardownTimeout = setTimeout(() => {
                this.teardown(projectId);
            }, durationMs);

            this.activeDeploys.set(projectId, {
                url: deploy.url,
                siteId: site.siteId,
                deployId: deploy.deployId,
                teardownTimeout,
                expiresAt
            });

            await logger.info(`Netlify deploy successful`, { projectId, url: deploy.url });

            return {
                success: true,
                url: deploy.url,
                message: `🚀 Site public live pe Netlify!`,
                expiresAt,
                durationHours,
                isPublic: true
            };

        } catch (error) {
            await logger.error('Netlify deploy failed', { projectId, error: error.message });
            return { success: false, message: `❌ Eroare deploy: ${error.message}` };
        }
    }

    /**
     * Crează site pe Netlify
     */
    async createSite(name) {
        try {
            const response = await fetch(`${this.apiBase}/sites`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name,
                    ssl: true,
                    force_ssl: true
                })
            });

            const data = await response.json();

            if (!response.ok) {
                return { success: false, error: data.message || 'Eroare creare site' };
            }

            return { 
                success: true, 
                siteId: data.id,
                url: data.ssl_url || data.url
            };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Deploy fișiere pe site
     */
    async deploySite(siteId, buildPath) {
        try {
            // Creăm ZIP cu fișierele
            const zipBuffer = await this.createZip(buildPath);

            const form = new FormData();
            form.append('file', zipBuffer, { filename: 'deploy.zip' });

            const response = await fetch(`${this.apiBase}/sites/${siteId}/deploys`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    ...form.getHeaders()
                },
                body: form
            });

            const data = await response.json();

            if (!response.ok) {
                return { success: false, error: data.message || 'Eroare deploy' };
            }

            // Așteptăm să se termine deploy-ul
            let deployReady = false;
            let attempts = 0;
            let deployData = data;

            while (!deployReady && attempts < 30) {
                await new Promise(r => setTimeout(r, 2000));
                
                const statusResponse = await fetch(`${this.apiBase}/deploys/${data.id}`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                
                deployData = await statusResponse.json();
                
                if (deployData.state === 'ready' || deployData.state === 'current') {
                    deployReady = true;
                }
                
                attempts++;
            }

            return {
                success: true,
                deployId: data.id,
                url: deployData.ssl_url || deployData.url
            };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Crează ZIP cu fișierele
     */
    async createZip(buildPath) {
        const archiver = require('archiver');
        const { PassThrough } = require('stream');

        return new Promise((resolve, reject) => {
            const archive = archiver('zip', { zlib: { level: 9 } });
            const stream = new PassThrough();
            const chunks = [];

            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);

            archive.on('error', reject);
            
            archive.pipe(stream);
            archive.directory(buildPath, false);
            archive.finalize();
        });
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

    /**
     * Verifică dacă un fișier există
     */
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Face build pentru proiecte Node.js (React, Vue, etc.)
     */
    async buildProject(projectPath) {
        try {
            // Citim package.json pentru a vedea ce scripturi există
            const packageJsonPath = path.join(projectPath, 'package.json');
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
            
            // Verificăm dacă există scriptul 'build'
            if (!packageJson.scripts || !packageJson.scripts.build) {
                return { success: false, error: 'Nu există scriptul "build" în package.json' };
            }

            // Instalăm dependențele
            console.log(`📦 Instalare dependențe...`);
            await execAsync('npm install', { 
                cwd: projectPath, 
                timeout: 120000,
                env: { ...process.env, NPM_CONFIG_PRODUCTION: 'false' }
            });

            // Facem build
            console.log(`🔨 Build proiect...`);
            await execAsync('npm run build', { 
                cwd: projectPath, 
                timeout: 120000 
            });

            return { success: true };
        } catch (error) {
            console.error('Eroare build:', error);
            return { success: false, error: error.message };
        }
    }

    async teardown(projectId) {
        try {
            const deploy = this.activeDeploys.get(projectId);
            if (!deploy) return;

            // Ștergem site-ul de pe Netlify
            await fetch(`${this.apiBase}/sites/${deploy.siteId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            clearTimeout(deploy.teardownTimeout);
            this.activeDeploys.delete(projectId);

            await logger.info(`Netlify site deleted`, { projectId, siteId: deploy.siteId });

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

module.exports = { NetlifyService };
