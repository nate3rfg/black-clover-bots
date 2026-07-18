const OpenAI = require('openai');

// Uses Google Gemini via its OpenAI-compatible endpoint — no Anthropic key needed.
const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

const MODEL = process.env.AI_MODEL || 'gemini-2.0-flash';

/**
 * Send a chat completion request to Gemini (OpenAI-compatible format).
 * @param {Object} opts
 * @param {string} opts.system     - system prompt (persona / instructions)
 * @param {Array}  opts.messages   - [{role:'user'|'assistant', content:string}]
 * @param {Array}  [opts.tools]    - optional tool definitions (Anthropic input_schema shape)
 * @param {number} [opts.maxTokens]
 */
async function chat({ system, messages, tools, maxTokens = 500 }) {
  const systemMsg = system ? [{ role: 'system', content: system }] : [];

  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [...systemMsg, ...messages],
  };

  if (tools && tools.length) {
    // Convert Anthropic-style tool defs (input_schema) to OpenAI style (parameters)
    params.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  return client.chat.completions.create(params);
}

/** Pull the text content out of an OpenAI-compatible response */
function extractText(res) {
  return res.choices?.[0]?.message?.content?.trim() || '';
}

/** Pull function/tool call blocks out of an OpenAI-compatible response */
function extractToolUses(res) {
  return res.choices?.[0]?.message?.tool_calls?.filter((tc) => tc.type === 'function') || [];
}

module.exports = { chat, extractText, extractToolUses, MODEL };
