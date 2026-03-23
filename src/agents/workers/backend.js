const { callKimi } = require('../../utils/kimi');
const { writeFile, createProjectStructure } = require('../../skills/file-operations');
const { getProjectPath } = require('../../utils/project');
const { Logger } = require('../../utils/logger');
const path = require('path');

const logger = new Logger('BackendWorker');

/**
 * Backend Worker
 * Generează API-ul Express și logica de backend
 */
class BackendWorker {
    constructor(bot) {
        this.bot = bot;
        this.name = 'backend';
    }

    async execute(projectId, discoveryData, architecture) {
        await this.sendProgress(projectId, '⚙️ Backend generează API-ul...');
        await logger.info('Începe execuție BackendWorker', { projectId });

        const projectPath = getProjectPath(projectId);
        const backendPath = path.join(projectPath, 'backend');

        try {
            // 1. Generăm structura de bază
            const structure = [
                { type: 'directory', path: path.join(`project-${projectId}`, 'backend', 'src', 'routes') },
                { type: 'directory', path: path.join(`project-${projectId}`, 'backend', 'src', 'models') },
                { type: 'directory', path: path.join(`project-${projectId}`, 'backend', 'src', 'middleware') },
                { type: 'directory', path: path.join(`project-${projectId}`, 'backend', 'src', 'utils') },
                { type: 'directory', path: path.join(`project-${projectId}`, 'backend', 'tests') }
            ];

            await createProjectStructure(require('../../utils/project').PROJECTS_BASE_PATH, structure);

            // 2. Generăm package.json
            await this.sendProgress(projectId, '📦 Generăm package.json...');
            const packagePrompt = [
                {
                    role: 'system',
                    content: `Generează un package.json pentru un proiect Express.js.
Include: express, cors, dotenv, pg (PostgreSQL), bcryptjs, jsonwebtoken, express-validator.
Răspunde DOAR cu JSON-ul valid.`
                },
                {
                    role: 'user',
                    content: `Cerință: ${JSON.stringify(discoveryData)}`
                }
            ];

            const pkgResponse = await callKimi(packagePrompt);
            const packageJson = pkgResponse.content.replace(/```json|```/g, '').trim();

            await writeFile(
                path.join(backendPath, 'package.json'),
                packageJson
            );

            // 3. Generăm server.js principal
            await this.sendProgress(projectId, '🚀 Generăm serverul Express...');
            const serverPrompt = [
                {
                    role: 'system',
                    content: `Generează codul pentru server.js Express.
Include:
- Setup Express cu middleware (cors, json)
- Conectare PostgreSQL
- Health check endpoint GET /health
- Error handling
- Graceful shutdown
Răspunde DOAR cu codul, fără explicații.`
                },
                {
                    role: 'user',
                    content: `Cerință: ${JSON.stringify(discoveryData)}`
                }
            ];

            const serverResponse = await callKimi(serverPrompt);
            const serverCode = serverResponse.content.replace(/```javascript|```js|```/g, '').trim();

            await writeFile(
                path.join(backendPath, 'src', 'server.js'),
                serverCode
            );

            // 4. Generăm modelele pentru entități
            await this.sendProgress(projectId, '📊 Generăm modelele...');
            const entities = architecture.entities || ['user'];

            for (const entity of entities) {
                const modelPrompt = [
                    {
                        role: 'system',
                        content: `Generează un model pentru entitatea "${entity}" în Express.js cu PostgreSQL (pg).
Include funcții: create, findById, findAll, update, delete.
Răspunde DOAR cu codul.`
                    }
                ];

                const modelResponse = await callKimi(modelPrompt);
                const modelCode = modelResponse.content.replace(/```javascript|```js|```/g, '').trim();

                await writeFile(
                    path.join(backendPath, 'src', 'models', `${entity}.model.js`),
                    modelCode
                );
            }

            // 5. Generăm rutele API
            await this.sendProgress(projectId, '🌐 Generăm rutele API...');

            for (const entity of entities) {
                const routePrompt = [
                    {
                        role: 'system',
                        content: `Generează rute CRUD REST pentru entitatea "${entity}".
Include: GET /, GET /:id, POST /, PUT /:id, DELETE /:id
Folosește express.Router().
Răspunde DOAR cu codul.`
                    }
                ];

                const routeResponse = await callKimi(routePrompt);
                const routeCode = routeResponse.content.replace(/```javascript|```js|```/g, '').trim();

                await writeFile(
                    path.join(backendPath, 'src', 'routes', `${entity}.routes.js`),
                    routeCode
                );
            }

            // 6. Generăm middleware auth
            const authMiddlewarePrompt = [
                {
                    role: 'system',
                    content: `Generează middleware de autentificare JWT pentru Express.
Include: verifyToken, optional verifyAdmin.
Răspunde DOAR cu codul.`
                }
            ];

            const authResponse = await callKimi(authMiddlewarePrompt);
            const authCode = authResponse.content.replace(/```javascript|```js|```/g, '').trim();

            await writeFile(
                path.join(backendPath, 'src', 'middleware', 'auth.js'),
                authCode
            );

            // 7. Generăm fișierul .env.example
            const envExample = `# Database
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
PORT=3000

# JWT
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=24h

# Environment
NODE_ENV=development
`;

            await writeFile(
                path.join(backendPath, '.env.example'),
                envExample
            );

            // 8. Generăm README
            const readmePrompt = [
                {
                    role: 'system',
                    content: `Generează un README.md pentru backend-ul acestui proiect.
Include: instalare, configurare, rulare, endpoints API.`
                },
                {
                    role: 'user',
                    content: `Entități: ${entities.join(', ')}`
                }
            ];

            const readmeResponse = await callKimi(readmePrompt);
            const readme = readmeResponse.content.replace(/```markdown|```/g, '').trim();

            await writeFile(
                path.join(backendPath, 'README.md'),
                readme
            );

            await this.sendProgress(projectId, '✅ Backend complet!');
            await logger.info('BackendWorker complet', { projectId });

            return {
                success: true,
                files: [
                    'backend/package.json',
                    'backend/src/server.js',
                    'backend/src/middleware/auth.js',
                    ...entities.map(e => `backend/src/models/${e}.model.js`),
                    ...entities.map(e => `backend/src/routes/${e}.routes.js`),
                    'backend/.env.example',
                    'backend/README.md'
                ]
            };
        } catch (error) {
            await logger.error('Eroare BackendWorker', { projectId, error: error.message });
            throw error;
        }
    }

    async sendProgress(projectId, text) {
        if (this.bot && this.bot.sendProgress) {
            await this.bot.sendProgress(projectId, text);
        }
        console.log(`[Backend] ${text}`);
    }
}

module.exports = { BackendWorker };
