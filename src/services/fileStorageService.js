const { query } = require('../utils/db');
const { Logger } = require('../utils/logger');
const logger = new Logger('FileStorageService');

/**
 * Service pentru stocarea fișierelor în PostgreSQL
 * Persistă datele între restart-uri Railway
 */
class FileStorageService {
    
    /**
     * Inițializare - creează tabela dacă nu există
     */
    async init() {
        try {
            await query(`
                CREATE TABLE IF NOT EXISTS project_files (
                    id SERIAL PRIMARY KEY,
                    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                    file_path VARCHAR(500) NOT NULL,
                    content TEXT,
                    is_binary BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(project_id, file_path)
                )
            `);
            
            await query(`
                CREATE INDEX IF NOT EXISTS idx_project_files_project_id 
                ON project_files(project_id)
            `);
            
            console.log('✅ Tabela project_files creată/verificată');
        } catch (err) {
            console.error('❌ Eroare creare tabelă project_files:', err);
        }
    }

    /**
     * Salvează un fișier în DB
     */
    async saveFile(projectId, filePath, content, isBinary = false) {
        try {
            // Verificăm dacă fișierul există deja
            const existing = await query(
                'SELECT id FROM project_files WHERE project_id = $1 AND file_path = $2',
                [projectId, filePath]
            );
            
            if (existing.rows.length > 0) {
                // Update
                await query(
                    `UPDATE project_files 
                     SET content = $3, is_binary = $4, updated_at = NOW() 
                     WHERE project_id = $1 AND file_path = $2`,
                    [projectId, filePath, content, isBinary]
                );
            } else {
                // Insert
                await query(
                    `INSERT INTO project_files (project_id, file_path, content, is_binary) 
                     VALUES ($1, $2, $3, $4)`,
                    [projectId, filePath, content, isBinary]
                );
            }
            
            return { success: true };
        } catch (err) {
            await logger.error('Eroare salvare fișier în DB', { projectId, filePath, error: err.message });
            return { success: false, error: err.message };
        }
    }

    /**
     * Obține conținutul unui fișier din DB
     */
    async getFile(projectId, filePath) {
        try {
            const result = await query(
                'SELECT content, is_binary FROM project_files WHERE project_id = $1 AND file_path = $2',
                [projectId, filePath]
            );
            
            if (result.rows.length === 0) {
                return { success: false, error: 'Fișier negăsit' };
            }
            
            return { 
                success: true, 
                content: result.rows[0].content,
                isBinary: result.rows[0].is_binary
            };
        } catch (err) {
            await logger.error('Eroare citire fișier din DB', { projectId, filePath, error: err.message });
            return { success: false, error: err.message };
        }
    }

    /**
     * Listează toate fișierele unui proiect
     */
    async listFiles(projectId) {
        try {
            const result = await query(
                'SELECT file_path, updated_at FROM project_files WHERE project_id = $1 ORDER BY file_path',
                [projectId]
            );
            
            return { 
                success: true, 
                files: result.rows.map(r => ({
                    path: r.file_path,
                    updatedAt: r.updated_at
                }))
            };
        } catch (err) {
            await logger.error('Eroare listare fișiere din DB', { projectId, error: err.message });
            return { success: false, error: err.message };
        }
    }

    /**
     * Șterge un fișier
     */
    async deleteFile(projectId, filePath) {
        try {
            await query(
                'DELETE FROM project_files WHERE project_id = $1 AND file_path = $2',
                [projectId, filePath]
            );
            return { success: true };
        } catch (err) {
            await logger.error('Eroare ștergere fișier din DB', { projectId, filePath, error: err.message });
            return { success: false, error: err.message };
        }
    }

    /**
     * Șterge toate fișierele unui proiect
     */
    async deleteProjectFiles(projectId) {
        try {
            await query(
                'DELETE FROM project_files WHERE project_id = $1',
                [projectId]
            );
            return { success: true };
        } catch (err) {
            await logger.error('Eroare ștergere fișiere proiect din DB', { projectId, error: err.message });
            return { success: false, error: err.message };
        }
    }

    /**
     * Exportă toate fișierele proiectului într-un folder (pentru deploy/zip)
     */
    async exportToDisk(projectId, basePath) {
        const fs = require('fs').promises;
        const path = require('path');
        
        try {
            const { success, files } = await this.listFiles(projectId);
            if (!success) return { success: false, error: 'Nu am putut lista fișierele' };
            
            // Creăm folderul de bază
            await fs.mkdir(basePath, { recursive: true });
            
            for (const file of files) {
                const fileResult = await this.getFile(projectId, file.path);
                if (!fileResult.success) continue;
                
                // Creăm subfolderele dacă e necesar
                const fullPath = path.join(basePath, file.path);
                await fs.mkdir(path.dirname(fullPath), { recursive: true });
                
                // Scriem fișierul
                if (fileResult.isBinary) {
                    await fs.writeFile(fullPath, Buffer.from(fileResult.content, 'base64'));
                } else {
                    await fs.writeFile(fullPath, fileResult.content, 'utf8');
                }
            }
            
            return { success: true, fileCount: files.length };
        } catch (err) {
            await logger.error('Eroare export fișiere pe disk', { projectId, basePath, error: err.message });
            return { success: false, error: err.message };
        }
    }

    /**
     * Salvează multiple fișiere deodată (batch)
     */
    async saveFiles(projectId, files) {
        const results = [];
        for (const file of files) {
            const result = await this.saveFile(
                projectId, 
                file.path, 
                file.content, 
                file.isBinary || false
            );
            results.push({ path: file.path, ...result });
        }
        return results;
    }
}

module.exports = { FileStorageService };
