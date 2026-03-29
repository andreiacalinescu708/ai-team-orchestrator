const { callKimiThinking } = require('../utils/kimi');
const { Logger } = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

const logger = new Logger('CodeFixerService');

/**
 * Service pentru auto-corectarea erorilor de cod
 * Analizează erorile de build și încearcă să repare automat codul
 */
class CodeFixerService {
    constructor() {
        this.maxRetries = 3;
    }

    /**
     * Parsează eroarea de build și extrage informațiile relevante
     */
    parseBuildError(errorMessage) {
        const result = {
            hasError: false,
            filePath: null,
            line: null,
            column: null,
            errorType: null,
            message: null,
            code: null
        };

        if (!errorMessage) return result;

        result.hasError = true;
        result.message = errorMessage;

        // Pattern pentru vite/esbuild: file: /path/to/file:line:column
        const vitePattern = /file:\s*(.+?):(\d+):(\d+)/;
        const viteMatch = errorMessage.match(vitePattern);
        if (viteMatch) {
            result.filePath = viteMatch[1].trim();
            result.line = parseInt(viteMatch[2]);
            result.column = parseInt(viteMatch[3]);
        }

        // Pattern pentru eroarea în sine: ERROR: message
        const errorPattern = /ERROR:\s*(.+?)(?:\n|$)/;
        const errorMatch = errorMessage.match(errorPattern);
        if (errorMatch) {
            result.errorType = errorMatch[1].trim();
        }

        // Pattern pentru "Expected X but found Y"
        const expectedPattern = /Expected "([^"]+)" but found "([^"]+)"/;
        const expectedMatch = errorMessage.match(expectedPattern);
        if (expectedMatch) {
            result.expected = expectedMatch[1];
            result.found = expectedMatch[2];
        }

        // Extragem snippet-ul de cod din eroare
        const lines = errorMessage.split('\n');
        const codeLines = [];
        let inCode = false;
        for (const line of lines) {
            if (line.match(/^\s*\d+\s*\|/)) {
                inCode = true;
                codeLines.push(line);
            } else if (inCode && !line.trim()) {
                break;
            } else if (inCode) {
                codeLines.push(line);
            }
        }
        if (codeLines.length > 0) {
            result.codeSnippet = codeLines.join('\n');
        }

        return result;
    }

    /**
     * Încearcă să repare codul bazat pe eroare
     */
    async fixCode(errorInfo, projectPath) {
        try {
            await logger.info('Încercare auto-fix', { errorInfo });

            if (!errorInfo.filePath || !errorInfo.hasError) {
                return { success: false, message: 'Nu pot extrage informații suficiente din eroare' };
            }

            // Citim fișierul curent
            let fileContent;
            try {
                fileContent = await fs.readFile(errorInfo.filePath, 'utf8');
            } catch (e) {
                return { success: false, message: `Nu pot citi fișierul: ${e.message}` };
            }

            // Analizăm tipul erorii și aplicăm fixul corespunzător
            let fixedContent = fileContent;
            let fixApplied = null;

            // Eroare: paranteze/acolade nebalansate
            if (errorInfo.errorType?.includes('Expected') && errorInfo.found === 'export') {
                fixApplied = await this.fixMissingParentheses(fileContent, errorInfo);
                if (fixApplied.success) {
                    fixedContent = fixApplied.content;
                }
            }

            // Eroare: sintaxă JSX invalidă
            if (errorInfo.errorType?.includes('JSX') || errorInfo.message?.includes('JSX')) {
                fixApplied = await this.fixJSXSyntax(fileContent, errorInfo);
                if (fixApplied.success) {
                    fixedContent = fixApplied.content;
                }
            }

            // Eroare: importuri invalide
            if (errorInfo.errorType?.includes('import') || errorInfo.message?.includes('import')) {
                fixApplied = await this.fixImports(fileContent, errorInfo);
                if (fixApplied.success) {
                    fixedContent = fixApplied.content;
                }
            }

            // Dacă nu am putut aplica un fix specific, încercăm cu AI
            if (!fixApplied || !fixApplied.success) {
                fixApplied = await this.fixWithAI(fileContent, errorInfo);
                if (fixApplied.success) {
                    fixedContent = fixApplied.content;
                }
            }

            // Salvăm fișierul reparat
            if (fixApplied && fixApplied.success) {
                await fs.writeFile(errorInfo.filePath, fixedContent, 'utf8');
                await logger.info('Cod reparat cu succes', { 
                    file: errorInfo.filePath, 
                    fixType: fixApplied.type 
                });
                return {
                    success: true,
                    message: `✅ Eroare reparată: ${fixApplied.description}`,
                    fixType: fixApplied.type,
                    file: errorInfo.filePath
                };
            }

            return { 
                success: false, 
                message: 'Nu am putut aplica un fix automat pentru această eroare' 
            };

        } catch (error) {
            await logger.error('Eroare în CodeFixerService', { error: error.message });
            return { success: false, message: error.message };
        }
    }

    /**
     * Fix pentru paranteze/acolade lipsă înainte de export
     */
    async fixMissingParentheses(content, errorInfo) {
        const lines = content.split('\n');
        const errorLine = errorInfo.line - 1; // 0-indexed

        // Căutăm înapoi să găsim unde lipsesc parantezele
        let openParens = 0;
        let openBraces = 0;
        let fixLine = -1;

        for (let i = 0; i < errorLine && i < lines.length; i++) {
            const line = lines[i];
            openParens += (line.match(/\(/g) || []).length;
            openParens -= (line.match(/\)/g) || []).length;
            openBraces += (line.match(/\{/g) || []).length;
            openBraces -= (line.match(/\}/g) || []).length;
        }

        // Dacă avem paranteze deschise, trebuie să le închidem
        if (openParens > 0 || openBraces > 0) {
            // Inserăm parantezele înainte de export
            const parensToAdd = ')'.repeat(Math.max(0, openParens));
            const bracesToAdd = '}'.repeat(Math.max(0, openBraces));
            
            // Găsim linia cu export default
            for (let i = errorLine - 1; i >= 0; i--) {
                if (lines[i].includes('export default')) {
                    lines[i] = parensToAdd + bracesToAdd + '\n' + lines[i];
                    fixLine = i;
                    break;
                }
            }

            if (fixLine >= 0) {
                return {
                    success: true,
                    type: 'missing-parentheses',
                    description: `Adăugat ${openParens} paranteze și ${openBraces} acolade înainte de export`,
                    content: lines.join('\n')
                };
            }
        }

        return { success: false };
    }

    /**
     * Fix pentru sintaxă JSX invalidă
     */
    async fixJSXSyntax(content, errorInfo) {
        // Verificăm elemente JSX neînchise
        const selfClosingPattern = /<([A-Z][a-zA-Z0-9]*)[^>]*[^/]>/g;
        let match;
        const unclosedTags = [];
        
        while ((match = selfClosingPattern.exec(content)) !== null) {
            // Verificăm dacă tagul e închis mai jos
            const tagName = match[1];
            const afterTag = content.substring(match.index + match[0].length);
            if (!afterTag.includes(`</${tagName}>`)) {
                unclosedTags.push(tagName);
            }
        }

        if (unclosedTags.length > 0) {
            // Adăugăm tagurile de închidere la finalul componentei (înainte de export)
            let fixed = content;
            const closingTags = unclosedTags.map(t => `</${t}>`).join('\n');
            
            fixed = fixed.replace(
                /(export default \w+;?)$/m,
                `${closingTags}\n$1`
            );

            return {
                success: true,
                type: 'unclosed-jsx-tags',
                description: `Închis tagurile JSX: ${unclosedTags.join(', ')}`,
                content: fixed
            };
        }

        return { success: false };
    }

    /**
     * Fix pentru importuri invalide
     */
    async fixImports(content, errorInfo) {
        // Verificăm dacă există importuri duplicate
        const importPattern = /import\s+.+?\s+from\s+['"].+?['"];?/g;
        const imports = content.match(importPattern) || [];
        const seen = new Set();
        const duplicates = [];

        for (const imp of imports) {
            if (seen.has(imp)) {
                duplicates.push(imp);
            } else {
                seen.add(imp);
            }
        }

        if (duplicates.length > 0) {
            let fixed = content;
            for (const dup of duplicates) {
                fixed = fixed.replace(dup, '// Removed duplicate: ' + dup);
            }

            return {
                success: true,
                type: 'duplicate-imports',
                description: `Eliminat importuri duplicate`,
                content: fixed
            };
        }

        return { success: false };
    }

    /**
     * Folosește AI pentru a repara codul când fixurile simple nu funcționează
     */
    async fixWithAI(content, errorInfo) {
        try {
            const prompt = [
                {
                    role: 'system',
                    content: `Ești un expert în React și JavaScript. Repară eroarea din codul de mai jos.

EROARE:
${errorInfo.message}

FIȘIER: ${errorInfo.filePath}
LINIA: ${errorInfo.line}

COD:
\`\`\`jsx
${content}
\`\`\`

REGULI:
1. Repară DOAR eroarea specificată
2. Păstrează restul codului intact
3. Asigură-te că sintaxa este validă
4. Răspunde DOAR cu codul reparat, fără explicații
5. Nu adăuga comentarii despre ce ai schimbat`
                }
            ];

            const response = await callKimiThinking(prompt);
            let fixedCode = response.content
                .replace(/```jsx|```javascript|```js|```/g, '')
                .trim();

            // Verificăm că codul nu e gol
            if (fixedCode && fixedCode.length > 10) {
                return {
                    success: true,
                    type: 'ai-fix',
                    description: 'Cod reparat folosind AI',
                    content: fixedCode
                };
            }

            return { success: false };

        } catch (error) {
            await logger.error('Eroare în fixWithAI', { error: error.message });
            return { success: false };
        }
    }
}

module.exports = { CodeFixerService };
