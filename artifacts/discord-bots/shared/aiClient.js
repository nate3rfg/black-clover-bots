const OpenAI = require('openai');

// Groq — free tier, high rate limits, OpenAI-compatible API
const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const MODEL = process.env.AI_MODEL || 'llama-3.1-8b-instant';

/**
 * Send a chat completion request to Groq.
 * @param {Object} opts
 * @param {string} opts.system     - system prompt (persona / instructions)
 * @param {Array}  opts.messages   - [{role:'user'|'assistant', content:string}]
 * @param {Array}  [opts.tools]    - optional tool definitions (Anthropic input_schema shape)
 * @param {number} [opts.maxTokens]
 * @param {number} [opts._attempt] - internal retry counter
 */
async function chat({ system, messages, tools, maxTokens = 500, _attempt = 0 }) {
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
    params.tool_choice = 'auto';
  }

  try {
    return await client.chat.completions.create(params);
  } catch (err) {
    // Retry on rate limit (429) up to 3 times with backoff
    if (err.status === 429 && _attempt < 3) {
      const retryAfter = parseFloat(err.headers?.['retry-after'] || 0);
      const delay = Math.min((retryAfter * 1000) || Math.pow(2, _attempt) * 1500, 8000);
      console.log(`[aiClient] Rate limited — retrying in ${Math.round(delay / 1000)}s (attempt ${_attempt + 1}/3)`);
      await new Promise((r) => setTimeout(r, delay));
      return chat({ system, messages, tools, maxTokens, _attempt: _attempt + 1 });
    }
    throw err;
  }
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
