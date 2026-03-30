/**
 * Prompt templates for the browser automation agent.
 *
 * Based on Browser Use's proven prompt structure, adapted for OpenCLI's
 * DOM snapshot format ([index]<tag> notation).
 */

import type { DomContext } from './dom-context.js';
import type { ActionResult } from './types.js';

export function buildSystemPrompt(task: string): string {
  return `You are a browser automation agent. You can interact with web pages to complete tasks.

## Input Format

Each step you receive:
1. The current page DOM as an indexed element tree
2. Previous action results (if any)
3. Optionally, a screenshot of the current page

The DOM uses this format:
- \`[N]<tag attributes>text</tag>\` — interactive element with index N
- \`*[N]<tag>\` — element that appeared since the last step
- Indentation shows nesting
- \`|scroll|\` prefix marks scrollable containers

## Available Actions

You must respond with a JSON object containing these fields:
- \`thinking\`: Your reasoning about current state (1-3 sentences)
- \`memory\`: Important facts to remember (optional)
- \`nextGoal\`: What the next action achieves (1 sentence)
- \`actions\`: Array of 1-5 actions to execute

Action types:
- \`{"type": "click", "index": N}\` — Click element [N]
- \`{"type": "type", "index": N, "text": "...", "pressEnter": true}\` — Type into element [N]
- \`{"type": "navigate", "url": "https://..."}\` — Go to URL
- \`{"type": "scroll", "direction": "down", "amount": 500}\` — Scroll page
- \`{"type": "wait", "seconds": 2}\` — Wait for page to update
- \`{"type": "extract", "goal": "..."}\` — Extract information from page
- \`{"type": "go_back"}\` — Go back in history
- \`{"type": "press_key", "key": "Enter"}\` — Press a keyboard key
- \`{"type": "done", "result": "...", "extractedData": ...}\` — Task complete

## Rules

1. Use element indices from the DOM snapshot — they correspond to [N] markers
2. Only interact with elements that exist in the current snapshot
3. After navigation or clicking, the page may change — wait for the new snapshot
4. If stuck in a loop (same actions 3+ times), try a completely different approach
5. If a click doesn't work, try scrolling to reveal the element first
6. Always call "done" when the task is complete — include a result summary
7. If the task cannot be completed, call "done" with success=false and explain why
8. Chain safe actions together (type, scroll) but put page-changing actions last
9. For search: type the query then press Enter or click the search button
10. Close popups, cookie banners, or modals before interacting with page content

## Task

${task}

Respond with valid JSON only. No markdown, no code blocks, just the JSON object.`;
}

export interface StepMessageContent {
  text: string;
  screenshot?: string; // base64
}

export function buildStepMessage(
  domContext: DomContext,
  previousResults: ActionResult[] | null,
  screenshot?: string | null,
): StepMessageContent {
  const parts: string[] = [];

  // Previous results
  if (previousResults && previousResults.length > 0) {
    parts.push('## Previous Action Results\n');
    for (const r of previousResults) {
      const status = r.success ? 'OK' : 'FAILED';
      parts.push(`- ${r.action.type}: ${status}${r.error ? ` (${r.error})` : ''}${r.extractedContent ? `\n  Content: ${r.extractedContent}` : ''}`);
    }
    parts.push('');
  }

  // Current state
  parts.push(`## Current Page State`);
  parts.push(`URL: ${domContext.url}`);
  parts.push(`Title: ${domContext.title}`);
  parts.push(`Viewport: ${domContext.viewport.width}x${domContext.viewport.height}`);
  parts.push(`Scroll: ${domContext.scrollPosition.x}, ${domContext.scrollPosition.y}`);
  parts.push(`Interactive elements: ${domContext.elementMap.size}`);
  parts.push('');

  // DOM snapshot
  parts.push('## DOM Snapshot\n');
  parts.push(domContext.snapshotText);

  return {
    text: parts.join('\n'),
    screenshot: screenshot ?? undefined,
  };
}

export function buildLoopWarning(repeatCount: number): string {
  return `WARNING: You have repeated similar actions ${repeatCount} times. You appear to be stuck in a loop. Try a completely different approach:
- If clicking doesn't work, try using keyboard navigation (Tab, Enter)
- If an element isn't responding, scroll to reveal it fully
- If a page isn't loading, try navigating directly to the URL
- If a popup is blocking, try pressing Escape or clicking outside it
- Consider if the task can be accomplished differently`;
}

export function buildBudgetWarning(step: number, maxSteps: number): string {
  const pct = Math.round((step / maxSteps) * 100);
  return `NOTE: You have used ${pct}% of your step budget (${step}/${maxSteps}). Focus on completing the task efficiently. If it cannot be done, call "done" with an explanation.`;
}
