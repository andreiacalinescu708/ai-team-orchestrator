const { callKimiFast } = require('../utils/kimi-optimized');
const { Logger } = require('../utils/logger');
const logger = new Logger('KimiDeployService');

/**
 * Service pentru deploy folosind funcția nativă de preview din Kimi
 * Kimi generează un link temporar (ex: https://xxxxx.ok.kimi.link)
 */
class KimiDeployService {
    constructor() {
        this.activeDeploys = new Map();
    }

    /**
     * Deploy site folosind Kimi API
     * Trimitem codul lui Kimi și el generează preview link
     */
    async deploy(projectId, files, durationHours = 24) {
        try {
            await logger.info(`Deploying via Kimi for project ${projectId}`);

            // Pregătim fișierele pentru Kimi
            const filesForKimi = files.map(f => ({
                path: f.path,
                content: f.content
            }));

            // Cerem lui Kimi să publice site-ul
            const messages = [
                {
                    role: 'system',
                    content: 'Ești un deployment service. Publică fișierele HTML/CSS/JS și returnează URL-ul de preview în format: [DEPLOY_URL: https://xxx.ok.kimi.link]'
                },
                {
                    role: 'user',
                    content: `Publică acest site web și dă-mi link-ul de preview:

Fișiere:
${JSON.stringify(filesForKimi, null, 2)}

Răspunde cu: [DEPLOY_URL: linkul_aici]`
                }
            ];

            const response = await callKimiFast(messages);
            const content = response.content;

            // Extragem URL-ul din răspuns
            const urlMatch = content.match(/\[DEPLOY_URL:\s*(https?:\/\/[^\]]+)\]/);
            
            if (!urlMatch) {
                throw new Error('Kimi nu a returnat un URL valid de deploy');
            }

            const url = urlMatch[1].trim();

            // Salvăm în map
            const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
            this.activeDeploys.set(projectId, {
                url,
                expiresAt,
                isKimiDeploy: true
            });

            await logger.info(`Kimi deploy successful`, { projectId, url });

            return {
                success: true,
                url,
                message: '🚀 Site publicat via Kimi!',
                expiresAt,
                isPublic: true
            };

        } catch (error) {
            await logger.error('Kimi deploy failed', { projectId, error: error.message });
            return { 
                success: false, 
                message: `❌ Deploy eșuat: ${error.message}` 
            };
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
            timeLeft: `${hoursLeft}h`,
            expiresAt: deploy.expiresAt,
            isKimiDeploy: true
        };
    }
}

module.exports = { KimiDeployService };
