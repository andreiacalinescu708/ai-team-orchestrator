const PDFParser = require('pdf-parse');
const PDFDocument = require('pdfkit');
const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('../utils/logger');

const logger = new Logger('PDFProcessor');

/**
 * PDFProcessor - Procesează fișiere PDF (extracție și generare)
 */
class PDFProcessor {
    constructor() {
        this.tempDir = './temp';
        this.ensureTempDir();
    }

    async ensureTempDir() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (e) {
            // Directorul există deja
        }
    }

    /**
     * Extrage text din PDF
     */
    async extractText(pdfPath) {
        try {
            const dataBuffer = await fs.readFile(pdfPath);
            const data = await PDFParser(dataBuffer);
            
            await logger.info('Text extras din PDF', { 
                pages: data.numpages, 
                textLength: data.text.length 
            });

            return {
                success: true,
                text: data.text,
                pages: data.numpages,
                info: data.info
            };
        } catch (error) {
            await logger.error('Eroare extracție PDF', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Extrage date structurate (facturi, tabele)
     */
    async extractStructuredData(pdfPath, type = 'auto') {
        const extractResult = await this.extractText(pdfPath);
        
        if (!extractResult.success) {
            return extractResult;
        }

        const text = extractResult.text;

        // Pattern-uri pentru extragere date
        const patterns = {
            invoice: {
                client: /client|customer|cumpărător|beneficiar[\s:]*([^\n]+)/i,
                total: /total|sumă|amount[\s:]*([\d.,]+)/i,
                date: /data|date[\s:]*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/i,
                invoiceNumber: /factura|invoice|nr[.\s:]*([A-Z0-9\-]+)/i
            },
            report: {
                title: /raport|report|titlu[\s:]*([^\n]+)/i,
                period: /perioada|period[\s:]*([^\n]+)/i,
                summary: /rezumat|summary|concluzii[\s:]*([^\n]+)/i
            },
            table: {
                // Caută pattern-uri de tabel
                rows: text.match(/[^\n]+\|[^\n]+/g) || []
            }
        };

        let extracted = {
            rawText: text,
            type: type,
            data: {}
        };

        // Extragem după pattern-uri
        if (type === 'auto' || type === 'invoice') {
            extracted.data.invoice = {};
            for (const [key, pattern] of Object.entries(patterns.invoice)) {
                const match = text.match(pattern);
                if (match) {
                    extracted.data.invoice[key] = match[1].trim();
                }
            }
        }

        if (type === 'auto' || type === 'report') {
            extracted.data.report = {};
            for (const [key, pattern] of Object.entries(patterns.report)) {
                const match = text.match(pattern);
                if (match) {
                    extracted.data.report[key] = match[1].trim();
                }
            }
        }

        return {
            success: true,
            extracted
        };
    }

    /**
     * Generează PDF nou
     */
    async generatePDF(outputPath, content) {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument();
                const stream = require('fs').createWriteStream(outputPath);
                
                doc.pipe(stream);

                // Adăugăm conținut
                if (typeof content === 'string') {
                    // Text simplu
                    doc.fontSize(12).text(content, 50, 50);
                } else if (content.title) {
                    // Document structurat
                    let y = 50;

                    // Titlu
                    if (content.title) {
                        doc.fontSize(20).font('Helvetica-Bold').text(content.title, 50, y);
                        y += 40;
                    }

                    // Subtitlu
                    if (content.subtitle) {
                        doc.fontSize(14).font('Helvetica').text(content.subtitle, 50, y);
                        y += 30;
                    }

                    // Conținut
                    doc.fontSize(12);
                    if (content.sections) {
                        for (const section of content.sections) {
                            doc.font('Helvetica-Bold').text(section.title, 50, y);
                            y += 20;
                            
                            doc.font('Helvetica').text(section.content, 50, y, {
                                width: 500,
                                align: 'justify'
                            });
                            y += doc.heightOfString(section.content, { width: 500 }) + 20;

                            // Pagină nouă dacă e necesar
                            if (y > 700) {
                                doc.addPage();
                                y = 50;
                            }
                        }
                    }

                    // Tabel
                    if (content.table) {
                        y += 20;
                        this.drawTable(doc, content.table, 50, y);
                    }
                }

                doc.end();

                stream.on('finish', () => {
                    resolve({
                        success: true,
                        path: outputPath
                    });
                });

                stream.on('error', reject);

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Desenează tabel în PDF
     */
    drawTable(doc, tableData, x, y) {
        const rowHeight = 20;
        const colWidth = 100;
        
        doc.font('Helvetica-Bold');
        
        // Header
        tableData.headers.forEach((header, i) => {
            doc.text(header, x + i * colWidth, y);
        });
        
        y += rowHeight;
        doc.font('Helvetica');
        
        // Rows
        tableData.rows.forEach(row => {
            row.forEach((cell, i) => {
                doc.text(String(cell), x + i * colWidth, y);
            });
            y += rowHeight;
        });
    }

    /**
     * Procesează PDF și generează rezumat
     */
    async processAndSummarize(inputPath, outputPath, options = {}) {
        try {
            // Extragem text
            const extractResult = await this.extractText(inputPath);
            if (!extractResult.success) {
                return extractResult;
            }

            const text = extractResult.text;

            // Generăm rezumat (poate folosi AI pentru asta)
            let summary;
            if (options.useAI) {
                const { callKimiFast } = require('../utils/kimi-optimized');
                const prompt = [
                    {
                        role: 'system',
                        content: 'Fă un rezumat concis al acestui document. Extrage informațiile cheie.'
                    },
                    {
                        role: 'user',
                        content: text.substring(0, 4000) // Limităm pentru API
                    }
                ];
                const response = await callKimiFast(prompt);
                summary = response.content;
            } else {
                // Rezumat simplu - primele X cuvinte
                const words = text.split(/\s+/).slice(0, 200);
                summary = words.join(' ') + '...';
            }

            // Generăm PDF nou
            const content = {
                title: options.title || 'Rezumat Document',
                subtitle: `Generat din: ${path.basename(inputPath)}`,
                sections: [
                    {
                        title: 'Rezumat',
                        content: summary
                    },
                    {
                        title: 'Detalii Document',
                        content: `Pagini: ${extractResult.pages}\nInfo: ${JSON.stringify(extractResult.info, null, 2)}`
                    }
                ]
            };

            await this.generatePDF(outputPath, content);

            return {
                success: true,
                summary: summary,
                outputPath: outputPath
            };

        } catch (error) {
            await logger.error('Eroare procesare PDF', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Extrage tabele din PDF
     */
    async extractTables(pdfPath) {
        const result = await this.extractText(pdfPath);
        
        if (!result.success) {
            return result;
        }

        const text = result.text;
        const lines = text.split('\n');
        const tables = [];
        let currentTable = null;

        for (const line of lines) {
            // Detectăm rânduri care arată ca tabel (conțin | sau spații multiple)
            if (line.includes('|') || line.match(/\s{3,}/)) {
                if (!currentTable) {
                    currentTable = {
                        headers: [],
                        rows: []
                    };
                }
                
                const cells = line.split(/\||\s{3,}/).map(c => c.trim()).filter(c => c);
                if (cells.length > 1) {
                    if (currentTable.headers.length === 0) {
                        currentTable.headers = cells;
                    } else {
                        currentTable.rows.push(cells);
                    }
                }
            } else {
                if (currentTable && currentTable.rows.length > 0) {
                    tables.push(currentTable);
                    currentTable = null;
                }
            }
        }

        if (currentTable && currentTable.rows.length > 0) {
            tables.push(currentTable);
        }

        return {
            success: true,
            tables: tables
        };
    }
}

module.exports = { PDFProcessor };
