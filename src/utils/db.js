const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test conexiune
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Eroare conectare PostgreSQL:', err);
    } else {
        console.log('✅ Conectat la PostgreSQL:', res.rows[0].now);
    }
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    
    initDB: async () => {
        try {
            // Tabela proiecte
            await pool.query(`
                CREATE TABLE IF NOT EXISTS projects (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT,
                    name VARCHAR(255),
                    description TEXT,
                    status VARCHAR(50) DEFAULT 'discovering',
                    discovery_data JSONB DEFAULT '{}',
                    tech_stack JSONB DEFAULT '{}',
                    current_step INTEGER DEFAULT 0,
                    total_cost DECIMAL(10,2) DEFAULT 0.00,
                    total_tokens INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Tabela conversații
            await pool.query(`
                CREATE TABLE IF NOT EXISTS conversations (
                    id SERIAL PRIMARY KEY,
                    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                    role VARCHAR(50),
                    content TEXT,
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Tabela skills
            await pool.query(`
                CREATE TABLE IF NOT EXISTS skills (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) UNIQUE,
                    description TEXT,
                    template_code TEXT,
                    parameters JSONB,
                    status VARCHAR(20) DEFAULT 'active',
                    usage_count INTEGER DEFAULT 0
                )
            `);

            // Tabela task-uri pentru execuție
            await pool.query(`
                CREATE TABLE IF NOT EXISTS tasks (
                    id SERIAL PRIMARY KEY,
                    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                    worker VARCHAR(50),
                    task_name VARCHAR(255),
                    status VARCHAR(50) DEFAULT 'pending',
                    result JSONB DEFAULT '{}',
                    error TEXT,
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Tabela fișiere generate
            await pool.query(`
                CREATE TABLE IF NOT EXISTS files (
                    id SERIAL PRIMARY KEY,
                    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                    path VARCHAR(500),
                    size INTEGER,
                    content_hash VARCHAR(64),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Tabela logs
            await pool.query(`
                CREATE TABLE IF NOT EXISTS logs (
                    id SERIAL PRIMARY KEY,
                    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                    level VARCHAR(20) NOT NULL,
                    module VARCHAR(100),
                    message TEXT,
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

                        // Adăugăm index pe user_id
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)`).catch(() => {});

            console.log('✅ Tabele create/verificate');
        } catch (err) {
            console.error('❌ Eroare creare tabele:', err);
        }
    }
};
