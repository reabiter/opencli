/**
 * Action Executor — dispatches parsed LLM actions to the browser via IPage.
 *
 * Prioritizes native CDP Input events (nativeClick/nativeType) when available,
 * falls back to JS injection (page.click/page.typeText) for compatibility.
 */

import type { IPage } from '../types.js';
import type { AgentAction, ActionResult } from './types.js';
import type { ElementInfo } from './dom-context.js';

export class ActionExecutor {
  constructor(private page: IPage) {}

  async execute(
    action: AgentAction,
    elementMap: Map<number, ElementInfo>,
  ): Promise<ActionResult> {
    try {
      switch (action.type) {
        case 'click':
          return await this.executeClick(action, elementMap);
        case 'type':
          return await this.executeType(action, elementMap);
        case 'navigate':
          return await this.executeNavigate(action);
        case 'scroll':
          return await this.executeScroll(action);
        case 'wait':
          return await this.executeWait(action);
        case 'extract':
          return await this.executeExtract(action);
        case 'go_back':
          return await this.executeGoBack();
        case 'press_key':
          return await this.executePressKey(action);
        case 'done':
          return { action, success: true, extractedContent: action.result };
        default:
          return { action, success: false, error: `Unknown action type: ${(action as AgentAction).type}` };
      }
    } catch (err) {
      return {
        action,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeClick(
    action: Extract<AgentAction, { type: 'click' }>,
    elementMap: Map<number, ElementInfo>,
  ): Promise<ActionResult> {
    const el = elementMap.get(action.index);
    if (!el) {
      return { action, success: false, error: `Element [${action.index}] not found in current snapshot` };
    }

    // Try native CDP click, fallback to JS injection
    await this.clickElement(action.index, el);

    // Brief wait for page to react
    await this.page.wait(0.5);
    return { action, success: true };
  }

  /** Click an element: try native CDP, fallback to JS injection */
  private async clickElement(index: number, el: ElementInfo): Promise<void> {
    if (this.page.nativeClick) {
      try {
        await this.page.nativeClick(el.center.x, el.center.y);
        return;
      } catch {
        // CDP click failed (extension not updated?) — fallback to JS
      }
    }
    await this.page.click(String(index));
  }

  /** Type into an element: try native CDP, fallback to JS injection */
  private async typeIntoElement(index: number, text: string): Promise<void> {
    if (this.page.nativeType) {
      try {
        await this.page.nativeType(text);
        return;
      } catch {
        // CDP type failed — fallback to JS
      }
    }
    await this.page.typeText(String(index), text);
  }

  private async executeType(
    action: Extract<AgentAction, { type: 'type' }>,
    elementMap: Map<number, ElementInfo>,
  ): Promise<ActionResult> {
    const el = elementMap.get(action.index);
    if (!el) {
      return { action, success: false, error: `Element [${action.index}] not found in current snapshot` };
    }

    // Click to focus the element first
    await this.clickElement(action.index, el);
    await this.page.wait(0.2);

    // Clear existing content
    await this.page.pressKey('Control+a');
    await this.page.wait(0.1);

    // Type the text
    await this.typeIntoElement(action.index, action.text);

    // Optionally press Enter
    if (action.pressEnter) {
      await this.page.wait(0.2);
      if (this.page.nativeKeyPress) {
        await this.page.nativeKeyPress('Enter');
      } else {
        await this.page.pressKey('Enter');
      }
    }

    return { action, success: true };
  }

  private async executeNavigate(
    action: Extract<AgentAction, { type: 'navigate' }>,
  ): Promise<ActionResult> {
    await this.page.goto(action.url);
    await this.page.wait(2);
    return { action, success: true };
  }

  private async executeScroll(
    action: Extract<AgentAction, { type: 'scroll' }>,
  ): Promise<ActionResult> {
    const amount = action.amount ?? 500;
    await this.page.scroll(action.direction, amount);
    await this.page.wait(0.5);
    return { action, success: true };
  }

  private async executeWait(
    action: Extract<AgentAction, { type: 'wait' }>,
  ): Promise<ActionResult> {
    const seconds = action.seconds ?? 2;
    await this.page.wait(seconds);
    return { action, success: true };
  }

  private async executeExtract(
    action: Extract<AgentAction, { type: 'extract' }>,
  ): Promise<ActionResult> {
    // Use page.evaluate to extract text content
    const content = await this.page.evaluate(`
      (function() {
        var body = document.body;
        if (!body) return '';
        // Get visible text, truncated
        return body.innerText.slice(0, 5000);
      })()
    `) as string;

    return {
      action,
      success: true,
      extractedContent: content || '(empty page)',
    };
  }

  private async executeGoBack(): Promise<ActionResult> {
    await this.page.evaluate('history.back()');
    await this.page.wait(2);
    return { action: { type: 'go_back' }, success: true };
  }

  private async executePressKey(
    action: Extract<AgentAction, { type: 'press_key' }>,
  ): Promise<ActionResult> {
    if (this.page.nativeKeyPress) {
      await this.page.nativeKeyPress(action.key);
    } else {
      await this.page.pressKey(action.key);
    }
    await this.page.wait(0.5);
    return { action, success: true };
  }
}
