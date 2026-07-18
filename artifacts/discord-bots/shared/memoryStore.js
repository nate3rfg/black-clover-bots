// Simple rolling conversation memory, keyed by channel id (or any string key).
// Not persisted to disk on purpose - /reset clears it, and a bot restart clears it too.

const MAX_TURNS = 16; // ~8 user/assistant pairs of context

const stores = new Map();

function getHistory(key) {
  if (!stores.has(key)) stores.set(key, []);
  return stores.get(key);
}

function addTurn(key, role, content) {
  const hist = getHistory(key);
  hist.push({ role, content });
  while (hist.length > MAX_TURNS) hist.shift();
}

function reset(key) {
  stores.set(key, []);
}

module.exports = { getHistory, addTurn, reset };
