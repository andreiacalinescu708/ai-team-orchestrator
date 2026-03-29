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
                    content: `Generează componenta React App.jsx pentru: ${JSON.stringify(discoveryData)}.
REGULI OBLIGATORII:
1. ÎNCEPUT: import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
2. Import pagini: import Home from './pages/Home.jsx' (și List, Detail, Create, Edit)
3. COMPONENTA: function App() { return (...) }
4. STRUCTURA return: <BrowserRouter>...</BrowserRouter> cu <nav> și <Routes>
5. Fiecare Route: <Route path="/" element={<Home />} />
6. Navigație: <Link to="/">Home</Link> etc.
7. LA FINAL: export default App
8. TOATE parantezele ( ) și acoladele { } trebuie BALANCE
9. FĂRĂ cod incomplet - verifică sintaxa!
Răspunde DOAR cu cod JSX valid și complet, fără explicații.`
                }
            ];

            const appResponse = await callKimiThinking(appPrompt);
            let appCode = appResponse.content.replace(/```jsx|```javascript|```js|```/g, '').trim();
            
            // Validare și fix pentru sintaxă
            appCode = this.fixSyntaxErrors(appCode, 'App');

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
REGULI OBLIGATORII:
1. ÎNCEPUT: import React, { useState, useEffect } from 'react'
2. Import router: import { useParams, useNavigate, Link } from 'react-router-dom'
3. Import axios: import axios from 'axios'
4. COMPONENTA: function ${page}() { ... return (...) }
5. STRUCTURA return: UN singur element parent (div sau fragment <>...</>)
6. LA FINAL: export default ${page}
7. FOLOSEȘTE useEffect PENTRU FETCH DATE, nu în timpul render
8. TOATE parantezele ( ) și acoladele { } trebuie să fie BALANCE corect
9. FĂRĂ cod incomplet - verifică sintaxa înainte să răspunzi
Răspunde DOAR cu codul JSX valid și complet, fără explicații.`
                    }
                ];

                const pageResponse = await callKimiThinking(pagePrompt);
                let pageCode = pageResponse.content.replace(/```jsx|```javascript|```js|```/g, '').trim();
                
                // Validare și fix pentru paranteze balansate
                pageCode = this.fixSyntaxErrors(pageCode, page);

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

    /**
     * Verifică și corectează erorile de sintaxă comune în codul generat
     */
    fixSyntaxErrors(code, componentName) {
        let fixed = code;
        
        // 1. Asigurăm că există export default
        if (!fixed.includes(`export default ${componentName}`) && !fixed.includes(`export { ${componentName} }`)) {
            fixed += `\n\nexport default ${componentName};`;
        }
        
        // 2. Verificăm parantezele balansate - numărăm ( și )
        const openParens = (fixed.match(/\(/g) || []).length;
        const closeParens = (fixed.match(/\)/g) || []).length;
        if (openParens > closeParens) {
            // Adăugăm parantezele lipsă înainte de export
            const missing = openParens - closeParens;
            fixed = fixed.replace(
                new RegExp(`(export default ${componentName};?)`),
                ')'.repeat(missing) + '\n$1'
            );
        }
        
        // 3. Verificăm acoladele balansate - numărăm { și }
        const openBraces = (fixed.match(/\{/g) || []).length;
        const closeBraces = (fixed.match(/\}/g) || []).length;
        if (openBraces > closeBraces) {
            const missing = openBraces - closeBraces;
            // Adăugăm acoladele lipsă înainte de export
            fixed = fixed.replace(
                new RegExp(`(export default ${componentName};?)`),
                '}'.repeat(missing) + '\n$1'
            );
        }
        
        // 4. Fix pentru array methods (filter, map, etc.) care lipsesc )
        // Caută pattern-uri comune unde lipsește )
        const lines = fixed.split('\n');
        for (let i = 0; i < lines.length; i++) {
            // Dacă linia se termină cu .includes( sau .filter( sau .map( fără )
            if (/\.(includes|filter|map|find|some|every)\([^)]*$/.test(lines[i])) {
                // Verificăm dacă următoarea linie nu e continuare logică
                if (i + 1 < lines.length && !lines[i + 1].trim().startsWith('.')) {
                    lines[i] = lines[i] + ')';
                }
            }
        }
        fixed = lines.join('\n');
        
        return fixed;
    }

    async sendProgress(projectId, text) {
        if (this.bot && this.bot.sendProgress) {
            await this.bot.sendProgress(projectId, text);
        }
        console.log(`[Frontend] ${text}`);
    }
}

module.exports = { FrontendWorker };
