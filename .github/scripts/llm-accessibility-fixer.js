// .github/scripts/llm-accessibility-fixer.js
import fs from 'fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import OpenAI from 'openai';

class A11yMCPClient {
  constructor() {
    this.client = null;
    this.transport = null;
    this.isConnected = false;
  }

  async initialize() {
    console.log('🔧 Initializing A11y MCP Server...');
    
    try {
      this.transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', 'a11y-mcp-server'],
        env: process.env
      });

      this.client = new Client({
        name: "llm-accessibility-fixer",
        version: "1.0.0"
      }, {
        capabilities: {
          tools: {}
        }
      });

      await this.client.connect(this.transport);
      console.log('✅ A11y MCP Server connected');
      this.isConnected = true;
      
    } catch (error) {
      console.error('❌ Failed to initialize A11y MCP Server:', error.message);
      this.isConnected = false;
      // Don't throw - continue with LLM-only mode
    }
  }

  async testHtml(html, tags = ['wcag2aa']) {
    if (!this.isConnected) {
      console.log('⚠️ MCP not connected, using LLM-only analysis');
      return null;
    }

    try {
      const result = await this.client.callTool({
        name: 'test_html_string',
        arguments: { html: html, tags: tags }
      });
      
      if (result.content && result.content[0]?.text) {
        return JSON.parse(result.content[0].text);
      }
      return null;
    } catch (error) {
      console.log(`⚠️ A11y MCP test failed: ${error.message}`);
      return null;
    }
  }

  async checkColorContrast(foreground, background) {
    if (!this.isConnected) {
      return this.calculateContrastRatio(foreground, background);
    }

    try {
      const result = await this.client.callTool({
        name: 'check_color_contrast',
        arguments: { foreground, background }
      });
      
      if (result.content && result.content[0]?.text) {
        return JSON.parse(result.content[0].text);
      }
      
      return this.calculateContrastRatio(foreground, background);
    } catch (error) {
      return this.calculateContrastRatio(foreground, background);
    }
  }

  calculateContrastRatio(color1, color2) {
    const getLuminance = (color) => {
      try {
        const hex = color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16) / 255;
        const g = parseInt(hex.substr(2, 2), 16) / 255;
        const b = parseInt(hex.substr(4, 2), 16) / 255;
        
        const [rs, gs, bs] = [r, g, b].map(c => 
          c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
        );
        
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      } catch (error) {
        return 0.5;
      }
    };

    try {
      const lum1 = getLuminance(color1);
      const lum2 = getLuminance(color2);
      const brightest = Math.max(lum1, lum2);
      const darkest = Math.min(lum1, lum2);
      const ratio = (brightest + 0.05) / (darkest + 0.05);
      
      return {
        contrastRatio: ratio,
        passes: ratio >= 4.5,
        wcagAA: ratio >= 4.5,
        wcagAAA: ratio >= 7.0
      };
    } catch (error) {
      return { contrastRatio: 1, passes: false, wcagAA: false, wcagAAA: false };
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.close();
        console.log('🔌 Disconnected from A11y MCP Server');
      } catch (error) {
        console.log('⚠️ Error disconnecting:', error.message);
      }
    }
  }
}

class LLMAccessibilityAgent {
  constructor(a11yClient) {
    this.a11yClient = a11yClient;
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async analyzeAndFixAccessibility(htmlContent, filePath) {
    console.log('🤖 Starting LLM-powered accessibility analysis...');

    let initialAnalysis = null;
    try {
      initialAnalysis = await this.a11yClient.testHtml(htmlContent);
    } catch (error) {
      console.log('⚠️ MCP analysis failed, using LLM-only approach');
    }
    
    const fixPlan = await this.generateFixPlan(htmlContent, initialAnalysis, filePath);
    const fixedContent = await this.applyFixes(htmlContent, fixPlan);
    
    return {
      originalAnalysis: initialAnalysis,
      fixPlan: fixPlan,
      fixedContent: fixedContent
    };
  }

  async generateFixPlan(htmlContent, analysis, filePath) {
    console.log('🧠 Generating fix plan with LLM...');

    const prompt = `Analyze this HTML for accessibility issues and provide specific fixes.

FILE: ${filePath}

HTML CONTENT:
\`\`\`html
${htmlContent}
\`\`\`

Find accessibility issues like:
1. Poor color contrast (suggest colors that pass WCAG AA 4.5:1 ratio)
2. Missing alt text
3. Unlabeled form inputs
4. ARIA issues

Return JSON:
{
  "summary": "Brief overview",
  "fixes": [
    {
      "type": "color-contrast|alt-text|form|aria",
      "description": "What this fixes",
      "originalCode": "exact current code",
      "fixedCode": "exact replacement",
      "explanation": "why this works"
    }
  ]
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: "You are an accessibility expert. Return only valid JSON." },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 3000
      });

      const responseText = response.choices[0].message.content;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      return { summary: "No JSON found", fixes: [] };
    } catch (error) {
      console.error('❌ Error calling OpenAI:', error.message);
      return { summary: "OpenAI API error", fixes: [] };
    }
  }

  async applyFixes(htmlContent, fixPlan) {
    console.log('🔧 Applying accessibility fixes...');

    let fixedContent = htmlContent;
    let appliedFixes = 0;

    for (const fix of fixPlan.fixes || []) {
      try {
        if (fix.originalCode && fix.fixedCode && fixedContent.includes(fix.originalCode)) {
          fixedContent = fixedContent.replace(fix.originalCode, fix.fixedCode);
          appliedFixes++;
          console.log(`✅ Applied: ${fix.description}`);
        }
      } catch (error) {
        console.error(`❌ Error applying fix: ${error.message}`);
      }
    }

    console.log(`✅ Applied ${appliedFixes} out of ${fixPlan.fixes?.length || 0} fixes`);
    return fixedContent;
  }

  async generateReport(results, filePath) {
    const fixesApplied = results.fixPlan?.fixes?.length || 0;

    return `# 🎯 Accessibility Report

**File:** ${filePath}  
**Generated:** ${new Date().toISOString()}

## 📊 Summary

- Fixes Applied: ${fixesApplied}

## ✅ Fixes Applied

${results.fixPlan?.fixes?.map((fix, i) => `${i + 1}. **${fix.type}**: ${fix.description}`).join('\n') || 'No fixes applied.'}

---
*Generated by LLM + A11y MCP Server*`;
  }
}

async function findHtmlFiles() {
  const paths = ['index.html', 'public/index.html', 'src/index.html'];
  const found = [];
  
  for (const path of paths) {
    try {
      await fs.access(path);
      found.push(path);
      console.log(`✅ Found: ${path}`);
    } catch (error) {
      // File doesn't exist
    }
  }
  
  return found;
}

async function main() {
  let a11yClient = null;
  
  try {
    console.log('🚀 Starting accessibility fixing...');
    
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY required');
    }

    a11yClient = new A11yMCPClient();
    await a11yClient.initialize();

    const llmAgent = new LLMAccessibilityAgent(a11yClient);
    const htmlFiles = await findHtmlFiles();
    
    if (htmlFiles.length === 0) {
      console.log('ℹ️ No HTML files found');
      return;
    }

    let totalFixes = 0;

    for (const filePath of htmlFiles) {
      console.log(`\n📄 Processing ${filePath}...`);
      
      const originalContent = await fs.readFile(filePath, 'utf-8');
      const results = await llmAgent.analyzeAndFixAccessibility(originalContent, filePath);

      if (results.fixedContent !== originalContent) {
        await fs.writeFile(`${filePath}.backup`, originalContent);
        await fs.writeFile(filePath, results.fixedContent);
        totalFixes += results.fixPlan.fixes?.length || 0;
        console.log(`✅ Applied fixes to ${filePath}`);
      }

      const report = await llmAgent.generateReport(results, filePath);
      await fs.writeFile(`ACCESSIBILITY_REPORT_${filePath.replace(/[\/\\]/g, '_')}.md`, report);
    }

    console.log(`🎉 Completed! Applied ${totalFixes} total fixes.`);

  } catch (error) {
    console.error('💥 Error:', error.message);
    process.exit(1);
  } finally {
    if (a11yClient) {
      await a11yClient.disconnect();
    }
  }
}

main();
