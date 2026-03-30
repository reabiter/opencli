/**
 * Trace Recorder — captures agent action traces for skill sedimentation.
 *
 * Records each successful action with durable CSS selectors (instead of
 * volatile element indices) so the trace can be replayed without an LLM.
 */

import type { DomContext, ElementInfo } from './dom-context.js';
import type { AgentResponse, ActionResult, AgentAction } from './types.js';

export interface TraceStep {
  stepNumber: number;
  url: string;
  action: AgentAction;
  /** Durable CSS selector for the target element (if applicable) */
  selector?: string;
  /** Text content of the target element (for resilient selection) */
  elementText?: string;
  /** Content extracted by the action (if any) */
  extractedContent?: string;
  timestamp: number;
}

export interface ActionTrace {
  task: string;
  startUrl?: string;
  steps: TraceStep[];
  result?: string;
  extractedData?: unknown;
  duration: number;
  recordedAt: string;
}

export class TraceRecorder {
  private steps: TraceStep[] = [];
  private startTime = Date.now();

  recordStep(
    stepNumber: number,
    domContext: DomContext,
    response: AgentResponse,
    results: ActionResult[],
  ): void {
    for (let i = 0; i < response.actions.length; i++) {
      const action = response.actions[i];
      const result = results[i];

      // Skip failed actions and done actions
      if (!result?.success || action.type === 'done') continue;

      const traceStep: TraceStep = {
        stepNumber,
        url: domContext.url,
        action,
        timestamp: Date.now(),
      };

      // Resolve durable selector for element-targeting actions
      if ('index' in action && typeof action.index === 'number') {
        const el = domContext.elementMap.get(action.index);
        if (el) {
          traceStep.selector = buildDurableSelector(el);
          traceStep.elementText = el.text.slice(0, 50);
        }
      }

      if (result.extractedContent) {
        traceStep.extractedContent = result.extractedContent;
      }

      this.steps.push(traceStep);
    }
  }

  finalize(
    task: string,
    startUrl?: string,
    result?: string,
    extractedData?: unknown,
  ): ActionTrace {
    return {
      task,
      startUrl,
      steps: this.steps,
      result,
      extractedData,
      duration: Date.now() - this.startTime,
      recordedAt: new Date().toISOString(),
    };
  }
}

/**
 * Build a durable CSS selector for an element, prioritizing stable attributes.
 *
 * Priority chain:
 * 1. data-testid → most stable
 * 2. id → usually stable
 * 3. aria-label → accessible and meaningful
 * 4. Structural path (tag + nth-of-type) → fallback
 */
function buildDurableSelector(el: ElementInfo): string {
  const attrs = el.attributes;

  // 1. data-testid
  if (attrs['data-testid']) {
    return `[data-testid="${escapeCSS(attrs['data-testid'])}"]`;
  }

  // 2. id
  if (attrs['id']) {
    return `#${escapeCSS(attrs['id'])}`;
  }

  // 3. name attribute (for form elements)
  if (attrs['name'] && ['input', 'select', 'textarea'].includes(el.tag)) {
    return `${el.tag}[name="${escapeCSS(attrs['name'])}"]`;
  }

  // 4. aria-label
  if (attrs['aria-label']) {
    return `${el.tag}[aria-label="${escapeCSS(attrs['aria-label'])}"]`;
  }

  // 5. role + text content
  if (attrs['role'] && el.text) {
    return `${el.tag}[role="${attrs['role']}"]`;
  }

  // 6. Placeholder (for inputs)
  if (attrs['placeholder']) {
    return `${el.tag}[placeholder="${escapeCSS(attrs['placeholder'])}"]`;
  }

  // 7. href (for links)
  if (el.tag === 'a' && attrs['href']) {
    const href = attrs['href'];
    // Only use short hrefs as selectors
    if (href.length < 100) {
      return `a[href="${escapeCSS(href)}"]`;
    }
  }

  // 8. Type attribute + tag
  if (attrs['type']) {
    return `${el.tag}[type="${attrs['type']}"]`;
  }

  // 9. Fallback: just the tag name (will match first)
  return el.tag;
}

function escapeCSS(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
