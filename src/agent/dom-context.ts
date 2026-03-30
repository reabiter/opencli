/**
 * DOM Context builder for the AI Agent.
 *
 * Reuses OpenCLI's existing dom-snapshot engine and supplements it with:
 * - Element coordinate maps for native CDP clicking
 * - Accessibility tree data (when CDP is available) for richer element info
 */

import type { IPage } from '../types.js';

export interface ElementInfo {
  index: number;
  tag: string;
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  attributes: Record<string, string>;
  /** Accessibility role (from AX tree, if available) */
  axRole?: string;
  /** Accessibility name (from AX tree, if available) */
  axName?: string;
}

export interface DomContext {
  /** LLM-friendly DOM snapshot text with [index]<tag> notation */
  snapshotText: string;
  /** Map from element index → element info (coordinates, tag, text) */
  elementMap: Map<number, ElementInfo>;
  /** Current page URL */
  url: string;
  /** Page title */
  title: string;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /** Scroll position */
  scrollPosition: { x: number; y: number };
}

/**
 * JS snippet that collects bounding boxes and attributes for all elements
 * annotated with data-opencli-ref by the snapshot engine.
 */
const COLLECT_ELEMENT_INFO_JS = `
(function() {
  var ATTR_WHITELIST = ['type', 'name', 'value', 'placeholder', 'href', 'src', 'alt',
    'role', 'aria-label', 'aria-expanded', 'aria-checked', 'aria-selected',
    'disabled', 'required', 'checked', 'selected', 'readonly', 'contenteditable',
    'data-testid', 'id', 'for', 'action', 'method'];

  var elements = document.querySelectorAll('[data-opencli-ref]');
  var result = [];
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var ref = el.getAttribute('data-opencli-ref');
    if (!ref) continue;
    var idx = parseInt(ref, 10);
    if (isNaN(idx)) continue;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    var attrs = {};
    for (var j = 0; j < ATTR_WHITELIST.length; j++) {
      var attr = ATTR_WHITELIST[j];
      var val = el.getAttribute(attr);
      if (val !== null && val !== '') attrs[attr] = val;
    }
    result.push({
      index: idx,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 80),
      bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      attributes: attrs,
    });
  }
  return {
    elements: result,
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { x: window.scrollX, y: window.scrollY },
  };
})()
`;

/**
 * Build a DomContext from the current page state.
 *
 * 1. Calls page.snapshot() to get the LLM-friendly text (reuses existing engine)
 * 2. Runs a JS snippet to collect element coordinates for native clicking
 * 3. Optionally fetches AX tree via CDP to enrich element info
 */
export async function buildDomContext(page: IPage): Promise<DomContext> {
  // Get LLM-friendly snapshot text from existing engine
  const snapshotRaw = await page.snapshot({ viewportExpand: 800 });
  const snapshotText = typeof snapshotRaw === 'string' ? snapshotRaw : JSON.stringify(snapshotRaw);

  // Collect element coordinates
  const info = await page.evaluate(COLLECT_ELEMENT_INFO_JS) as {
    elements: ElementInfo[];
    url: string;
    title: string;
    viewport: { width: number; height: number };
    scroll: { x: number; y: number };
  } | null;

  const elementMap = new Map<number, ElementInfo>();
  if (info?.elements) {
    for (const el of info.elements) {
      elementMap.set(el.index, el);
    }
  }

  // Enrich with AX tree data if CDP is available
  if (page.cdp) {
    try {
      await enrichWithAccessibilityTree(page, elementMap);
    } catch {
      // AX tree enrichment is optional — CDP may not support it
    }
  }

  return {
    snapshotText,
    elementMap,
    url: info?.url ?? '',
    title: info?.title ?? '',
    viewport: info?.viewport ?? { width: 1280, height: 900 },
    scrollPosition: info?.scroll ?? { x: 0, y: 0 },
  };
}

/**
 * Enrich elements with accessibility info by reading ARIA attributes from DOM.
 *
 * Uses a single batched evaluate() call instead of per-element queries for
 * performance. Reads role, aria-label, and title attributes directly.
 */
async function enrichWithAccessibilityTree(
  page: IPage,
  elementMap: Map<number, ElementInfo>,
): Promise<void> {
  // Collect indices to enrich (cap at 100 elements)
  const indices = [...elementMap.keys()].slice(0, 100);
  if (indices.length === 0) return;

  // Single batched JS call to read ARIA attributes for all elements
  const indicesJson = JSON.stringify(indices);
  const results = await page.evaluate(`
    (function() {
      var indices = ${indicesJson};
      var out = {};
      for (var i = 0; i < indices.length; i++) {
        var el = document.querySelector('[data-opencli-ref="' + indices[i] + '"]');
        if (!el) continue;
        out[indices[i]] = {
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          name: el.getAttribute('aria-label') || el.getAttribute('title') || ''
        };
      }
      return out;
    })()
  `) as Record<string, { role: string; name: string }> | null;

  if (!results) return;

  for (const [idxStr, info] of Object.entries(results)) {
    const el = elementMap.get(Number(idxStr));
    if (el) {
      el.axRole = info.role;
      el.axName = info.name;
    }
  }
}
