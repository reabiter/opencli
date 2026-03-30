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
import { saveTraceAsSkill } from './skill-saver.js';
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

  const workspace = opts.workspace ?? `operate:${Date.now()}`;

  const result = await browserSession(opts.BrowserFactory, async (page) => {
    const agent = new AgentLoop(page, {
      ...opts,
      workspace,
    });

    return agent.run();
  }, { workspace });

  // Save as skill if requested and successful
  if (opts.saveAs && result.success && result.trace) {
    try {
      const saved = await saveTraceAsSkill(result.trace, opts.saveAs);
      if (opts.verbose) {
        console.log(chalk.green(`  Skill saved: ${saved.path}`));
        console.log(chalk.dim(`  Run with: opencli ${saved.command}`));
      }
    } catch (err) {
      console.error(chalk.yellow(`  Warning: Failed to save skill: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

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
