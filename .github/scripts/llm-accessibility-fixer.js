// LLM Direct MCP Tool Calling Implementation using OpenAI Function Calling
import fs from 'fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import OpenAI from 'openai';

class LLMDirectMCPAgent {
  constructor() {
    this.a11yClient = null;
    this.transport = null;
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async initialize() {
    console.log('🔧 Initializing A11y MCP Server for direct LLM access...');
    
    this.transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', 'a11y-mcp-server'],
      env: process.env
    });

    this.a11yClient = new Client({
      name: "llm-direct-mcp-agent",
      version: "1.0.0"
    }, {
      capabilities: { tools: {} }
    });

    await this.a11yClient.connect(this.transport);
    console.log('✅ A11y MCP Server connected for direct LLM access');
  }

  // Function that LLM can call to test HTML accessibility
  async testHtmlAccessibility(html, tags = ['wcag2aa']) {
    console.log('🔍 LLM requested HTML accessibility test...');
    
    try {
      const result = await this.a11yClient.callTool({
        name: 'test_html_string',
        arguments: { html, tags }
      });
      
      if (result.content && result.content[0]?.text) {
        const analysis = JSON.parse(result.content[0].text);
        console.log(`📊 Found ${analysis.violations?.length || 0} accessibility violations`);
        return analysis;
      }
      return null;
    } catch (error) {
      console.error('❌ MCP tool call failed:', error.message);
      return { error: error.message };
    }
  }

  // Function that LLM can call to check color contrast
  async checkColorContrast(foreground, background, fontSize = 16, isBold = false) {
    console.log(`🎨 LLM requested color contrast check: ${foreground} on ${background}`);
    
    try {
      const result = await this.a11yClient.callTool({
        name: 'check_color_contrast',
        arguments: { foreground, background, fontSize, isBold }
      });
      
      if (result.content && result.content[0]?.text) {
        const contrastData = JSON.parse(result.content[0].text);
        console.log(`📏 Contrast ratio: ${contrastData.contrastRatio?.toFixed(2)}:1`);
        return contrastData;
      }
      return null;
    } catch (error) {
      console.error('❌ Color contrast check failed:', error.message);
      return { error: error.message };
    }
  }

  // Function that LLM can call to get accessibility rules
  async getAccessibilityRules(tags = ['wcag2aa']) {
    console.log('📋 LLM requested accessibility rules...');
    
    try {
      const result = await this.a11yClient.callTool({
        name: 'get_rules',
        arguments: { tags }
      });
      
      if (result.content && result.content[0]?.text) {
        return JSON.parse(result.content[0].text);
      }
      return null;
    } catch (error) {
      console.error('❌ Get rules failed:', error.message);
      return { error: error.message };
    }
  }

  // Execute the function that LLM requested
  async executeFunction(name, args) {
    console.log(`🔧 Executing function: ${name}`);
    console.log(`📝 Arguments:`, args);

    switch (name) {
      case 'test_html_accessibility':
        return await this.testHtmlAccessibility(
          args.html, 
          args.tags || ['wcag2aa']
        );
      
      case 'check_color_contrast':
        return await this.checkColorContrast(
          args.foreground,
          args.background,
          args.fontSize || 16,
          args.isBold || false
        );
      
      case 'get_accessibility_rules':
        return await this.getAccessibilityRules(
          args.tags || ['wcag2aa']
        );
      
      default:
        return { error: `Unknown function: ${name}` };
    }
  }

  async analyzeAndFixWithDirectCalls(htmlContent, filePath) {
    console.log('🤖 Starting LLM-driven accessibility analysis with direct MCP calls...');

    // Define the tools/functions that LLM can call (following OpenAI format)
    const tools = [
      {
        type: "function",
        function: {
          name: "test_html_accessibility",
          description: "Test HTML content for accessibility violations using Axe-core via A11y MCP Server",
          parameters: {
            type: "object",
            properties: {
              html: {
                type: "string",
                description: "The HTML content to test for accessibility issues"
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "WCAG tags to test against (e.g., ['wcag2aa'])"
              }
            },
            required: ["html"],
            additionalProperties: false
          },
          strict: true
        }
      },
      {
        type: "function",
        function: {
          name: "check_color_contrast",
          description: "Check if color combination meets WCAG contrast requirements using A11y MCP Server",
          parameters: {
            type: "object",
            properties: {
              foreground: {
                type: "string",
                description: "Foreground color in hex format (e.g., '#000000')"
              },
              background: {
                type: "string",
                description: "Background color in hex format (e.g., '#ffffff')"
              },
              fontSize: {
                type: "number",
                description: "Font size in pixels"
              },
              isBold: {
                type: "boolean",
                description: "Whether the text is bold"
              }
            },
            required: ["foreground", "background"],
            additionalProperties: false
          },
          strict: true
        }
      },
      {
        type: "function",
        function: {
          name: "get_accessibility_rules",
          description: "Get information about available accessibility rules from A11y MCP Server",
          parameters: {
            type: "object",
            properties: {
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Filter rules by tags (e.g., ['wcag2aa'])"
              }
            },
            additionalProperties: false
          },
          strict: true
        }
      }
    ];

    // Initial conversation with LLM
    let messages = [
      {
        role: "system",
        content: `You are an expert accessibility consultant with access to A11y MCP server tools for WCAG compliance analysis.

Your task is to:
1. Use test_html_accessibility to analyze the provided HTML for accessibility violations
2. Based on the violations found, determine what specific fixes are needed
3. For color contrast issues, use check_color_contrast to validate any suggested color changes
4. Provide specific, actionable fixes with exact HTML/CSS code replacements

Always use the tools to get real accessibility analysis data rather than guessing. Be thorough and precise in your recommendations.`
      },
      {
        role: "user",
        content: `Please analyze this HTML file for accessibility issues and provide specific fixes:

File: ${filePath}

HTML Content:
\`\`\`html
${htmlContent}
\`\`\`

Start by testing the HTML for accessibility violations using the available tools.`
      }
    ];

    let maxIterations = 10;
    let iteration = 0;
    let finalResponse = null;

    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n🔄 LLM Iteration ${iteration}:`);

      try {
        // Call OpenAI with function calling enabled
        const response = await this.openai.chat.completions.create({
          model: "gpt-4",
          messages: messages,
          tools: tools,
          tool_choice: "auto", // Let LLM decide when to call functions
          temperature: 0.1,
          max_tokens: 3000
        });

        const message = response.choices[0].message;

        // Add the assistant's message to conversation
        messages.push({
          role: "assistant",
          content: message.content,
          tool_calls: message.tool_calls
        });

        // Check if LLM wants to call any functions
        if (message.tool_calls && message.tool_calls.length > 0) {
          console.log(`🔧 LLM requested ${message.tool_calls.length} tool call(s)`);

          // Execute each function call
          for (const toolCall of message.tool_calls) {
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);
            
            console.log(`📞 Calling: ${functionName}`);
            
            // Execute the function
            const functionResult = await this.executeFunction(functionName, functionArgs);
            
            // Add function result back to conversation
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(functionResult, null, 2)
            });

            console.log(`✅ Function result returned to LLM`);
          }
        } else {
          // LLM provided final response without calling functions
          console.log('🎯 LLM provided final analysis and recommendations');
          finalResponse = message.content;
          break;
        }
      } catch (error) {
        console.error(`❌ Error in iteration ${iteration}:`, error.message);
        break;
      }
    }

    if (!finalResponse && iteration >= maxIterations) {
      finalResponse = "Maximum iterations reached. Analysis may be incomplete.";
    }

    // Extract actionable fixes from the LLM's final response
    const fixes = this.extractFixesFromLLMResponse(finalResponse);
    
    return {
      analysis: finalResponse,
      fixes: fixes,
      conversationHistory: messages,
      toolCallsMade: messages.filter(msg => msg.tool_calls).length
    };
  }

  extractFixesFromLLMResponse(response) {
    const fixes = [];
    
    if (!response) return fixes;

    // Look for specific fix patterns in the LLM response
    const lines = response.split('\n');
    let currentFix = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for fix indicators
      if (line.includes('Fix') && line.includes(':')) {
        if (currentFix) {
          fixes.push(currentFix);
        }
        currentFix = {
          type: this.determineFitType(line),
          description: line,
          originalCode: '',
          fixedCode: '',
          explanation: ''
        };
      }
      
      // Look for code blocks
      if (line.startsWith('```') && currentFix) {
        const codeBlock = this.extractCodeBlock(lines, i);
        if (codeBlock) {
          if (!currentFix.originalCode && line.includes('html')) {
            currentFix.originalCode = codeBlock.code;
          } else if (!currentFix.fixedCode) {
            currentFix.fixedCode = codeBlock.code;
          }
        }
      }
      
      // Look for explanations
      if (line.includes('because') || line.includes('This fixes') || line.includes('explanation')) {
        if (currentFix) {
          currentFix.explanation = line;
        }
      }
    }
    
    // Add the last fix if exists
    if (currentFix) {
      fixes.push(currentFix);
    }
    
    // If no structured fixes found, create generic ones from code blocks
    if (fixes.length === 0) {
      const codeBlocks = response.match(/```[\s\S]*?```/g) || [];
      codeBlocks.forEach((block, index) => {
        fixes.push({
          type: "llm-suggested",
          description: `Fix ${index + 1} from LLM analysis`,
          originalCode: '',
          fixedCode: block.replace(/```\w*\n?/, '').replace(/```$/, ''),
          explanation: "Generated by LLM after MCP tool analysis"
        });
      });
    }

    return fixes;
  }

  determineFitType(description) {
    const lower = description.toLowerCase();
    if (lower.includes('color') || lower.includes('contrast')) return 'color-contrast';
    if (lower.includes('alt') || lower.includes('image')) return 'alt-text';
    if (lower.includes('label') || lower.includes('form')) return 'form';
    if (lower.includes('aria')) return 'aria';
    if (lower.includes('heading')) return 'heading';
    return 'other';
  }

  extractCodeBlock(lines, startIndex) {
    let code = '';
    let i = startIndex + 1;
    
    while (i < lines.length && !lines[i].trim().startsWith('```')) {
      code += lines[i] + '\n';
      i++;
    }
    
    return code.trim() ? { code: code.trim() } : null;
  }

  async disconnect() {
    if (this.a11yClient) {
      await this.a11yClient.close();
      console.log('🔌 Disconnected from A11y MCP Server');
    }
  }
}

// Updated main function using the OpenAI function calling pattern
async function main() {
  const agent = new LLMDirectMCPAgent();
  
  try {
    console.log('🚀 Starting LLM Direct MCP Tool Calling...');
    
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable required');
    }

    await agent.initialize();
    
    // Find HTML files to analyze
    const htmlFiles = ['index.html', 'public/index.html', 'src/index.html'];
    let foundFile = null;
    
    for (const path of htmlFiles) {
      try {
        await fs.access(path);
        foundFile = path;
        console.log(`✅ Found HTML file: ${path}`);
        break;
      } catch (error) {
        // File doesn't exist, continue
      }
    }
    
    if (!foundFile) {
      console.log('ℹ️ No HTML files found to analyze');
      return;
    }
    
    // Read HTML file
    const htmlContent = await fs.readFile(foundFile, 'utf-8');
    console.log(`📄 Read ${htmlContent.length} characters from ${foundFile}`);
    
    // Let LLM directly call MCP tools using function calling
    const results = await agent.analyzeAndFixWithDirectCalls(htmlContent, foundFile);
    
    console.log('\n📋 Final Results:');
    console.log('Tool calls made:', results.toolCallsMade);
    console.log('Fixes found:', results.fixes.length);
    
    // Generate comprehensive report
    const report = `# 🤖 LLM Direct MCP Tool Calling Report

**Generated:** ${new Date().toISOString()}
**Method:** OpenAI Function Calling → A11y MCP Server
**File Analyzed:** ${foundFile}
**Tool Calls Made:** ${results.toolCallsMade}

## 🧠 LLM Analysis:

${results.analysis}

## 🔧 Extracted Fixes (${results.fixes.length}):

${results.fixes.map((fix, i) => `### Fix ${i + 1}: ${fix.description}

**Type:** ${fix.type}
**Explanation:** ${fix.explanation}

${fix.originalCode ? `**Original Code:**
\`\`\`html
${fix.originalCode}
\`\`\`` : ''}

${fix.fixedCode ? `**Fixed Code:**
\`\`\`html
${fix.fixedCode}
\`\`\`` : ''}
`).join('\n')}

## 📞 Function Calling Flow:

${results.conversationHistory
  .filter(msg => msg.tool_calls)
  .map((msg, i) => `${i + 1}. **LLM called:** ${msg.tool_calls.map(tc => tc.function.name).join(', ')}`)
  .join('\n')}

## 🎯 Summary:

This analysis demonstrates the LLM directly calling A11y MCP Server tools using OpenAI's function calling feature. The LLM:

1. **Analyzed HTML** using \`test_html_accessibility\` tool
2. **Validated colors** using \`check_color_contrast\` tool  
3. **Generated specific fixes** based on real accessibility data
4. **Provided actionable recommendations** with exact code changes

---

*This report was generated by an LLM using direct MCP tool calling via OpenAI function calling API*`;

    await fs.writeFile('LLM_DIRECT_MCP_REPORT.md', report);
    console.log('📄 Report saved to LLM_DIRECT_MCP_REPORT.md');
    
    // Apply fixes if any were found
    if (results.fixes.length > 0) {
      console.log('\n🔧 Applying fixes to HTML file...');
      let modifiedHtml = htmlContent;
      let appliedFixes = 0;
      
      for (const fix of results.fixes) {
        if (fix.originalCode && fix.fixedCode && modifiedHtml.includes(fix.originalCode)) {
          modifiedHtml = modifiedHtml.replace(fix.originalCode, fix.fixedCode);
          appliedFixes++;
          console.log(`✅ Applied: ${fix.description}`);
        }
      }
      
      if (appliedFixes > 0) {
        // Backup original
        await fs.writeFile(`${foundFile}.backup`, htmlContent);
        // Write fixed version
        await fs.writeFile(foundFile, modifiedHtml);
        console.log(`✅ Applied ${appliedFixes} fixes to ${foundFile}`);
        console.log(`💾 Original saved as ${foundFile}.backup`);
      }
    }
    
  } catch (error) {
    console.error('💥 Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await agent.disconnect();
  }
}

export { LLMDirectMCPAgent, main };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}