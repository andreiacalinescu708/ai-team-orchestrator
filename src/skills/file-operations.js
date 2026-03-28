const fs = require('fs').promises;
const path = require('path');
const { FileStorageService } = require('../services/fileStorageService');

const fileStorage = new FileStorageService();

/**
 * Extrage projectId din path
 * Ex: ./projects/project-3/frontend/index.html -> 3
 */
function extractProjectId(filePath) {
    const match = filePath.match(/project-(\d+)/);
    return match ? parseInt(match[1]) : null;
}

/**
 * Skill: Scriere fișier în DB și pe disk
 */
async function writeFile(filePath, content) {
    try {
        const projectId = extractProjectId(filePath);
        const relativePath = filePath.replace(/^.+?project-\d+\//, '');
        
        // Salvăm în DB (persistă între restart-uri)
        if (projectId) {
            await fileStorage.saveFile(projectId, relativePath, content, false);
        }
        
        // Salvăm și pe disk (pentru acces rapid/deploy)
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, content, 'utf8');
        
        return {
            success: true,
            path: filePath,
            size: Buffer.byteLength(content, 'utf8'),
            message: `Fișier creat: ${filePath}`
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Skill: Citire fișier - încearcă din DB mai întâi, apoi de pe disk
 */
async function readFile(filePath) {
    try {
        const projectId = extractProjectId(filePath);
        const relativePath = filePath.replace(/^.+?project-\d+\//, '');
        
        // Încercăm din DB mai întâi
        if (projectId) {
            const dbResult = await fileStorage.getFile(projectId, relativePath);
            if (dbResult.success) {
                return {
                    success: true,
                    path: filePath,
                    content: dbResult.content
                };
            }
        }
        
        // Fallback la disk
        const content = await fs.readFile(filePath, 'utf8');
        return {
            success: true,
            path: filePath,
            content: content
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Skill: Creare structură de directoare și fișiere
 */
async function createProjectStructure(basePath, structure) {
    const results = [];
    
    for (const item of structure) {
        const fullPath = path.join(basePath, item.path);
        
        if (item.type === 'directory') {
            try {
                await fs.mkdir(fullPath, { recursive: true });
                results.push({ type: 'dir', path: fullPath, success: true });
            } catch (e) {
                results.push({ type: 'dir', path: fullPath, success: false, error: e.message });
            }
        } else if (item.type === 'file') {
            const result = await writeFile(fullPath, item.content || '');
            results.push({ type: 'file', path: fullPath, ...result });
        }
    }
    
    return results;
}

/**
 * Exportă fișierele din DB pe disk pentru deploy
 */
async function exportProjectToDisk(projectId, basePath) {
    return await fileStorage.exportToDisk(projectId, basePath);
}

/**
 * Listează fișierele unui proiect
 */
async function listProjectFiles(projectId) {
    // Încearcă din DB mai întâi
    const dbResult = await fileStorage.listFiles(projectId);
    if (dbResult.success && dbResult.files.length > 0) {
        return dbResult.files.map(f => f.path);
    }
    
    // Fallback la disk
    try {
        const basePath = `./projects/project-${projectId}`;
        const files = await listFilesRecursive(basePath);
        return files.map(f => f.replace(basePath + '/', ''));
    } catch (e) {
        return [];
    }
}

async function listFilesRecursive(dir, basePath = '') {
    const results = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
            const subFiles = await listFilesRecursive(fullPath, relativePath);
            results.push(...subFiles);
        } else {
            results.push(fullPath);
        }
    }
    
    return results;
}

/**
 * Skill: Listează conținutul unui director
 */
async function listDirectory(dirPath) {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const files = [];
        const directories = [];
        
        for (const entry of entries) {
            if (entry.isDirectory()) {
                directories.push(entry.name);
            } else {
                files.push(entry.name);
            }
        }
        
        return {
            success: true,
            files,
            directories
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    writeFile,
    readFile,
    createProjectStructure,
    exportProjectToDisk,
    listProjectFiles,
    listDirectory,
    fileStorage
};
