const fs = require('fs').promises;
const path = require('path');

/**
 * Skill: Scriere fișier
 * Creează sau suprascrie un fișier cu conținutul specificat
 */
async function writeFile(filePath, content) {
    try {
        // Creăm directoarele dacă nu există
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        
        // Scriem fișierul
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
 * Skill: Citire fișier
 * Citește conținutul unui fișier
 */
async function readFile(filePath) {
    try {
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
 * Skill: Listare director
 * Listează fișierele dintr-un director
 */
async function listDirectory(dirPath) {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return {
            success: true,
            path: dirPath,
            files: entries
                .filter(e => e.isFile())
                .map(e => e.name),
            directories: entries
                .filter(e => e.isDirectory())
                .map(e => e.name)
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Skill: Verificare existență fișier
 */
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return { exists: true };
    } catch {
        return { exists: false };
    }
}

/**
 * Creează structura de proiect
 */
async function createProjectStructure(basePath, structure) {
    const results = [];
    
    for (const item of structure) {
        const fullPath = path.join(basePath, item.path);
        
        if (item.type === 'directory') {
            await fs.mkdir(fullPath, { recursive: true });
            results.push({ type: 'dir', path: fullPath });
        } else if (item.type === 'file') {
            const result = await writeFile(fullPath, item.content || '');
            results.push(result);
        }
    }
    
    return results;
}

/**
 * Skill: Ștergere fișier
 */
async function deleteFile(filePath) {
    try {
        await fs.unlink(filePath);
        return {
            success: true,
            message: `Fișier șters: ${filePath}`
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Skill: Copiere fișier
 */
async function copyFile(sourcePath, destPath) {
    try {
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(sourcePath, destPath);
        return {
            success: true,
            message: `Fișier copiat: ${sourcePath} -> ${destPath}`
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
    listDirectory,
    fileExists,
    createProjectStructure,
    deleteFile,
    copyFile
};
