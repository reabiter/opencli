/**
 * Agent module — AI-powered browser automation for OpenCLI.
 */

export { AgentLoop } from './agent-loop.js';
export { buildDomContext } from './dom-context.js';
export { LLMClient } from './llm-client.js';
export { ActionExecutor } from './action-executor.js';
export { TraceRecorder } from './trace-recorder.js';
export { saveTraceAsSkill } from './skill-saver.js';
export { runAgent, renderAgentResult } from './cli-handler.js';
export type { AgentConfig, AgentResult, AgentAction, AgentResponse } from './types.js';
export type { DomContext, ElementInfo } from './dom-context.js';
export type { ActionTrace } from './trace-recorder.js';
