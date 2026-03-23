const { query } = require('./db');

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'];

/**
 * Logger structurat cu persistență în DB
 */
class Logger {
    constructor(module) {
        this.module = module;
    }

    async log(level, message, metadata = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            module: this.module,
            message,
            metadata
        };

        // Log în consolă
        if (LOG_LEVELS[level] >= CURRENT_LOG_LEVEL) {
            const colors = {
                DEBUG: '\x1b[36m', // Cyan
                INFO: '\x1b[32m',  // Green
                WARN: '\x1b[33m',  // Yellow
                ERROR: '\x1b[31m'  // Red
            };
            const reset = '\x1b[0m';
            console.log(`${colors[level]}[${level}]${reset} [${this.module}] ${message}`);
        }

        // Persistență în DB (doar pentru WARN și ERROR sau dacă e configurat)
        if (LOG_LEVELS[level] >= LOG_LEVELS.WARN || process.env.LOG_TO_DB === 'true') {
            try {
                await query(
                    'INSERT INTO logs (level, module, message, metadata, created_at) VALUES ($1, $2, $3, $4, $5)',
                    [level, this.module, message, JSON.stringify(metadata), timestamp]
                );
            } catch (err) {
                console.error('Eroare salvare log în DB:', err);
            }
        }
    }

    debug(message, metadata) {
        return this.log('DEBUG', message, metadata);
    }

    info(message, metadata) {
        return this.log('INFO', message, metadata);
    }

    warn(message, metadata) {
        return this.log('WARN', message, metadata);
    }

    error(message, metadata) {
        return this.log('ERROR', message, metadata);
    }
}

/**
 * Creează tabela logs dacă nu există
 */
async function initLogsTable() {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                level VARCHAR(20) NOT NULL,
                module VARCHAR(100),
                message TEXT,
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ Tabela logs creată/verificată');
    } catch (err) {
        console.error('❌ Eroare creare tabela logs:', err);
    }
}

module.exports = {
    Logger,
    initLogsTable,
    LOG_LEVELS
};
