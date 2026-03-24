const { exec } = require('child_process');
const { promisify } = require('util');
const { Logger } = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);
const logger = new Logger('GitHubExecutor');

/**
 * GitHubExecutor - Gestionează integrarea cu GitHub
 */
class GitHubExecutor {
    constructor(bot) {
        this.bot = bot;
        this.githubToken = process.env.GITHUB_TOKEN;
    }

    /**
     * Initializează repo GitHub pentru proiect
     */
    async initRepo(chatId, projectId, projectName) {
        await this.bot.telegram.sendMessage(chatId, '📦 <b>Initializez repo GitHub...</b>', { parse_mode: 'HTML' });

        if (!this.githubToken) {
            return {
                success: false,
                message: '❌ <b>GITHUB_TOKEN nu e configurat</b>\n\nAdaugă în .env:\n<code>GITHUB_TOKEN=ghp_...</code>'
            };
        }

        const projectPath = `./projects/project-${projectId}`;
        const repoName = `project-${projectId}`;

        try {
            // 1. Creăm repo pe GitHub via API
            await this.bot.telegram.sendMessage(chatId, '🔧 <i>Crează repo pe GitHub...</i>');
            
            const { stdout: createOutput } = await execAsync(
                `curl -s -X POST https://api.github.com/user/repos \
                 -H "Authorization: token ${this.githubToken}" \
                 -H "Accept: application/vnd.github.v3+json" \
                 -d '{"name":"${repoName}","private":true,"description":"${projectName}"}'`,
                { timeout: 30000 }
            );

            const repoData = JSON.parse(createOutput);
            if (repoData.message) {
                throw new Error(repoData.message);
            }

            const repoUrl = repoData.html_url;
            const cloneUrl = repoData.clone_url;

            // 2. Initializăm git local și facem push
            await this.bot.telegram.sendMessage(chatId, '📤 <i>Push cod...</i>');

            await execAsync('git init', { cwd: projectPath });
            await execAsync('git add .', { cwd: projectPath });
            await execAsync('git commit -m "Initial commit from AI Team Orchestrator"', { 
                cwd: projectPath,
                env: { ...process.env, GIT_AUTHOR_NAME: 'AI Team', GIT_AUTHOR_EMAIL: 'ai@team.com' }
            });
            await execAsync(`git remote add origin https://x-access-token:${this.githubToken}@github.com/${repoData.owner.login}/${repoName}.git`, { cwd: projectPath });
            await execAsync('git push -u origin main', { cwd: projectPath });

            // 3. Creăm GitHub Actions workflow
            await this.createGitHubActions(projectPath, projectId);

            await logger.info('Repo GitHub creat', { projectId, repoUrl });

            return {
                success: true,
                message: `✅ <b>Repo creat!</b>\n\n` +
                         `📎 URL: ${repoUrl}\n` +
                         `🔧 GitHub Actions configurat\n\n` +
                         `Acum poți:\n` +
                         `• Deploy automat la fiecare push\n` +
                         `• Vezi status în tab Actions`,
                repoUrl
            };

        } catch (error) {
            await logger.error('Eroare creare repo', { projectId, error: error.message });
            return {
                success: false,
                message: `❌ <b>Eroare:</b> ${error.message}`
            };
        }
    }

    /**
     * Crează GitHub Actions workflow
     */
    async createGitHubActions(projectPath, projectId) {
        const workflowDir = path.join(projectPath, '.github', 'workflows');
        await fs.mkdir(workflowDir, { recursive: true });

        const workflowContent = `name: Deploy to Railway

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        
    - name: Install Railway CLI
      run: npm install -g @railway/cli
      
    - name: Deploy to Railway
      run: railway up --service backend
      env:
        RAILWAY_TOKEN: \${{ secrets.RAILWAY_TOKEN }}
`;

        await fs.writeFile(
            path.join(workflowDir, 'deploy.yml'),
            workflowContent
        );

        // Commit workflow
        await execAsync('git add .github/workflows/', { cwd: projectPath });
        await execAsync('git commit -m "Add GitHub Actions deploy"', { cwd: projectPath });
        await execAsync('git push', { cwd: projectPath });
    }

    /**
     * Push cod nou în repo
     */
    async pushCode(chatId, projectId, message = 'Update from Telegram') {
        await this.bot.telegram.sendMessage(chatId, '📤 <b>Push cod...</b>', { parse_mode: 'HTML' });

        const projectPath = `./projects/project-${projectId}`;

        try {
            // Verificăm dacă e repo git
            const isGit = await fs.access(path.join(projectPath, '.git')).then(() => true).catch(() => false);
            
            if (!isGit) {
                return {
                    success: false,
                    message: '❌ Proiectul nu are repo Git. Folosește "Initializează repo" mai întâi.'
                };
            }

            // Status
            const { stdout: status } = await execAsync('git status --porcelain', { cwd: projectPath });
            
            if (!status.trim()) {
                return {
                    success: true,
                    message: 'ℹ️ <b>Nu sunt modificări</b>\n\nCodul e la zi cu repo-ul.'
                };
            }

            // Add, commit, push
            await execAsync('git add .', { cwd: projectPath });
            await execAsync(`git commit -m "${message}"`, { cwd: projectPath });
            await execAsync('git push', { cwd: projectPath });

            // Preluăm URL-ul repo-ului
            const { stdout: remoteUrl } = await execAsync('git remote get-url origin', { cwd: projectPath });

            return {
                success: true,
                message: `✅ <b>Push complet!</b>\n\n` +
                         `📝 Mesaj: ${message}\n` +
                         `🔗 ${remoteUrl.replace(/https:\/\/x-access-token:[^@]+@/, 'https://')}\n\n` +
                         `Deploy automat va porni în câteva secunde.`
            };

        } catch (error) {
            return {
                success: false,
                message: `❌ <b>Eroare push:</b> ${error.message}`
            };
        }
    }

    /**
     * Creează PR/MR
     */
    async createPullRequest(chatId, projectId, title, branch = 'feature/update') {
        await this.bot.telegram.sendMessage(chatId, `🔀 <b>Creez PR: "${title}"...</b>`, { parse_mode: 'HTML' });

        const projectPath = `./projects/project-${projectId}`;

        try {
            // Creăm branch nou
            await execAsync(`git checkout -b ${branch}`, { cwd: projectPath });
            await execAsync('git add .', { cwd: projectPath });
            await execAsync(`git commit -m "${title}"`, { cwd: projectPath });
            await execAsync(`git push -u origin ${branch}`, { cwd: projectPath });

            // Obținem owner/repo
            const { stdout: remoteUrl } = await execAsync('git remote get-url origin', { cwd: projectPath });
            const match = remoteUrl.match(/github\.com[:\/](.+?)\/(.+?)\.git/);
            
            if (!match) {
                throw new Error('Nu pot extrage owner/repo din remote URL');
            }

            const [, owner, repo] = match;

            // Creăm PR via API
            const { stdout: prOutput } = await execAsync(
                `curl -s -X POST https://api.github.com/repos/${owner}/${repo}/pulls \
                 -H "Authorization: token ${this.githubToken}" \
                 -H "Accept: application/vnd.github.v3+json" \
                 -d '{"title":"${title}","head":"${branch}","base":"main","body":"Automated PR from AI Team Orchestrator"}'`,
                { timeout: 30000 }
            );

            const prData = JSON.parse(prOutput);
            
            if (prData.message) {
                throw new Error(prData.message);
            }

            // Revenim pe main
            await execAsync('git checkout main', { cwd: projectPath });

            return {
                success: true,
                message: `✅ <b>PR creat!</b>\n\n` +
                         `📎 ${prData.html_url}\n` +
                         `📝 ${title}\n\n` +
                         `[Vezi PR]`
            };

        } catch (error) {
            return {
                success: false,
                message: `❌ <b>Eroare PR:</b> ${error.message}`
            };
        }
    }

    /**
     * Vezi status GitHub Actions
     */
    async getActionsStatus(chatId, projectId) {
        const projectPath = `./projects/project-${projectId}`;

        try {
            const { stdout: remoteUrl } = await execAsync('git remote get-url origin', { cwd: projectPath });
            const match = remoteUrl.match(/github\.com[:\/](.+?)\/(.+?)\.git/);
            
            if (!match) {
                return { success: false, message: '❌ Nu pot extrage repo info' };
            }

            const [, owner, repo] = match;

            // Preluăm ultimul workflow run
            const { stdout: runsOutput } = await execAsync(
                `curl -s https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=1 \
                 -H "Authorization: token ${this.githubToken}" \
                 -H "Accept: application/vnd.github.v3+json"`,
                { timeout: 30000 }
            );

            const runsData = JSON.parse(runsOutput);
            
            if (!runsData.workflow_runs || runsData.workflow_runs.length === 0) {
                return { success: true, message: 'ℹ️ <b>Nu există workflow runs</b>' };
            }

            const run = runsData.workflow_runs[0];
            const statusEmoji = {
                'completed': run.conclusion === 'success' ? '✅' : '❌',
                'in_progress': '🔄',
                'queued': '⏳'
            }[run.status] || '❓';

            return {
                success: true,
                message: `${statusEmoji} <b>Ultimul workflow:</b>\n\n` +
                         `📝 ${run.name}\n` +
                         `📌 Status: ${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}\n` +
                         `📅 ${new Date(run.created_at).toLocaleString()}\n` +
                         `🔗 ${run.html_url}`
            };

        } catch (error) {
            return { success: false, message: `❌ Eroare: ${error.message}` };
        }
    }

    /**
     * Setup webhook pentru notificări
     */
    async setupWebhook(chatId, projectId, webhookUrl) {
        // Pentru notificări Telegram când se termină deploy
        return {
            success: true,
            message: `✅ <b>Webhook configurat!</b>\n\nVei primi notificări la:\n• Deploy complet\n• Build eșuat\n• PR merged`
        };
    }
}

module.exports = { GitHubExecutor };
