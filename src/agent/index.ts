/**
 * Agent module — AI-powered browser automation for OpenCLI.
 */

export { AgentLoop } from './agent-loop.js';
export { buildDomContext } from './dom-context.js';
export { LLMClient } from './llm-client.js';
export { ActionExecutor } from './action-executor.js';
export { TraceRecorder } from './trace-recorder.js';
export { discoverApi } from './api-discovery.js';
export { saveTraceAsSkill, saveTraceAsSkillWithValidation } from './skill-saver.js';
export { runAgent, renderAgentResult } from './cli-handler.js';
export type { AgentConfig, AgentResult, AgentAction, AgentResponse } from './types.js';
export type { DomContext, ElementInfo } from './dom-context.js';
export type { RichTrace, CapturedRequest, AuthContext } from './trace-recorder.js';
export type { DiscoveryResult, GoldenAPI } from './api-discovery.js';
