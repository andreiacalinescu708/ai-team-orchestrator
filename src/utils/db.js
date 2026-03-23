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
                    name VARCHAR(255),
                    description TEXT,
                    status VARCHAR(50) DEFAULT 'discovering',
                    discovery_data JSONB DEFAULT '{}',
                    current_step INTEGER DEFAULT 0,
                    total_cost DECIMAL(10,2) DEFAULT 0.00,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Tabela conversații
            await pool.query(`
                CREATE TABLE IF NOT EXISTS conversations (
                    id SERIAL PRIMARY KEY,
                    project_id INTEGER REFERENCES projects(id),
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

            console.log('✅ Tabele create/verificate');
        } catch (err) {
            console.error('❌ Eroare creare tabele:', err);
        }
    }
};