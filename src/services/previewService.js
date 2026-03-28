const express = require('express');
const { FileStorageService } = require('./fileStorageService');
const path = require('path');

/**
 * Service pentru a servi preview-uri direct din bot
 * Fără Vercel/Surge/Netlify - botul servește fișierele
 */
class PreviewService {
    constructor(app) {
        this.app = app;
        this.fileStorage = new FileStorageService();
        this.activePreviews = new Map();
        
        // Setup route pentru preview
        this.setupRoutes();
    }

    setupRoutes() {
        // Endpoint pentru preview: /preview/:projectId/*
        this.app.get('/preview/:projectId/*', async (req, res) => {
            const projectId = req.params.projectId;
            const filePath = req.params[0] || 'index.html';
            
            try {
                // Obținem fișierul din DB
                const result = await this.fileStorage.getFile(projectId, filePath);
                
                if (!result.success) {
                    // Dacă nu găsim în DB, încercăm index.html
                    if (filePath !== 'index.html') {
                        const indexResult = await this.fileStorage.getFile(projectId, 'index.html');
                        if (indexResult.success) {
                            res.set('Content-Type', 'text/html');
                            return res.send(indexResult.content);
                        }
                    }
                    return res.status(404).send('Fișier negăsit');
                }
                
                // Setăm content-type corect
                const ext = path.extname(filePath).toLowerCase();
                const contentTypes = {
                    '.html': 'text/html',
                    '.css': 'text/css',
                    '.js': 'application/javascript',
                    '.json': 'application/json',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.svg': 'image/svg+xml'
                };
                
                res.set('Content-Type', contentTypes[ext] || 'text/plain');
                res.send(result.content);
                
            } catch (err) {
                console.error('Eroare serving preview:', err);
                res.status(500).send('Eroare server');
            }
        });
    }

    /**
     * Activează preview pentru un proiect
     */
    async enablePreview(projectId, durationHours = 24) {
        const baseUrl = process.env.RAILWAY_URL || process.env.VERCEL_URL || 'http://localhost:3000';
        const previewUrl = `${baseUrl}/preview/${projectId}/`;
        
        const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
        
        this.activePreviews.set(projectId, {
            url: previewUrl,
            expiresAt
        });
        
        // Setăm timer pentru expirare
        setTimeout(() => {
            this.activePreviews.delete(projectId);
        }, durationHours * 60 * 60 * 1000);
        
        return {
            success: true,
            url: previewUrl,
            expiresAt
        };
    }

    getPreviewInfo(projectId) {
        const preview = this.activePreviews.get(projectId);
        if (!preview) return { active: false };
        
        const timeLeft = preview.expiresAt.getTime() - Date.now();
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        
        return {
            active: true,
            url: preview.url,
            timeLeft: `${hoursLeft}h`,
            expiresAt: preview.expiresAt
        };
    }
}

module.exports = { PreviewService };
