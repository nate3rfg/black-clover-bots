const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'battle-stats.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function recordResult(winnerId, loserId) {
  const data = load();
  data[winnerId] = data[winnerId] || { wins: 0, losses: 0 };
  data[loserId] = data[loserId] || { wins: 0, losses: 0 };
  data[winnerId].wins += 1;
  data[loserId].losses += 1;
  save(data);
}

function getStats(userId) {
  const data = load();
  return data[userId] || { wins: 0, losses: 0 };
}

function getLeaderboard(limit = 10) {
  const data = load();
  return Object.entries(data)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
    .slice(0, limit);
}

function resetAll() {
  save({});
}

module.exports = { recordResult, getStats, getLeaderboard, resetAll };
