/**
 * CLI handler for `opencli operate` command.
 *
 * Bridges the CLI interface to the AgentLoop, handling browser session
 * lifecycle, error formatting, and result rendering.
 */

import chalk from 'chalk';
import { browserSession } from '../runtime.js';
import { ConfigError } from '../errors.js';
import { AgentLoop } from './agent-loop.js';
import { saveTraceAsSkillWithValidation } from './skill-saver.js';
import type { AgentConfig, AgentResult } from './types.js';

export interface RunAgentOptions extends AgentConfig {
  BrowserFactory: new () => any;
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  // Validate API key
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ConfigError(
      'ANTHROPIC_API_KEY environment variable is required for opencli operate',
      'Set it with: export ANTHROPIC_API_KEY=sk-ant-...',
    );
  }

  const workspace = opts.workspace ?? `operate:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const result = await browserSession(opts.BrowserFactory, async (page) => {
    const agent = new AgentLoop(page, {
      ...opts,
      workspace,
    });

    const agentResult = await agent.run();

    // Save as skill if requested and successful (must happen inside browserSession
    // so the page is still available for validation)
    if (opts.saveAs && agentResult.success && agentResult.trace) {
      try {
        const saved = await saveTraceAsSkillWithValidation(agentResult.trace, opts.saveAs, agent.getLLMClient());
        if (opts.verbose) {
          console.log(chalk.green(`  Skill saved: ${saved.path}`));
          console.log(chalk.dim(`  Run with: opencli ${saved.command}`));
        }
      } catch (err) {
        console.error(chalk.yellow(`  Warning: Failed to save skill: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    return agentResult;
  }, { workspace });

  return result;
}

export function renderAgentResult(result: AgentResult): string {
  const lines: string[] = [];

  // Status line
  if (result.success) {
    lines.push(chalk.green('✓ Task completed successfully'));
  } else if (result.status === 'max_steps') {
    lines.push(chalk.yellow('⚠ Task incomplete — reached step limit'));
  } else {
    lines.push(chalk.red('✗ Task failed'));
  }

  // Result
  if (result.result) {
    lines.push('');
    lines.push(result.result);
  }

  // Extracted data
  if (result.extractedData !== undefined) {
    lines.push('');
    lines.push(chalk.dim('Extracted data:'));
    lines.push(typeof result.extractedData === 'string'
      ? result.extractedData
      : JSON.stringify(result.extractedData, null, 2));
  }

  // Stats
  lines.push('');
  lines.push(chalk.dim([
    `Steps: ${result.stepsCompleted}`,
    `Tokens: ${result.tokenUsage.input}in/${result.tokenUsage.output}out`,
    `Cost: ~$${result.tokenUsage.estimatedCost.toFixed(4)}`,
  ].join(' | ')));

  return lines.join('\n');
}
