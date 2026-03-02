import type { PromptTemplateVars } from '../types/agent.js';

/**
 * Known template variable names that can be substituted.
 * Any `{{varName}}` where `varName` is not in this set is left as-is.
 */
const KNOWN_VARS = new Set<string>(['date', 'iteration', 'lastResult', 'agentId']);

/**
 * Render a prompt template by substituting `{{varName}}` placeholders with
 * values from the provided variables object.
 *
 * - Supports: `{{date}}`, `{{iteration}}`, `{{lastResult}}`, `{{agentId}}`
 * - Unknown variables (e.g. `{{foo}}`) are left as-is in the output.
 * - Optional variables that are `undefined` are replaced with an empty string.
 * - Whitespace inside braces is tolerated: `{{ date }}` works the same as `{{date}}`.
 */
export function renderPromptTemplate(template: string, vars: PromptTemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, varName: string) => {
    if (!KNOWN_VARS.has(varName)) {
      return match;
    }

    const value = resolveVar(varName, vars);
    return value ?? '';
  });
}

function resolveVar(name: string, vars: PromptTemplateVars): string | undefined {
  switch (name) {
    case 'date':
      return vars.date;
    case 'iteration':
      return String(vars.iteration);
    case 'lastResult':
      return vars.lastResult;
    case 'agentId':
      return vars.agentId;
    default:
      return undefined;
  }
}
