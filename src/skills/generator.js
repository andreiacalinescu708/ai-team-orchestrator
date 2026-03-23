const { callKimiThinking } = require('../utils/kimi-optimized');
const { Logger } = require('../utils/logger');
const { writeFile } = require('./file-operations');
const path = require('path');

const logger = new Logger('SkillGenerator');

/**
 * SkillGenerator - Generează skills noi automat
 */
class SkillGenerator {
    constructor() {
        this.skillsPath = path.join(process.cwd(), 'src', 'skills', 'generated');
    }

    /**
     * Generează un skill nou
     */
    async generateSkill(name, description, requirements = '') {
        await logger.info(`Generez skill: ${name}`);

        const prompt = [
            {
                role: 'system',
                content: `Generează un skill Node.js de înaltă calitate.

Skill-ul trebuie să:
1. Fie o funcție async
2. Primească parametri ca obiect destructurat
3. Returneze {success: true, data: ...} sau {success: false, error: ...}
4. Aibă error handling complet cu try-catch
5. Fie documentat cu JSDoc
6. Folosească doar dependențe standard sau populare (npm)
7. Aibă cod curat și bine structurat

Template:
\`\`\`javascript
/**
 * Skill: nume_skill
 * Description: descriere
 * @param {Object} params - Parametri
 * @returns {Promise<Object>} - Rezultat
 */
async function numeSkill(params) {
    try {
        // implementare
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = { numeSkill };
\`\`\`

Răspunde DOAR cu codul JavaScript valid, fără markdown, fără explicații.`
            },
            {
                role: 'user',
                content: `Generează skill:
Nume: ${name}
Descriere: ${description}
Cerințe specifice: ${requirements || 'Niciuna'}`
            }
        ];

        try {
            const response = await callKimiThinking(prompt);
            const code = this.extractCode(response.content);

            // Validăm sintaxa
            const validation = this.validateSyntax(code);
            if (!validation.valid) {
                throw new Error(`Sintaxă invalidă: ${validation.error}`);
            }

            // Extragem parametrii din cod
            const parameters = this.extractParameters(code);

            // Detectăm dependențele
            const dependencies = this.extractDependencies(code);

            return {
                name,
                description,
                code,
                parameters,
                dependencies,
                category: 'generated'
            };
        } catch (error) {
            await logger.error(`Eroare generare skill ${name}`, { error: error.message });
            throw error;
        }
    }

    /**
     * Validează sintaxa codului
     */
    validateSyntax(code) {
        try {
            // Verificăm dacă e valid JS folosind Function constructor
            new Function(code);
            return { valid: true };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    /**
     * Testează un skill generat
     */
    async testSkill(skill) {
        await logger.info(`Testez skill: ${skill.name}`);

        try {
            // Scriem skill-ul temporar pentru test
            const tempPath = path.join(this.skillsPath, `${skill.name}.test.js`);
            await writeFile(tempPath, skill.code);

            // Încercăm să-l require-uim
            delete require.cache[require.resolve(tempPath)];
            const skillModule = require(tempPath);

            // Verificăm dacă exportă funcția
            const funcName = Object.keys(skillModule)[0];
            if (!funcName || typeof skillModule[funcName] !== 'function') {
                throw new Error('Skill-ul nu exportă o funcție validă');
            }

            // Curățăm fișierul temporar
            const { deleteFile } = require('./file-operations');
            await deleteFile(tempPath);

            return {
                success: true,
                functionName: funcName
            };
        } catch (error) {
            await logger.error(`Test eșuat pentru ${skill.name}`, { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Salvează skill-ul în filesystem și DB
     */
    async saveSkill(skill) {
        try {
            // Salvăm în filesystem
            const filePath = path.join(this.skillsPath, `${skill.name}.js`);
            const result = await writeFile(filePath, skill.code);

            if (!result.success) {
                throw new Error(`Eroare salvare fișier: ${result.error}`);
            }

            await logger.info(`Skill salvat: ${skill.name}`, { path: filePath });
            return { success: true, path: filePath };
        } catch (error) {
            await logger.error(`Eroare salvare skill ${skill.name}`, { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Extrage codul din răspunsul AI
     */
    extractCode(text) {
        // Eliminăm markdown code blocks dacă există
        let code = text.replace(/```javascript|```js|```/g, '').trim();
        
        // Eliminăm comentariile explicative de la început/sfârșit
        const lines = code.split('\n');
        const startIdx = lines.findIndex(line => line.includes('async function') || line.includes('function'));
        const endIdx = lines.length - 1;
        
        if (startIdx !== -1) {
            code = lines.slice(startIdx, endIdx + 1).join('\n');
        }
        
        return code.trim();
    }

    /**
     * Extrage parametrii din codul funcției
     */
    extractParameters(code) {
        const params = {};
        
        // Căutăm destructurarea parametrilor: async function({ param1, param2 })
        const destructMatch = code.match(/async function\w*\s*\{\s*([^}]+)\s*\}/);
        if (destructMatch) {
            const paramList = destructMatch[1].split(',').map(p => p.trim());
            paramList.forEach(param => {
                const [name, defaultVal] = param.split('=').map(s => s.trim());
                params[name] = {
                    required: !defaultVal,
                    default: defaultVal || undefined
                };
            });
        }
        
        return params;
    }

    /**
     * Detectează dependențele (require statements)
     */
    extractDependencies(code) {
        const deps = [];
        const requireMatches = code.match(/require\(['"]([^'"]+)['"]\)/g) || [];
        
        requireMatches.forEach(match => {
            const dep = match.match(/require\(['"]([^'"]+)['"]\)/)[1];
            // Excludem path-urile relative
            if (!dep.startsWith('.') && !dep.startsWith('/')) {
                deps.push(dep);
            }
        });
        
        return deps;
    }
}

module.exports = { SkillGenerator };
