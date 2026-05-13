import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, '..');
const cliPath = join(packageRoot, 'bin', 'aicw-visibility.js');
const defaultDataFolder = join(homedir(), '.aicw-visibility-mcp');

const ansiPattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(text: string): string {
  return text.replace(ansiPattern, '');
}

function parseReportPath(output: string): string | undefined {
  const clean = stripAnsi(output);
  const match = clean.match(/Report saved to:\s*(.+)/);
  return match?.[1]?.trim();
}

interface RunVisibilityArgs {
  url: string;
  noBrowser?: boolean;
  dataFolder?: string;
  enableSearchEngineChecks?: boolean;
  timeoutMs?: number;
}

async function runVisibilityCheck(args: RunVisibilityArgs): Promise<{
  output: string;
  reportPath?: string;
  dataFolder: string;
}> {
  const dataFolder = resolve(args.dataFolder || defaultDataFolder);
  await mkdir(dataFolder, { recursive: true });

  const cliArgs = [cliPath, args.url];
  if (args.noBrowser) {
    cliArgs.push('--no-browser');
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AICW_DATA_FOLDER: dataFolder,
  };

  if (typeof args.enableSearchEngineChecks === 'boolean') {
    env.AICW_ENABLE_SEARCH_ENGINE_CHECKS = args.enableSearchEngineChecks ? 'true' : 'false';
  }

  const timeoutMs = args.timeoutMs ?? 10 * 60 * 1000;

  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, cliArgs, {
      cwd: packageRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', code => {
      clearTimeout(timer);
      const output = stripAnsi([stdout, stderr].filter(Boolean).join('\n')).trim();

      if (timedOut) {
        reject(new Error(`AICW Visibility timed out after ${timeoutMs}ms.\n${output}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`AICW Visibility exited with code ${code}.\n${output}`));
        return;
      }

      resolvePromise({
        output,
        reportPath: parseReportPath(output),
        dataFolder,
      });
    });
  });
}

const server = new McpServer({
  name: 'aicw-visibility',
  version: '0.1.0',
});

server.registerTool(
  'check_visibility',
  {
    title: 'Check Website Visibility',
    description: 'Run AICW Visibility for a URL and generate local HTML and JSON reports.',
    inputSchema: {
      url: z.string().min(1).describe('Website URL or domain to check, for example example.com or https://example.com.'),
      noBrowser: z.boolean().optional().describe('Skip Puppeteer JavaScript rendering checks and exclude them from scoring.'),
      dataFolder: z.string().optional().describe('Optional output data folder. Defaults to ~/.aicw-visibility-mcp.'),
      enableSearchEngineChecks: z.boolean().optional().describe('Enable optional Google/Bing/Brave checks. These may be blocked by CAPTCHA.'),
      timeoutMs: z.number().int().positive().optional().describe('Timeout in milliseconds. Defaults to 600000.'),
    },
  },
  async (args) => {
    const result = await runVisibilityCheck(args);
    const lines = [
      result.output,
      '',
      `Data folder: ${result.dataFolder}`,
    ];

    if (result.reportPath) {
      lines.push(`Report path: ${result.reportPath}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n'),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
