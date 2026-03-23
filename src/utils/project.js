const path = require('path');
const { fileExists, createProjectStructure: createStructure } = require('../skills/file-operations');

const PROJECTS_BASE_PATH = process.env.PROJECTS_PATH || path.join(process.cwd(), 'projects');

/**
 * Generează path-ul pentru un proiect
 */
function getProjectPath(projectId) {
    return path.join(PROJECTS_BASE_PATH, `project-${projectId}`);
}

/**
 * Creează structura de bază pentru un proiect nou
 */
async function createProjectStructure(projectId, projectName) {
    const projectPath = getProjectPath(projectId);
    
    const structure = [
        { type: 'directory', path: path.join(`project-${projectId}`, 'docs') },
        { type: 'directory', path: path.join(`project-${projectId}`, 'backend', 'src') },
        { type: 'directory', path: path.join(`project-${projectId}`, 'frontend', 'src') },
        { type: 'directory', path: path.join(`project-${projectId}`, 'database') },
        { type: 'directory', path: path.join(`project-${projectId}`, 'docker') },
        { type: 'directory', path: path.join(`project-${projectId}`, '.github', 'workflows') },
        { 
            type: 'file', 
            path: path.join(`project-${projectId}`, 'README.md'),
            content: `# ${projectName}\n\nProiect generat cu AI Team Orchestrator.\n`
        }
    ];

    await createStructure(PROJECTS_BASE_PATH, structure);
    
    return {
        path: projectPath,
        structure: structure.map(s => s.path)
    };
}

/**
 * Verifică dacă un proiect există
 */
async function projectExists(projectId) {
    const projectPath = getProjectPath(projectId);
    return await fileExists(projectPath);
}

/**
 * Listează toate fișierele dintr-un proiect
 */
async function listProjectFiles(projectId) {
    const { listDirectory } = require('../skills/file-operations');
    const projectPath = getProjectPath(projectId);
    
    async function walkDir(dir, baseDir = '') {
        const result = await listDirectory(dir);
        if (!result.success) return [];
        
        let files = [];
        
        for (const file of result.files) {
            files.push(path.join(baseDir, file));
        }
        
        for (const subdir of result.directories) {
            const subFiles = await walkDir(
                path.join(dir, subdir),
                path.join(baseDir, subdir)
            );
            files = files.concat(subFiles);
        }
        
        return files;
    }
    
    return await walkDir(projectPath);
}

module.exports = {
    getProjectPath,
    createProjectStructure,
    projectExists,
    listProjectFiles,
    PROJECTS_BASE_PATH
};
