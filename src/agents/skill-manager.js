const { SkillRegistry } = require('../skills/registry');
const { SkillGenerator } = require('../skills/generator');
const { query } = require('../utils/db');
const { Logger } = require('../utils/logger');

const logger = new Logger('SkillManagerAgent');

/**
 * SkillManagerAgent - Gestionează detectarea și generarea automată de skills
 */
class SkillManagerAgent {
    constructor(bot) {
        this.bot = bot;
        this.registry = new SkillRegistry();
        this.generator = new SkillGenerator();
    }

    /**
     * Analizează cerințele și returnează analysis complet
     */
    async analyzeRequirements(discoveryData) {
        await logger.info('Analizez cerințe pentru skills');
        
        // Safety check
        if (!discoveryData) {
            console.log('⚠️ Discovery data e gol/undefined!');
            return { required: [], optional: [], missing: [], alternatives: {}, reasoning: '' };
        }
        
        console.log('🔍 Discovery data:', JSON.stringify(discoveryData).substring(0, 200));

        // 1. Detectăm skills necesare
        const requirements = await this.registry.analyzeProjectRequirements(discoveryData);
        console.log('📋 Requirements:', requirements);
        
        // 2. Găsim skills lipsă
        const allRequired = [...(requirements.required || []), ...(requirements.optional || [])];
        console.log('🔍 Căutăm skills lipsă din:', allRequired);
        const missing = await this.registry.findMissingSkills(allRequired);
        console.log('❌ Skills lipsă:', missing);

        // 3. Căutăm alternative pentru cele lipsă
        const alternatives = {};
        for (const skill of missing) {
            const alt = await this.registry.findAlternativeSkill(skill);
            if (alt) {
                alternatives[skill] = alt;
            }
        }

        return {
            required: requirements.required,
            optional: requirements.optional,
            missing: missing,
            alternatives: alternatives,
            reasoning: requirements.reasoning
        };
    }

    /**
     * Gestionează skills lipsă - trimite mesaj userului
     */
    async handleMissingSkills(chatId, projectId, analysis) {
        const { missing, alternatives, reasoning } = analysis;
        
        if (missing.length === 0) {
            return { action: 'proceed' };
        }

        await logger.info('Skills lipsă detectate', { projectId, missing: missing.length });

        // Construim mesajul
        let message = `🔍 <b>Analiză cerințe:</b>\n\n`;
        
        if (reasoning) {
            message += `<i>${reasoning}</i>\n\n`;
        }

        message += `<b>Skills necesare:</b>\n`;
        
        // Skills disponibile
        const available = await this.registry.getAvailableSkillNames();
        for (const skill of analysis.required) {
            const status = available.includes(skill) ? '✅' : '❌';
            const alt = alternatives[skill] ? ` (alternativ: ${alternatives[skill]})` : '';
            message += `${status} ${skill}${alt}\n`;
        }

        message += `\n<b>Skills lipsă (${missing.length}):</b>\n`;
        message += missing.map(s => `• ${s}`).join('\n');
        
        message += `\n\nPot să generez automat skills lipsă. Durează ~30 secunde per skill.`;

        // Salvăm analysis în DB pentru a-l accesa mai târziu
        await query(
            'UPDATE projects SET discovery_data = discovery_data || $1::jsonb WHERE id = $2',
            [JSON.stringify({ skill_analysis: analysis }), projectId]
        );

        await this.bot.telegram.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{text: '🤖 Generează automat', callback_data: `generate_skills_${projectId}`}],
                    [{text: '📝 Le adaug eu manual', callback_data: `manual_skills_${projectId}`}],
                    [{text: '⏭️ Continuă fără ele', callback_data: `skip_skills_${projectId}`}]
                ]
            }
        });

        return { action: 'waiting_user' };
    }

    /**
     * Generează și salvează skills automat
     */
    async generateAndSaveSkills(chatId, projectId, skillNames) {
        await this.bot.telegram.sendMessage(chatId, `🔄 Generez ${skillNames.length} skills...`);

        const results = {
            success: [],
            failed: []
        };

        for (const skillName of skillNames) {
            try {
                await this.bot.telegram.sendChatAction(chatId, 'typing');
                
                // Generăm skill-ul
                const skill = await this.generator.generateSkill(
                    skillName,
                    `Skill generat automat pentru ${skillName}`,
                    ''
                );

                // Testăm skill-ul
                const testResult = await this.generator.testSkill(skill);
                
                if (!testResult.success) {
                    throw new Error(`Test eșuat: ${testResult.error}`);
                }

                // Salvăm în filesystem
                const saveResult = await this.generator.saveSkill(skill);
                if (!saveResult.success) {
                    throw new Error(`Salvare eșuată: ${saveResult.error}`);
                }

                // Înregistrăm în DB
                await this.registry.registerSkill(skill);

                results.success.push(skillName);
                await this.bot.telegram.sendMessage(chatId, `✅ Skill generat: <code>${skillName}</code>`, {
                    parse_mode: 'HTML'
                });

            } catch (error) {
                results.failed.push({ name: skillName, error: error.message });
                await this.bot.telegram.sendMessage(chatId, `❌ Eroare la <code>${skillName}</code>: ${error.message}`, {
                    parse_mode: 'HTML'
                });
            }
        }

        // Rezumat final
        const successCount = results.success.length;
        const failCount = results.failed.length;
        
        await this.bot.telegram.sendMessage(chatId, 
            `📊 <b>Rezultat generare:</b>\n` +
            `✅ Succes: ${successCount}\n` +
            `❌ Eșuate: ${failCount}\n\n` +
            (successCount === skillNames.length ? 
                'Toate skills au fost generate cu succes! Pornim execuția?' : 
                'Unele skills au eșuat, dar putem continua cu cele disponibile.'),
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{text: '🚀 START Execuție', callback_data: `start_execution_${projectId}`}],
                        [{text: '🔄 Încearcă din nou', callback_data: `generate_skills_${projectId}`}]
                    ]
                }
            }
        );

        return results;
    }

    /**
     * Listează toate skills disponibile pentru user
     */
    async listSkills(chatId) {
        const skills = await this.registry.getAvailableSkills();
        
        const coreSkills = this.registry.coreSkills.map(s => `• ${s} (core)`).join('\n');
        
        const generatedSkills = skills
            .filter(s => s.category === 'generated')
            .map(s => `• ${s.name} ${s.auto_generated ? '🤖' : ''}`)
            .join('\n') || 'Niciun skill generat încă.';

        const workerSkills = skills
            .filter(s => s.category === 'worker')
            .map(s => `• ${s.name}`)
            .join('\n');

        const message = `📚 <b>Skills disponibile:</b>\n\n` +
            `<b>Core (mereu disponibile):</b>\n${coreSkills}\n\n` +
            `<b>Generați automat:</b>\n${generatedSkills}\n\n` +
            (workerSkills ? `<b>Workers:</b>\n${workerSkills}` : '');

        await this.bot.telegram.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{text: '➕ Generează skill nou', callback_data: 'generate_new_skill'}]
                ]
            }
        });
    }

    /**
     * Pornește wizard pentru generare skill manuală
     */
    async startSkillGenerationWizard(chatId, userId) {
        await this.bot.telegram.sendMessage(chatId, 
            `🧙‍♂️ <b>Wizard generare skill</b>\n\n` +
            `Scrie-mi ce vrei să facă skill-ul:\n` +
            `<i>Ex: "Trimite email via SMTP cu HTML și atașamente"</i>`,
            { parse_mode: 'HTML' }
        );

        // Stocăm starea wizard în sesiunea userului
        // (ar trebui implementat cu o mapă de sesiuni)
    }
}

module.exports = { SkillManagerAgent };
