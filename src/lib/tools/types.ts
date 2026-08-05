// Tool-calling protocol types — OpenAI-compatible.

// A JSON Schema fragment describing a tool's parameters. Intentionally
// permissive (OpenAI's tool spec allows arbitrary JSON Schema here) — the
// `provide_verdict` channel reuses a full engine schema, nested objects and
// all, as a tool's parameters.
export interface ToolParameterSchema {
  type?: string
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  items?: unknown
  enum?: unknown[]
  description?: string
  [key: string]: unknown
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ToolParameterSchema
  }
}

export interface ToolCallFunction {
  name: string
  arguments: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: ToolCallFunction
}

export interface ChatCompletionWithToolsResult {
  content: string
  tool_calls?: ToolCall[]
}

export interface ToolHandlerContext {
  signal?: AbortSignal
}
