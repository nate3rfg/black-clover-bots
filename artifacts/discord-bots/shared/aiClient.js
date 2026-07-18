const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-5';

/**
 * Send a chat completion request to Claude.
 * @param {Object} opts
 * @param {string} opts.system - system prompt (persona / instructions)
 * @param {Array}  opts.messages - [{role: 'user'|'assistant', content: string}]
 * @param {Array}  [opts.tools] - optional tool definitions
 * @param {number} [opts.maxTokens]
 */
async function chat({ system, messages, tools, maxTokens = 500 }) {
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
  };
  if (tools && tools.length) params.tools = tools;

  return anthropic.messages.create(params);
}

/** Pull the plain-text portions out of a Claude response */
function extractText(res) {
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Pull tool_use blocks out of a Claude response */
function extractToolUses(res) {
  return res.content.filter((b) => b.type === 'tool_use');
}

module.exports = { chat, extractText, extractToolUses, MODEL };
