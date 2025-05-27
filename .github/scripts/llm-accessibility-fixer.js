import fs from 'fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import OpenAI from 'openai';

class A11yMCPClient {
  constructor() {
    this.client = null;
    this.transport = null;
  }

  async initialize() {
    console.log('🔧 Initializing A11y MCP Server...');
    
    this.transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', 'a11y-mcp-server'],
      env: process.env
    });

    this.client = new Client({
      name: "llm-accessibility-fixer",
      version: "1.0.0"
    }, {
      capabilities: {}
    });

    await this.client.connect(this.transport);
    console.log('✅ A11y MCP Server connected');
  }

  async testHtml(html, tags = ['wcag2aa']) {
    try {
      const result = await this.client.callTool('test_html_string', {
        html,
        tags
      });
      
      if (result.content && result.content[0]?.text) {
        return JSON.parse(result.content[0].text);
      }
      return null;
    } catch (error) {
      console.error('Error testing HTML:', error);
      return null;
    }
  }

  async checkColorContrast(foreground, background, fontSize = 16, isBold = false) {
    try {
      const result = await this.client.callTool('check_color_contrast', {
        foreground,
        background,
        fontSize,
        isBold
      });
      
      if (result.content && result.content[0]?.text) {
        return JSON.parse(result.content[0].text);
      }
      return null;
    } catch (error) {
      console.error('Error checking color contrast:', error);
      return null;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      console.log('🔌 Disconnected from A11y MCP Server');
    }
  }
}

class LLMAccessibilityAgent {
  constructor(a11yClient) {
    this.a11yClient = a11yClient;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async analyzeAndFixAccessibility(htmlContent, filePath) {
    console.log('🤖 Starting LLM-powered accessibility analysis...');

    // Step 1: Get accessibility analysis from A11y MCP
    const initialAnalysis = await this.a11yClient.testHtml(htmlContent);
    
    // Step 2: Use LLM to understand issues and generate fixes
    const fixPlan = await this.generateFixPlan(htmlContent, initialAnalysis, filePath);
    
    // Step 3: Apply fixes with validation
    const fixedContent = await this.applyFixes(htmlContent, fixPlan);
    
    // Step 4: Validate the fixes
    const finalAnalysis = await this.a11yClient.testHtml(fixedContent);
    
    return {
      originalAnalysis: initialAnalysis,
      fixPlan: fixPlan,
      fixedContent: fixedContent,
      finalAnalysis: finalAnalysis
    };
  }

  async generateFixPlan(htmlContent, analysis, filePath) {
    console.log('🧠 Generating fix plan with LLM...');

    const prompt = `You are an accessibility expert. Analyze this HTML and the accessibility violations, then provide specific fixes.

FILE: ${filePath}

ACCESSIBILITY VIOLATIONS:
${JSON.stringify(analysis, null, 2)}

HTML CONTENT:
\`\`\`html
${htmlContent}
\`\`\`

Please provide fixes for accessibility issues, especially:
1. COLOR CONTRAST violations - suggest specific hex colors that pass WCAG AA (4.5:1 ratio)
2. Missing alt text for images
3. ARIA attribute issues
4. Form accessibility problems

For each fix, provide:
- Exact current code to replace
- Exact replacement code
- Brief explanation

Respond in JSON format:
{
  "summary": "Brief overview",
  "fixes": [
    {
      "type": "color-contrast|alt-text|aria|form|other",
      "description": "What this fixes",
      "originalCode": "exact current code",
      "fixedCode": "exact replacement code",
      "explanation": "why this works"
    }
  ]
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert accessibility consultant. Provide precise, actionable fixes for WCAG compliance issues."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4000
      });

      const responseText = response.choices[0].message.content;
      
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse fix plan JSON');
      }
    } catch (error) {
      console.error('Error generating fix plan:', error);
      return { summary: "Error generating fixes", fixes: [] };
    }
  }

  async applyFixes(htmlContent, fixPlan) {
    console.log('🔧 Applying accessibility fixes...');

    let fixedContent = htmlContent;
    let appliedFixes = 0;

    for (const fix of fixPlan.fixes || []) {
      try {
        // For color contrast fixes, validate with A11y MCP first
        if (fix.type === 'color-contrast') {
          const isValid = await this.validateColorFix(fix);
          if (!isValid) {
            console.log(`⚠️ Skipping color fix - contrast still insufficient: ${fix.description}`);
            continue;
          }
        }

        // Apply the fix
        if (fix.originalCode && fix.fixedCode && fixedContent.includes(fix.originalCode)) {
          fixedContent = fixedContent.replace(fix.originalCode, fix.fixedCode);
          appliedFixes++;
          console.log(`✅ Applied fix: ${fix.description}`);
        } else {
          // Try partial matches for CSS properties
          if (fix.type === 'color-contrast') {
            fixedContent = this.applyColorFix(fixedContent, fix);
            appliedFixes++;
            console.log(`✅ Applied color fix: ${fix.description}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error applying fix "${fix.description}":`, error.message);
      }
    }

    console.log(`✅ Applied ${appliedFixes} out of ${fixPlan.fixes?.length || 0} fixes`);
    return fixedContent;
  }

  async validateColorFix(fix) {
    // Extract colors from the fixed code
    const foregroundMatch = fix.fixedCode.match(/color:\s*([^;]+)/);
    const backgroundMatch = fix.fixedCode.match(/background-color:\s*([^;]+)/);

    if (foregroundMatch && backgroundMatch) {
      const fg = foregroundMatch[1].trim();
      const bg = backgroundMatch[1].trim();

      const contrastResult = await this.a11yClient.checkColorContrast(fg, bg);
      return contrastResult?.passes || false;
    }

    return true; // Assume valid if we can't extract colors
  }

  applyColorFix(htmlContent, fix) {
    // Extract color values from the fix
    const originalColorMatch = fix.originalCode.match(/color:\s*([^;]+)/);
    const fixedColorMatch = fix.fixedCode.match(/color:\s*([^;]+)/);
    
    if (originalColorMatch && fixedColorMatch) {
      const originalColor = originalColorMatch[1].trim();
      const fixedColor = fixedColorMatch[1].trim();
      
      // Replace all instances of the original color
      const colorRegex = new RegExp(`color:\\s*${originalColor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
      return htmlContent.replace(colorRegex, `color: ${fixedColor}`);
    }

    return htmlContent;
  }

  async generateReport(results, filePath) {
    console.log('📋 Generating accessibility report...');

    const originalIssues = results.originalAnalysis?.violations?.length || 0;
    const remainingIssues = results.finalAnalysis?.violations?.length || 0;
    const fixesApplied = results.fixPlan?.fixes?.length || 0;

    const prompt = `Create a comprehensive accessibility report based on these results:

FILE: ${filePath}
ORIGINAL ISSUES: ${originalIssues}
FIXES APPLIED: ${fixesApplied}
REMAINING ISSUES: ${remainingIssues}

ORIGINAL ANALYSIS:
${JSON.stringify(results.originalAnalysis, null, 2)}

APPLIED FIXES:
${JSON.stringify(results.fixPlan, null, 2)}

FINAL ANALYSIS:
${JSON.stringify(results.finalAnalysis, null, 2)}

Create a professional markdown report with:
1. Executive summary
2. Before/after comparison
3. List of fixes applied
4. Remaining issues (if any)
5. Recommendations

Keep it concise but informative.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "Create professional accessibility reports for development teams."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('Error generating report:', error);
      return this.createFallbackReport(results, filePath);
    }
  }

  createFallbackReport(results, filePath) {
    const originalIssues = results.originalAnalysis?.violations?.length || 0;
    const remainingIssues = results.finalAnalysis?.violations?.length || 0;
    const fixesApplied = results.fixPlan?.fixes?.length || 0;

    return `# 🎯 Accessibility Report

**File:** ${filePath}  
**Generated:** ${new Date().toISOString()}

## 📊 Summary

| Metric | Count |
|--------|-------|
| Original Issues | ${originalIssues} |
| Fixes Applied | ${fixesApplied} |
| Remaining Issues | ${remainingIssues} |
| Success Rate | ${originalIssues > 0 ? Math.round(((originalIssues - remainingIssues) / originalIssues) * 100) : 100}% |

## ✅ Fixes Applied

${results.fixPlan?.fixes?.map(fix => `- **${fix.type}**: ${fix.description}`).join('\n') || 'No fixes were applied.'}

## 🎉 Result

${remainingIssues === 0 ? '✅ All accessibility issues have been resolved!' : `⚠️ ${remainingIssues} issues remain to be addressed.`}

---
*Generated by LLM + A11y MCP Server*`;
  }
}

async function findHtmlFiles() {
  console.log('🔍 Looking for HTML files...');
  
  const paths = [
    'index.html',
    'public/index.html', 
    'src/index.html',
    'dist/index.html'
  ];
  
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
    console.log('🚀 Starting LLM-powered accessibility fixing...');
    
    // Check required environment variables
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    // Initialize A11y MCP client
    a11yClient = new A11yMCPClient();
    await a11yClient.initialize();

    // Initialize LLM agent
    const llmAgent = new LLMAccessibilityAgent(a11yClient);

    // Find HTML files to process
    const htmlFiles = await findHtmlFiles();
    if (htmlFiles.length === 0) {
      console.log('ℹ️ No HTML files found to process');
      return;
    }

    let totalFixesApplied = 0;
    const processedFiles = [];

    // Process each HTML file
    for (const filePath of htmlFiles) {
      console.log(`\n📄 Processing ${filePath}...`);
      
      try {
        const originalContent = await fs.readFile(filePath, 'utf-8');
        console.log(`📄 Read ${originalContent.length} characters`);

        // Analyze and fix accessibility issues
        const results = await llmAgent.analyzeAndFixAccessibility(originalContent, filePath);

        // Write fixed content if changes were made
        if (results.fixedContent !== originalContent) {
          // Backup original file
          await fs.writeFile(`${filePath}.backup`, originalContent);
          
          // Write fixed content
          await fs.writeFile(filePath, results.fixedContent);
          console.log(`✅ Applied fixes to ${filePath}`);
          totalFixesApplied += results.fixPlan.fixes?.length || 0;
        } else {
          console.log(`ℹ️ No changes needed for ${filePath}`);
        }

        // Generate detailed report
        const report = await llmAgent.generateReport(results, filePath);
        const reportPath = `ACCESSIBILITY_REPORT_${filePath.replace(/[\/\\]/g, '_')}.md`;
        await fs.writeFile(reportPath, report);
        console.log(`📋 Generated report: ${reportPath}`);

        processedFiles.push({
          filePath,
          originalIssues: results.originalAnalysis?.violations?.length || 0,
          fixesApplied: results.fixPlan.fixes?.length || 0,
          remainingIssues: results.finalAnalysis?.violations?.length || 0,
          reportPath
        });

      } catch (error) {
        console.error(`❌ Error processing ${filePath}:`, error.message);
      }
    }

    // Create summary
    if (processedFiles.length > 0) {
      const summary = createSummary(processedFiles);
      await fs.writeFile('ACCESSIBILITY_SUMMARY.md', summary);
      console.log('📋 Created ACCESSIBILITY_SUMMARY.md');
    }

    console.log(`\n🎉 Completed! Applied ${totalFixesApplied} fixes across ${processedFiles.length} files.`);

  } catch (error) {
    console.error('💥 Error:', error.message);
    process.exit(1);
  } finally {
    if (a11yClient) {
      await a11yClient.disconnect();
    }
  }
}

function createSummary(processedFiles) {
  const totalOriginal = processedFiles.reduce((sum, f) => sum + f.originalIssues, 0);
  const totalFixed = processedFiles.reduce((sum, f) => sum + f.fixesApplied, 0);
  const totalRemaining = processedFiles.reduce((sum, f) => sum + f.remainingIssues, 0);

  return `# 🤖 LLM Accessibility Fixes Summary

**Generated:** ${new Date().toISOString()}

## 📊 Overall Results

| Metric | Count |
|--------|--------|
| Files Processed | ${processedFiles.length} |
| Original Issues | ${totalOriginal} |
| Fixes Applied | ${totalFixed} |
| Remaining Issues | ${totalRemaining} |
| Success Rate | ${totalOriginal > 0 ? Math.round(((totalOriginal - totalRemaining) / totalOriginal) * 100) : 100}% |

## 📁 Files Processed

${processedFiles.map(file => `### ${file.filePath}
- Original Issues: ${file.originalIssues}
- Fixes Applied: ${file.fixesApplied}
- Remaining Issues: ${file.remainingIssues}
- Report: [${file.reportPath}](./${file.reportPath})
`).join('\n')}

---
*Generated by LLM + A11y MCP Server*`;
}

main();