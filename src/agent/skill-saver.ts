/**
 * Skill Saver — converts an action trace into a reusable YAML CLI command.
 *
 * The generated YAML uses OpenCLI's existing pipeline system (executePipeline),
 * so saved skills run deterministically without any LLM involvement.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { ActionTrace, TraceStep } from './trace-recorder.js';

interface SavedSkill {
  path: string;
  command: string;
}

/**
 * Convert an action trace into a YAML CLI skill file.
 *
 * @param trace - The recorded action trace
 * @param name - Skill name in "site/command" format (e.g., "flights/search")
 */
export async function saveTraceAsSkill(
  trace: ActionTrace,
  name: string,
): Promise<SavedSkill> {
  // Parse and validate name
  const parts = name.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid skill name "${name}" — must be "site/command" format (e.g., "flights/search")`);
  }
  const [site, command] = parts;

  // Convert trace steps to pipeline YAML
  const pipeline = convertTraceToPipeline(trace);

  // Detect arguments (text that looks like user input)
  const args = detectArguments(trace);

  // Build YAML content
  const yaml = buildYaml({
    site,
    command,
    description: trace.task,
    domain: extractDomain(trace.startUrl),
    args,
    pipeline,
  });

  // Write to ~/.opencli/clis/<site>/<command>.yaml
  const cliDir = join(homedir(), '.opencli', 'clis', site);
  mkdirSync(cliDir, { recursive: true });
  const filePath = join(cliDir, `${command}.yaml`);
  writeFileSync(filePath, yaml, 'utf-8');

  // Also save raw trace as JSON for debugging
  const traceDir = join(homedir(), '.opencli', 'traces');
  mkdirSync(traceDir, { recursive: true });
  const tracePath = join(traceDir, `${site}-${command}-${Date.now()}.json`);
  writeFileSync(tracePath, JSON.stringify(trace, null, 2), 'utf-8');

  return {
    path: filePath,
    command: `${site} ${command}`,
  };
}

interface PipelineStep {
  action: string;
  [key: string]: unknown;
}

function convertTraceToPipeline(trace: ActionTrace): PipelineStep[] {
  const steps: PipelineStep[] = [];

  // Add initial navigation if there's a start URL
  if (trace.startUrl) {
    steps.push({ action: 'navigate', url: trace.startUrl });
    steps.push({ action: 'wait', time: 2 });
  }

  for (const step of trace.steps) {
    const pipelineStep = convertStep(step);
    if (pipelineStep) {
      steps.push(pipelineStep);
    }
  }

  return steps;
}

function convertStep(step: TraceStep): PipelineStep | null {
  const action = step.action;

  switch (action.type) {
    case 'click': {
      if (!step.selector) return null;
      const sel = JSON.stringify(step.selector);
      return {
        action: 'evaluate',
        code: `document.querySelector(${sel})?.click()`,
      };
    }

    case 'type': {
      if (!step.selector) return null;
      const typeSel = JSON.stringify(step.selector);
      const text = action.text;
      return {
        action: 'evaluate',
        code: `(function() { var el = document.querySelector(${typeSel}); if (el) { el.focus(); el.value = ''; el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); } })()`,
      };
    }

    case 'navigate':
      return { action: 'navigate', url: action.url };

    case 'scroll':
      return {
        action: 'evaluate',
        code: `window.scrollBy(0, ${action.direction === 'up' ? -500 : 500})`,
      };

    case 'wait':
      return { action: 'wait', time: action.seconds ?? 2 };

    case 'press_key':
      return {
        action: 'evaluate',
        code: `document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(action.key)}, bubbles: true}))`,
      };

    case 'go_back':
      return { action: 'evaluate', code: 'history.back()' };

    case 'extract':
      return {
        action: 'evaluate',
        code: 'document.body.innerText.slice(0, 5000)',
        variable: 'extracted',
      };

    default:
      return null;
  }
}

function detectArguments(trace: ActionTrace): Array<{ name: string; type: string; positional: boolean; help: string }> {
  // Look for type actions that might contain user-varying input
  const typeSteps = trace.steps.filter(s => s.action.type === 'type');

  // If there are type actions, the first one is likely a search/query argument
  if (typeSteps.length > 0) {
    return [{
      name: 'query',
      type: 'string',
      positional: true,
      help: 'Search query or input text',
    }];
  }

  return [];
}

interface YamlConfig {
  site: string;
  command: string;
  description: string;
  domain?: string;
  args: Array<{ name: string; type: string; positional: boolean; help: string }>;
  pipeline: PipelineStep[];
}

function buildYaml(config: YamlConfig): string {
  const lines: string[] = [];

  lines.push(`# Auto-generated by opencli operate --save-as`);
  lines.push(`# Task: ${config.description}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`site: ${config.site}`);
  lines.push(`name: ${config.command}`);
  lines.push(`description: "${escapeYaml(config.description)}"`);
  if (config.domain) {
    lines.push(`domain: ${config.domain}`);
  }
  lines.push(`strategy: ui`);
  lines.push(`browser: true`);

  if (config.args.length > 0) {
    lines.push('args:');
    for (const arg of config.args) {
      lines.push(`  - name: ${arg.name}`);
      lines.push(`    type: ${arg.type}`);
      if (arg.positional) lines.push(`    positional: true`);
      if (arg.help) lines.push(`    help: "${escapeYaml(arg.help)}"`);
    }
  }

  lines.push('pipeline:');
  for (const step of config.pipeline) {
    lines.push(`  - action: ${step.action}`);
    for (const [key, value] of Object.entries(step)) {
      if (key === 'action') continue;
      if (typeof value === 'string') {
        lines.push(`    ${key}: "${escapeYaml(value)}"`);
      } else if (typeof value === 'number') {
        lines.push(`    ${key}: ${value}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

function extractDomain(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function escapeYaml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
