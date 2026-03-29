const { callKimiThinking } = require('../../utils/kimi');
const { writeFile, createProjectStructure } = require('../../skills/file-operations');
const { getProjectPath } = require('../../utils/project');
const { Logger } = require('../../utils/logger');
const path = require('path');

const logger = new Logger('FrontendWorker');

/**
 * Frontend Worker
 * Generează aplicația React și componentele UI
 */
class FrontendWorker {
    constructor(bot) {
        this.bot = bot;
        this.name = 'frontend';
    }

    async execute(projectId, discoveryData, architecture) {
        await this.sendProgress(projectId, '🎨 <b>Frontend</b> generează React...');
        await logger.info('Începe execuție FrontendWorker', { projectId });

        const projectPath = getProjectPath(projectId);
        const frontendPath = path.join(projectPath, 'frontend');

        try {
            // 1. Creăm structura
            const structure = [
                { type: 'directory', path: path.join(`project-${projectId}`, 'frontend', 'src', 'components') },
                { type: 'directory', path: path.join(`project-${projectId}`, 'frontend', 'src', 'pages') },
                { type: 'directory', path: path.join(`project-${projectId}`, 'frontend', 'src', 'hooks') },
                { type: 'directory', path: path.join(`project-${projectId}`, 'frontend', 'src', 'services') },
                { type: 'directory', path: path.join(`project-${projectId}`, 'frontend', 'src', 'utils') },
                { type: 'directory', path: path.join(`project-${projectId}`, 'frontend', 'public') }
            ];

            await createProjectStructure(require('../../utils/project').PROJECTS_BASE_PATH, structure);

            // 2. Generăm package.json
            await this.sendProgress(projectId, '📦 Generăm package.json pentru React...');
            const packagePrompt = [
                {
                    role: 'system',
                    content: `Generează un package.json pentru o aplicație React modernă cu Vite.
Include: react, react-dom, react-router-dom, axios, @tanstack/react-query.
Scripts: dev, build, preview, lint.
Răspunde DOAR cu JSON valid.`
                },
                {
                    role: 'user',
                    content: `Cerință: ${JSON.stringify(discoveryData)}`
                }
            ];

            const pkgResponse = await callKimiThinking(packagePrompt);
            const packageJson = pkgResponse.content.replace(/```json|```/g, '').trim();

            await writeFile(
                path.join(frontendPath, 'package.json'),
                packageJson
            );

            // 3. Generăm vite.config.js
            const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
`;

            await writeFile(
                path.join(frontendPath, 'vite.config.js'),
                viteConfig
            );

            // 4. Generăm index.html
            const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${discoveryData.summary?.substring(0, 30) || 'React App'}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;

            await writeFile(
                path.join(frontendPath, 'index.html'),
                indexHtml
            );

            // 5. Generăm main.jsx
            const mainJsx = `import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import './index.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
`;

            await writeFile(
                path.join(frontendPath, 'src', 'main.jsx'),
                mainJsx
            );

            // 6. Generăm App.jsx
            await this.sendProgress(projectId, '⚛️ Generăm componenta principală...');
            const appPrompt = [
                {
                    role: 'system',
                    content: `Generează o componentă React App.jsx pentru: ${JSON.stringify(discoveryData)}.
REGULI STRICTE:
1. Folosește EXACT această sintaxă pentru importuri: import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
2. Importă paginile așa: import Home from './pages/Home.jsx' etc.
3. Folosește functional component: function App() { ... }
4. La FINALUL fișierului, pe ultima linie, pune EXACT: export default App
5. Include React Router cu Routes și Route pentru paginile: Home, List, Detail, Create, Edit
6. Folosește Link pentru navigation bar
Răspunde DOAR cu codul valid JSX, fără explicații.`
                }
            ];

            const appResponse = await callKimiThinking(appPrompt);
            let appCode = appResponse.content.replace(/```jsx|```javascript|```js|```/g, '').trim();
            
            // Verificăm și adăugăm export default dacă lipsește
            if (!appCode.includes('export default App') && !appCode.includes('export { App }')) {
                appCode += '\n\nexport default App;';
            }

            await writeFile(
                path.join(frontendPath, 'src', 'App.jsx'),
                appCode
            );

            // 7. Generăm index.css
            const cssPrompt = [
                {
                    role: 'system',
                    content: `Generează un CSS modern pentru o aplicație React.
Include: CSS variables pentru culori (primary, secondary, danger, success), reset, utilități comune (container, btn, card).
Răspunde DOAR cu codul CSS.`
                }
            ];

            const cssResponse = await callKimiThinking(cssPrompt);
            const cssCode = cssResponse.content.replace(/```css|```/g, '').trim();

            await writeFile(
                path.join(frontendPath, 'src', 'index.css'),
                cssCode
            );

            // 8. Generăm paginile
            await this.sendProgress(projectId, '📄 Generăm paginile...');
            const pages = ['Home', 'List', 'Detail', 'Create', 'Edit'];

            for (const page of pages) {
                const pagePrompt = [
                    {
                        role: 'system',
                        content: `Generează o pagină React ${page} pentru aplicația: ${JSON.stringify(discoveryData)}.
REGULI STRICTE:
1. Folosește: import React, { useState, useEffect } from 'react'
2. Folosește: import { useParams, useNavigate, Link } from 'react-router-dom'
3. Componenta se numește ${page}: function ${page}() { ... }
4. La FINAL pune EXACT: export default ${page}
5. Folosește axios pentru API calls (import axios from 'axios')
6. Pentru liste: folosește useEffect pentru fetch date
7. Pentru formulare: folosește useState pentru form data
Răspunde DOAR cu codul valid JSX, fără explicații.`
                    }
                ];

                const pageResponse = await callKimiThinking(pagePrompt);
                let pageCode = pageResponse.content.replace(/```jsx|```javascript|```js|```/g, '').trim();
                
                // Verificăm și adăugăm export default dacă lipsește
                if (!pageCode.includes(`export default ${page}`) && !pageCode.includes(`export { ${page} }`)) {
                    pageCode += `\n\nexport default ${page};`;
                }

                await writeFile(
                    path.join(frontendPath, 'src', 'pages', `${page}.jsx`),
                    pageCode
                );
            }

            // 9. Generăm serviciul API
            const apiService = `import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Interceptor pentru auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = \`Bearer \${token}\`;
  }
  return config;
});

export default api;
`;

            await writeFile(
                path.join(frontendPath, 'src', 'services', 'api.js'),
                apiService
            );

            // 10. Generăm .env.example
            const envExample = `VITE_API_URL=http://localhost:3000/api
`;

            await writeFile(
                path.join(frontendPath, '.env.example'),
                envExample
            );

            // 11. Generăm README
            const readme = `# Frontend

Aplicație React generată cu AI Team Orchestrator.

## Instalare

\`\`\`bash
npm install
\`\`\`

## Rulare development

\`\`\`bash
npm run dev
\`\`\`

## Build production

\`\`\`bash
npm run build
\`\`\`

## Structură

- \`src/components\` - Componente reutilizabile
- \`src/pages\` - Paginile aplicației
- \`src/hooks\` - Custom React hooks
- \`src/services\` - Servicii API
`;

            await writeFile(
                path.join(frontendPath, 'README.md'),
                readme
            );

            await this.sendProgress(projectId, '✅ Frontend complet!');
            await logger.info('FrontendWorker complet', { projectId });

            return {
                success: true,
                files: [
                    'frontend/package.json',
                    'frontend/vite.config.js',
                    'frontend/index.html',
                    'frontend/src/main.jsx',
                    'frontend/src/App.jsx',
                    'frontend/src/index.css',
                    ...pages.map(p => `frontend/src/pages/${p}.jsx`),
                    'frontend/src/services/api.js',
                    'frontend/.env.example',
                    'frontend/README.md'
                ]
            };
        } catch (error) {
            await logger.error('Eroare FrontendWorker', { projectId, error: error.message });
            throw error;
        }
    }

    async sendProgress(projectId, text) {
        if (this.bot && this.bot.sendProgress) {
            await this.bot.sendProgress(projectId, text);
        }
        console.log(`[Frontend] ${text}`);
    }
}

module.exports = { FrontendWorker };
