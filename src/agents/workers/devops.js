const { callKimi } = require('../../utils/kimi');
const { writeFile, createProjectStructure } = require('../../skills/file-operations');
const { getProjectPath } = require('../../utils/project');
const { Logger } = require('../../utils/logger');
const path = require('path');

const logger = new Logger('DevOpsWorker');

/**
 * DevOps Worker
 * Generează configurările pentru deployment
 */
class DevOpsWorker {
    constructor(bot) {
        this.bot = bot;
        this.name = 'devops';
    }

    async execute(projectId, discoveryData, architecture) {
        await this.sendProgress(projectId, '🚀 <b>DevOps</b> configurează deployment...');
        await logger.info('Începe execuție DevOpsWorker', { projectId });

        const projectPath = getProjectPath(projectId);

        try {
            // 1. Creăm structura
            const structure = [
                { type: 'directory', path: path.join(`project-${projectId}`, 'docker') },
                { type: 'directory', path: path.join(`project-${projectId}`, '.github', 'workflows') }
            ];

            await createProjectStructure(require('../../utils/project').PROJECTS_BASE_PATH, structure);

            // 2. Generăm Dockerfile pentru backend
            await this.sendProgress(projectId, '🐳 Generăm Dockerfile...');
            const dockerfileBackend = `# Backend Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copiem package.json și package-lock.json
COPY package*.json ./

# Instalăm dependențele
RUN npm ci --only=production

# Copiem codul sursă
COPY src ./src

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Comandă de start
CMD ["node", "src/server.js"]
`;

            await writeFile(
                path.join(projectPath, 'docker', 'Dockerfile.backend'),
                dockerfileBackend
            );

            // 3. Generăm Dockerfile pentru frontend
            const dockerfileFrontend = `# Frontend Dockerfile (multi-stage build)
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
`;

            await writeFile(
                path.join(projectPath, 'docker', 'Dockerfile.frontend'),
                dockerfileFrontend
            );

            // 4. Generăm nginx.conf
            const nginxConf = `server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    # Cache static assets
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # React Router support
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy (dacă e pe același domeniu)
    location /api {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
`;

            await writeFile(
                path.join(projectPath, 'docker', 'nginx.conf'),
                nginxConf
            );

            // 5. Generăm docker-compose.yml
            await this.sendProgress(projectId, '📦 Generăm docker-compose.yml...');
            const dockerCompose = `version: '3.8'

services:
  # Database
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: \${DB_USER:-postgres}
      POSTGRES_PASSWORD: \${DB_PASSWORD:-secret}
      POSTGRES_DB: \${DB_NAME:-appdb}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Backend API
  backend:
    build:
      context: ./backend
      dockerfile: ../docker/Dockerfile.backend
    environment:
      DATABASE_URL: postgres://\${DB_USER:-postgres}:\${DB_PASSWORD:-secret}@postgres:5432/\${DB_NAME:-appdb}
      PORT: 3000
      JWT_SECRET: \${JWT_SECRET:-change-me-in-production}
      NODE_ENV: production
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  # Frontend
  frontend:
    build:
      context: ./frontend
      dockerfile: ../docker/Dockerfile.frontend
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  postgres_data:
`;

            await writeFile(
                path.join(projectPath, 'docker-compose.yml'),
                dockerCompose
            );

            // 6. Generăm GitHub Actions workflow
            await this.sendProgress(projectId, '⚙️ Generăm CI/CD pipeline...');
            const githubWorkflow = `name: CI/CD Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test-backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ./backend
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
        cache-dependency-path: ./backend/package-lock.json
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run linter
      run: npm run lint || true
    
    - name: Run tests
      run: npm test || true

  test-frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ./frontend
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
        cache-dependency-path: ./frontend/package-lock.json
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run linter
      run: npm run lint || true
    
    - name: Build
      run: npm run build

  deploy:
    needs: [test-backend, test-frontend]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Deploy to production
      run: |
        echo "Add your deployment commands here"
        # docker-compose up -d
        # sau deploy pe Railway, AWS, etc.
`;

            await writeFile(
                path.join(projectPath, '.github', 'workflows', 'ci-cd.yml'),
                githubWorkflow
            );

            // 7. Generăm script de deployment
            const deployScript = `#!/bin/bash
set -e

echo "🚀 Deploying application..."

# Verificăm variabilele de mediu
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL not set"
    exit 1
fi

if [ -z "$JWT_SECRET" ]; then
    echo "❌ JWT_SECRET not set"
    exit 1
fi

# Build și start
docker-compose down
docker-compose build --no-cache
docker-compose up -d

echo "✅ Application deployed!"
echo "Backend: http://localhost:3000"
echo "Frontend: http://localhost"
`;

            await writeFile(
                path.join(projectPath, 'deploy.sh'),
                deployScript
            );

            // 8. README pentru deployment
            const readme = `# Deployment Guide

## Docker (Recomandat)

### Local Development

\`\`\`bash
# 1. Setează variabilele de mediu
cp .env.example .env
# Editează .env cu valorile tale

# 2. Rulează cu Docker Compose
docker-compose up -d

# 3. Aplică schema bazei de date
docker-compose exec postgres psql -U postgres -d appdb -f /docker-entrypoint-initdb.d/01-schema.sql
\`\`\`

### Production Deployment

\`\`\`bash
# Folosește scriptul de deployment
chmod +x deploy.sh
./deploy.sh
\`\`\`

## Platforme Cloud

### Railway
1. Conectează repo-ul la Railway
2. Setează variabilele de mediu în dashboard
3. Railway va detecta automat docker-compose.yml

## Structură fișiere

- \`docker/Dockerfile.backend\` - Configurație backend
- \`docker/Dockerfile.frontend\` - Configurație frontend
- \`docker/nginx.conf\` - Configurație Nginx
- \`docker-compose.yml\` - Orchestrare servicii
- \`.github/workflows/ci-cd.yml\` - Pipeline CI/CD
- \`deploy.sh\` - Script deployment manual
`;

            await writeFile(
                path.join(projectPath, 'DEPLOYMENT.md'),
                readme
            );

            await this.sendProgress(projectId, '✅ DevOps complet!');
            await logger.info('DevOpsWorker complet', { projectId });

            return {
                success: true,
                files: [
                    'docker/Dockerfile.backend',
                    'docker/Dockerfile.frontend',
                    'docker/nginx.conf',
                    'docker-compose.yml',
                    '.github/workflows/ci-cd.yml',
                    'deploy.sh',
                    'DEPLOYMENT.md'
                ]
            };
        } catch (error) {
            await logger.error('Eroare DevOpsWorker', { projectId, error: error.message });
            throw error;
        }
    }

    async sendProgress(projectId, text) {
        if (this.bot && this.bot.sendProgress) {
            await this.bot.sendProgress(projectId, text);
        }
        console.log(`[DevOps] ${text}`);
    }
}

module.exports = { DevOpsWorker };
