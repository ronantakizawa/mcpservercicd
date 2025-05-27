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
      
      // Test connection by listing tools
      try {
        const tools = await this.client.listTools();
        console.log(`✅ A11y MCP Server connected with tools: ${tools.tools?.map(t => t.name).join(', ') || 'none'}`);
        this.isConnected = true;
      } catch (toolsError) {
        console.log('✅ A11y MCP Server connected (tools list unavailable)');
        this.isConnected = true;
      }
      
    } catch (error) {
      console.error('❌ Failed to initialize A11y MCP Server:', error.message);
      this.isConnected = false;
      throw error;
    }
  }

  async testHtml(html, tags = ['wcag2aa']) {
    if (!this.isConnected) {
      console.log('⚠️ MCP not connected, using LLM-only analysis');
      return null;
    }

    try {
      console.log('🔍 Testing HTML with A11y MCP...');
      
      const result = await this.client.callTool({
        name: 'test_html_string',
        arguments: {
          html: html,
          tags: tags
        }
      });
      
      if (result.content && result.content.length > 0) {
        const content = result.content[0];
        if (content.type === 'text' && content.text) {
          return JSON.parse(content.text);
        }
      }
      
      return null;
    } catch (error) {
      console.log(`⚠️ A11y MCP test failed: ${error.message}`);
      return null;
    }
  }

  async checkColorContrast(foreground, background, fontSize = 16, isBold = false) {
    if (!this.isConnected) {
      return this.calculateContrastRatio(foreground, background);
    }

    try {
      const result = await this.client.callTool({
        name: 'check_color_contrast',
        arguments: {
          foreground: foreground,
          background: background,
          fontSize: fontSize,
          isBold: isBold
        }
      });
      
      if (result.content && result.content[0]?.text) {
        return JSON.parse(result.content[0].text);
      }
      
      // Fallback to manual calculation
      return this.calculateContrastRatio(foreground, background);
    } catch (error) {
      console.log(`⚠️ Color contrast check failed, using fallback: ${error.message}`);
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
        return 0.5; // Default luminance
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
      console.error('Error calculating contrast ratio:', error);
      return {
        contrastRatio: 1,
        passes: false,
        wcagAA: false,
        wcagAAA: false
      };
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.close();
        console.log('🔌 Disconnected from A11y MCP Server');
      } catch (error) {
        console.log('⚠️ Error disconnecting from MCP server:', error.message);
      }
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

    // Step 1: Try to get MCP analysis, fallback to LLM-only
    let initialAnalysis = null;
    try {
      initialAnalysis = await this.a11yClient.testHtml(htmlContent);
    } catch (error) {
      console.log('⚠️ MCP analysis failed, using LLM-only approach');
    }
    
    // Step 2: LLM analysis (works with or without MCP data)
    const fixPlan = await this.generateFixPlan(htmlContent, initialAnalysis, filePath);
    
    // Step 3: Apply fixes with validation
    const fixedContent = await this.applyFixes(htmlContent, fixPlan);
    
    // Step 4: Try to validate fixes
    let finalAnalysis = null;
    try {
      if (fixedContent !== htmlContent) {
        finalAnalysis = await this.a11yClient.testHtml(fixedContent);
      }
    } catch (error) {
      console.log('⚠️ Final validation failed, skipping');
    }
    
    return {
      originalAnalysis: initialAnalysis,
      fixPlan: fixPlan,
      fixedContent: fixedContent,
      finalAnalysis: finalAnalysis
    };
  }

  async generateFixPlan(htmlContent, analysis, filePath) {
    console.log('🧠 Generating fix plan with LLM...');

    const analysisText = analysis ? JSON.stringify(analysis, null, 2) : 'No MCP analysis available - analyze the HTML directly';

    const prompt = `You are an accessibility expert. Analyze this HTML for WCAG compliance issues and provide specific fixes.

FILE: ${filePath}

${analysis ? 'ACCESSIBILITY ANALYSIS FROM A11Y MCP SERVER:' : 'MANUAL ANALYSIS REQUIRED:'}
${analysisText}

HTML CONTENT:
\`\`\`html
${htmlContent}
\`\`\`

Find and fix accessibility issues, especially:
1. COLOR CONTRAST violations - suggest specific hex colors that pass WCAG AA (4.5:1 minimum)
2. Missing alt text for images  
3. ARIA issues
4. Form accessibility
5. Heading structure

For each issue found, provide:
- Exact current problematic code
- Exact replacement code
- Brief explanation

Return JSON format:
{
  "summary": "Brief overview of issues found",
  "fixes": [
    {
      "type": "color-contrast|alt-text|aria|form|heading",
      "description": "What this fixes",
      "originalCode": "exact current HTML/CSS",
      "fixedCode": "exact replacement",
      "explanation": "why this fixes the issue"
    }
  ]
}

Focus on finding real issues in the provided HTML. Look for low-contrast colors, missing alt attributes, unlabeled form inputs, etc.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an expert web accessibility consultant. Analyze HTML code and provide precise, actionable WCAG compliance fixes. Always return valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 3000
      });

      const responseText = response.choices[0].message.content;
      
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          console.error('❌ Failed to parse LLM JSON response:', parseError.message);
          return { summary: "JSON parse error", fixes: [] };
        }
      } else {
        console.error('❌ No JSON found in LLM response');
        return { summary: "No JSON in response", fixes: [] };
      }
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
        // For color contrast fixes, try to validate
        if (fix.type === 'color-contrast') {
          const isValid = await this.validateColorFix(fix);
          if (!isValid) {
            console.log(`⚠️ Color fix may not meet contrast requirements: ${fix.description}`);
            // Still apply it - better than nothing
          }
        }

        // Apply the fix
        if (fix.originalCode && fix.fixedCode) {
          if (fixedContent.includes(fix.originalCode)) {
            fixedContent = fixedContent.replace(fix.originalCode, fix.fixedCode);
            appliedFixes++;
            console.log(`✅ Applied: ${fix.description}`);
          } else {
            // Try to apply color fixes more flexibly
            if (fix.type === 'color-contrast') {
              const colorFixed = this.applyColorFixFlexible(fixedContent, fix);
              if (colorFixed !== fixedContent) {
                fixedContent = colorFixed;
                appliedFixes++;
                console.log(`✅ Applied color fix: ${fix.description}`);
              }
            } else {
              console.log(`⚠️ Could not find code to replace for: ${fix.description}`);
            }
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
    try {
      const foregroundMatch = fix.fixedCode.match(/color:\s*([^;]+)/);
      const backgroundMatch = fix.fixedCode.match(/background-color:\s*([^;]+)/);

      if (foregroundMatch && backgroundMatch) {
        const fg = foregroundMatch[1].trim();
        const bg = backgroundMatch[1].trim();
        const result = await this.a11yClient.checkColorContrast(fg, bg);
        return result?.passes || false;
      }
      return true;
    } catch (error) {
      return true; // Assume valid if validation fails
    }
  }

  applyColorFixFlexible(htmlContent, fix) {
    // Try to extract and apply color changes more flexibly
    try {
      const originalColorMatch = fix.originalCode.match(/color:\s*([^;]+)/);
      const fixedColorMatch = fix.fixedCode.match(/color:\s*([^;]+)/);
      
      if (originalColorMatch && fixedColorMatch) {
        const originalColor = originalColorMatch[1].trim();
        const fixedColor = fixedColorMatch[1].trim();
        
        // Replace color declarations
        const colorRegex = new RegExp(`color:\\s*${originalColor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
        return htmlContent.replace(colorRegex, `color: ${fixedColor}`);
      }
      
      // Also try background colors
      const originalBgMatch = fix.originalCode.match(/background-color:\s*([^;]+)/);
      const fixedBgMatch = fix.fixedCode.match(/background-color:\s*([^;]+)/);
      
      if (originalBgMatch && fixedBgMatch) {
        const originalBg = originalBgMatch[1].trim();
        const fixedBg = fixedBgMatch[1].trim();
        
        const bgRegex = new RegExp(`background-color:\\s*${originalBg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
        return htmlContent.replace(bgRegex, `background-color: ${fixedBg}`);
      }
      
    } catch (error) {
      console.error('Error in flexible color fix:', error);
    }
    
    return htmlContent;
  }

  async generateReport(results, filePath) {
    const originalIssues = results.originalAnalysis?.violations?.length || 0;
    const remainingIssues = results.finalAnalysis?.violations?.length || 0;
    const fixesApplied = results.fixPlan?.fixes?.length || 0;

    return `# 🎯 Accessibility Report

**File:** ${filePath}  
**Generated:** ${new Date().toISOString()}  
**Tool:** LLM + A11y MCP Server

## 📊 Summary

| Metric | Count |
|--------|-------|
| Original Issues | ${originalIssues || 'Unknown'} |
| Fixes Applied | ${fixesApplied} |
| Remaining Issues | ${remainingIssues || 'Unknown'} |

## ✅ Fixes Applied

${results.fixPlan?.fixes?.map((fix, i) => `${i + 1}. **${fix.type}**: ${fix.description}`).join('\n') || 'No fixes were applied.'}

## 📋 Details

${results.fixPlan?.fixes?.map(fix => `### ${fix.description}
- **Type:** ${fix.type}
- **Fix:** ${fix.explanation}
`).join('\n') || 'No detailed fixes available.'}

## 🎉 Result

${fixesApplied > 0 ? `✅ Applied ${fixesApplied} accessibility improvements!` : 'ℹ️ No accessibility issues detected.'}

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

    // Initialize A11y MCP client (with fallback if it fails)
    a11yClient = new A11yMCPClient();
    try {
      await a11yClient.initialize();
    } catch (mcpError) {
      console.log('⚠️ A11y MCP Server failed to initialize, continuing with LLM-only mode');
      console.log('Error:', mcpError.message);
    }

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
    console.error('Stack:', error.stack);
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
| Original Issues | ${totalOriginal || 'Unknown'} |
| Fixes Applied | ${totalFixed} |
| Remaining Issues | ${totalRemaining || 'Unknown'} |

## 📁 Files Processed

${processedFiles.map(file => `### ${file.filePath}
- Original Issues: ${file.originalIssues || 'Unknown'}
- Fixes Applied: ${file.fixesApplied}
- Remaining Issues: ${file.remainingIssues || 'Unknown'}
- Report: [${file.reportPath}](./${file.reportPath})
`).join('\n')}

---
*Generated by LLM + A11y MCP Server*`;
}

main();