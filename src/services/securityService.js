/**
 * SecurityService - Validează și sanitizează input-uri pentru securitate
 */
class SecurityService {
    constructor() {
        // Caractere interzise în path-uri
        this.forbiddenPathChars = /[\.\.*<>|":?*\x00-\x1f]/;
        // Pattern-uri periculoase
        this.dangerousPatterns = [
            /\.\//,           // ../
            /\.\.\\/,         // ..\
            /%2e%2e/i,        // URL encoded ..
            /%2f/i,           // URL encoded /
            /\x00/,           // Null byte
            /\/etc\//,        // System files
            /\/proc\//,
            /\/sys\//,
            /\.env/,          // Environment files
            /config\.json/,
            /package\.json/,  // Don't allow modifying package files
            /server\.js/,     // Don't allow modifying server code
            /node_modules/,   // Don't access node_modules
        ];
    }

    /**
     * Validează ID-ul proiectului
     * @param {string|number} projectId
     * @returns {boolean}
     */
    validateProjectId(projectId) {
        // Trebuie să fie un număr pozitiv
        const id = parseInt(projectId);
        if (isNaN(id) || id <= 0 || id > 999999) {
            return false;
        }
        // Verificăm că nu conține caractere ciudate
        if (String(projectId) !== String(id)) {
            return false;
        }
        return true;
    }

    /**
     * Sanitizează numele fișierului
     * @param {string} filename
     * @returns {string|null} - null dacă e invalid
     */
    sanitizeFilename(filename) {
        if (!filename || typeof filename !== 'string') {
            return null;
        }

        // Verificăm caractere interzise
        if (this.forbiddenPathChars.test(filename)) {
            return null;
        }

        // Verificăm pattern-uri periculoase
        for (const pattern of this.dangerousPatterns) {
            if (pattern.test(filename)) {
                return null;
            }
        }

        // Eliminăm whitespace la început/sfârșit
        filename = filename.trim();

        // Lungime maximă
        if (filename.length > 255) {
            return null;
        }

        // Nu permite fișiere ascunse (încep cu .)
        if (filename.startsWith('.')) {
            return null;
        }

        return filename;
    }

    /**
     * Validează calea completă în interiorul proiectului
     * @param {string} basePath - Calea de bază (ex: ./projects/project-1)
     * @param {string} requestedPath - Calea cerută de user
     * @returns {string|null} - Calea validată sau null
     */
    validatePath(basePath, requestedPath) {
        if (!requestedPath || typeof requestedPath !== 'string') {
            return null;
        }

        // Normalizăm căile
        const path = require('path');
        const resolvedBase = path.resolve(basePath);
        const resolvedRequested = path.resolve(path.join(basePath, requestedPath));

        // Verificăm că requestedPath e în interiorul basePath
        if (!resolvedRequested.startsWith(resolvedBase)) {
            console.warn(`🚫 Path traversal attempt: ${requestedPath}`);
            return null;
        }

        // Verificăm fiecare componentă a path-ului
        const parts = requestedPath.split(/[\/\\]/);
        for (const part of parts) {
            if (!this.sanitizeFilename(part)) {
                console.warn(`🚫 Invalid path component: ${part}`);
                return null;
            }
        }

        return resolvedRequested;
    }

    /**
     * Validează că userul are acces la proiect
     * @param {number} userId
     * @param {number} projectId
     * @param {Object} db - Conexiunea la DB
     * @returns {Promise<boolean>}
     */
    async validateUserAccess(userId, projectId, db) {
        try {
            const result = await db.query(
                'SELECT user_id FROM projects WHERE id = $1',
                [projectId]
            );

            if (result.rows.length === 0) {
                return false;
            }

            // Comparăm ca string pentru a evita probleme cu bigint vs number
            return String(result.rows[0].user_id) === String(userId);
        } catch (err) {
            console.error('Eroare validare acces:', err);
            return false;
        }
    }

    /**
     * Rate limiting simplu
     */
    createRateLimiter() {
        const requests = new Map();
        
        return {
            check: (userId, action, limit = 10, windowMs = 60000) => {
                const key = `${userId}:${action}`;
                const now = Date.now();
                
                if (!requests.has(key)) {
                    requests.set(key, []);
                }
                
                const userRequests = requests.get(key);
                
                // Eliminăm request-urile vechi
                const validRequests = userRequests.filter(
                    time => now - time < windowMs
                );
                
                if (validRequests.length >= limit) {
                    return { allowed: false, retryAfter: windowMs - (now - validRequests[0]) };
                }
                
                validRequests.push(now);
                requests.set(key, validRequests);
                
                return { allowed: true };
            }
        };
    }

    /**
     * Validează comenzi periculoase
     * @param {string} command
     * @returns {boolean}
     */
    validateCommand(command) {
        if (!command || typeof command !== 'string') {
            return false;
        }

        const dangerousCommands = [
            /rm\s+-rf/i,
            />\s*\/etc/i,
            />\s*\/proc/i,
            />\s*\/sys/i,
            /mkfs/i,
            /dd\s+if/i,
            /curl.*\|.*sh/i,
            /wget.*\|.*sh/i,
            /eval\s*\(/i,
            /exec\s*\(/i,
            /child_process/i,
            /require\s*\(\s*['"]child_process/i,
        ];

        for (const pattern of dangerousCommands) {
            if (pattern.test(command)) {
                console.warn(`🚫 Dangerous command blocked: ${command}`);
                return false;
            }
        }

        return true;
    }

    /**
     * Verifică dacă fișierul e în lista de fișiere permise
     * @param {string} filepath
     * @returns {boolean}
     */
    isAllowedFileType(filepath) {
        const allowedExtensions = [
            '.js', '.jsx', '.ts', '.tsx',
            '.html', '.css', '.scss', '.less',
            '.json', '.md', '.txt',
            '.py', '.rb', '.php',
            '.java', '.kt', '.swift',
            '.go', '.rs', '.c', '.cpp', '.h',
            '.sql', '.yaml', '.yml', '.xml',
            '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico',
            '.env.example', '.gitignore', '.dockerignore',
            'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
            'README', 'LICENSE', '.prettierrc', '.eslintrc',
        ];

        const basename = require('path').basename(filepath).toLowerCase();
        
        // Fișiere fără extensie (Dockerfile, README, etc.)
        if (allowedExtensions.includes(basename)) {
            return true;
        }

        // Verificăm extensia
        const ext = require('path').extname(filepath).toLowerCase();
        return allowedExtensions.includes(ext);
    }

    /**
     * Logging pentru acțiuni suspecte
     */
    logSecurityEvent(userId, action, details, severity = 'warning') {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            userId,
            action,
            details,
            severity
        };

        if (severity === 'critical') {
            console.error('🚨 SECURITY ALERT:', logEntry);
        } else {
            console.warn('⚠️  Security event:', logEntry);
        }

        // Aici poți adăuga integrare cu servicii externe (Slack, Email, etc.)
    }
}

module.exports = { SecurityService };
