const { callKimi } = require('../../utils/kimi');
const { writeFile } = require('../../skills/file-operations');
const { getProjectPath } = require('../../utils/project');
const { Logger } = require('../../utils/logger');
const path = require('path');

const logger = new Logger('ArchitectWorker');

/**
 * Architect Worker
 * Proiectează arhitectura aplicației și creează schema bazei de date
 */
class ArchitectWorker {
    constructor(bot) {
        this.bot = bot;
        this.name = 'architect';
    }

    async execute(projectId, discoveryData) {
        await this.sendProgress(projectId, '🏗️ Architect proiectează arhitectura...');
        await logger.info('Începe execuție ArchitectWorker', { projectId });

        const projectPath = getProjectPath(projectId);

        try {
            // 1. Proiectăm arhitectura generală
            const archPrompt = [
                {
                    role: 'system',
                    content: `Ești Architect Senior. Analizează cerința și proiectează arhitectura.
Răspunde cu un JSON în formatul:
{
  "appType": "web|mobile|cli|api",
  "techStack": {
    "frontend": "...",
    "backend": "...",
    "database": "..."
  },
  "entities": ["user", "product", ...],
  "architecture": "descriere scurtă"
}`
                },
                {
                    role: 'user',
                    content: `Cerință: ${JSON.stringify(discoveryData)}`
                }
            ];

            const archResponse = await callKimi(archPrompt, 'kimi-k2-thinking');
            const architecture = this.extractJSON(archResponse.content);

            await this.sendProgress(projectId, `✅ Arhitectură: ${architecture.techStack?.frontend || 'React'} + ${architecture.techStack?.backend || 'Express'} + ${architecture.techStack?.database || 'PostgreSQL'}`);

            // 2. Generăm schema bazei de date
            await this.sendProgress(projectId, '🗄️ Generăm schema bazei de date...');

            const dbPrompt = [
                {
                    role: 'system',
                    content: `Generează schema PostgreSQL pentru entitățile: ${(architecture.entities || ['user']).join(', ')}.
Răspunde DOAR cu SQL-ul, fără explicații. Include:
- CREATE TABLE pentru fiecare entitate
- Primary keys
- Foreign keys
- Indexes unde e necesar
- Timestamps (created_at, updated_at)`
                },
                {
                    role: 'user',
                    content: `Cerință: ${JSON.stringify(discoveryData)}`
                }
            ];

            const dbResponse = await callKimi(dbPrompt);
            const sqlSchema = dbResponse.content.replace(/```sql|```/g, '').trim();

            // Salvăm fișierele
            const archPath = path.join(projectPath, 'docs', 'architecture.json');
            const schemaPath = path.join(projectPath, 'database', 'schema.sql');

            await writeFile(archPath, JSON.stringify(architecture, null, 2));
            await writeFile(schemaPath, sqlSchema);

            await this.sendProgress(projectId, '✅ Schema DB creată!');
            await logger.info('ArchitectWorker complet', { projectId, files: [archPath, schemaPath] });

            return {
                success: true,
                architecture,
                files: [archPath, schemaPath]
            };
        } catch (error) {
            await logger.error('Eroare ArchitectWorker', { projectId, error: error.message });
            throw error;
        }
    }

    async sendProgress(projectId, text) {
        if (this.bot && this.bot.sendProgress) {
            await this.bot.sendProgress(projectId, text);
        }
        console.log(`[Architect] ${text}`);
    }

    extractJSON(text) {
        try {
            // Căutăm JSON între acolade
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                return JSON.parse(match[0]);
            }
        } catch (e) {
            console.error('Eroare parsare JSON:', e);
        }
        return {
            appType: 'web',
            techStack: { frontend: 'React', backend: 'Express', database: 'PostgreSQL' },
            entities: ['user'],
            architecture: 'Full-stack web application'
        };
    }
}

module.exports = { ArchitectWorker };
