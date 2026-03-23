const { query } = require('../utils/db');
const { callKimiFast } = require('../utils/kimi-optimized');
const { Logger } = require('../utils/logger');

const logger = new Logger('SkillRegistry');

/**
 * SkillRegistry - Gestionează skills disponibile și detectează lipsuri
 */
class SkillRegistry {
    constructor() {
        this.coreSkills = [
            'write_file',
            'read_file',
            'list_directory',
            'delete_file',
            'copy_file',
            'query_database'
        ];
    }

    /**
     * Obține toate skills disponibile din DB
     */
    async getAvailableSkills() {
        const result = await query(
            'SELECT * FROM skills WHERE status = $1 ORDER BY category, name',
            ['active']
        );
        return result.rows;
    }

    /**
     * Obține doar numele skills disponibile
     */
    async getAvailableSkillNames() {
        const skills = await this.getAvailableSkills();
        return [
            ...this.coreSkills,
            ...skills.map(s => s.name)
        ];
    }

    /**
     * Obține un skill după nume
     */
    async getSkill(name) {
        const result = await query(
            'SELECT * FROM skills WHERE name = $1 AND status = $2',
            [name, 'active']
        );
        return result.rows[0] || null;
    }

    /**
     * Înregistrează un skill nou în DB
     */
    async registerSkill(skill) {
        const { name, description, category = 'generated', code, parameters = {}, dependencies = [], examples = [] } = skill;
        
        try {
            await query(
                `INSERT INTO skills (name, description, category, code, parameters, dependencies, examples, auto_generated, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (name) DO UPDATE SET
                    description = EXCLUDED.description,
                    code = EXCLUDED.code,
                    parameters = EXCLUDED.parameters,
                    dependencies = EXCLUDED.dependencies,
                    examples = EXCLUDED.examples,
                    updated_at = NOW()`,
                [name, description, category, code, JSON.stringify(parameters), JSON.stringify(dependencies), JSON.stringify(examples), true, 'active']
            );
            
            await logger.info(`Skill înregistrat: ${name}`, { category });
            return { success: true, name };
        } catch (error) {
            await logger.error(`Eroare înregistrare skill ${name}`, { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Analizează cerințele proiectului și detectează skills necesare
     */
    async analyzeProjectRequirements(discoveryData) {
        const prompt = [
            {
                role: 'system',
                content: `Ești un analist de sistem. Analizează cerința și identifică ce skills sunt necesare.

Skills posibile:
- web_scraper (extragere date din pagini web)
- email_sender (trimitere email via SMTP)
- excel_generator (generare fișiere Excel)
- pdf_generator (generare fișiere PDF)
- image_processor (procesare imagini - resize, crop, etc)
- csv_processor (procesare fișiere CSV)
- api_client (apelare API externe)
- file_parser (parsare XML, YAML, etc)
- data_transformer (transformare date)
- scheduler (programare task-uri)
- notification_sender (notificări push/webhook)
- auth_handler (autentificare OAuth/JWT)

Răspunde cu JSON:
{
  "required": ["skill1", "skill2"],
  "optional": ["skill3"],
  "reasoning": "explicație scurtă"
}`
            },
            {
                role: 'user',
                content: `Cerință: ${JSON.stringify(discoveryData)}`
            }
        ];

        try {
            const response = await callKimiFast(prompt);
            const analysis = this.extractJSON(response.content);
            
            return {
                required: analysis.required || [],
                optional: analysis.optional || [],
                reasoning: analysis.reasoning || ''
            };
        } catch (error) {
            await logger.error('Eroare analiză cerințe', { error: error.message });
            return { required: [], optional: [], reasoning: '' };
        }
    }

    /**
     * Găsește skills care lipsesc
     */
    async findMissingSkills(requiredSkills) {
        const available = await this.getAvailableSkillNames();
        const missing = requiredSkills.filter(skill => !available.includes(skill));
        
        await logger.info('Skills lipsă detectate', { 
            required: requiredSkills, 
            available: available.length, 
            missing: missing 
        });
        
        return missing;
    }

    /**
     * Găsește alternative pentru un skill lipsă
     */
    async findAlternativeSkill(requiredSkill) {
        const alternatives = {
            'excel_generator': ['csv_processor'],
            'pdf_generator': ['file_parser'],
            'email_sender': ['notification_sender'],
            'web_scraper': ['api_client']
        };

        const available = await this.getAvailableSkillNames();
        const skillAlternatives = alternatives[requiredSkill] || [];
        
        return skillAlternatives.find(alt => available.includes(alt)) || null;
    }

    /**
     * Incrementează contorul de utilizare pentru un skill
     */
    async incrementUsage(name) {
        await query(
            'UPDATE skills SET usage_count = usage_count + 1 WHERE name = $1',
            [name]
        );
    }

    /**
     * Extrage JSON din text
     */
    extractJSON(text) {
        try {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                return JSON.parse(match[0]);
            }
        } catch (e) {
            console.error('Eroare parsare JSON:', e);
        }
        return {};
    }
}

module.exports = { SkillRegistry };
