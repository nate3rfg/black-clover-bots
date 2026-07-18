require('dotenv').config();
const { REST, Routes } = require('discord.js');

const roast = require('./bots/roastBattleBot');
const asta = require('./bots/astaBot');
const noelle = require('./bots/noelleBot');
const zora = require('./bots/zoraBot');
const klaus = require('./bots/klausBot');
const nero = require('./bots/neroBot');

const guildId = process.env.GUILD_ID;

const targets = [
  { name: 'RoastBattle', token: process.env.ROAST_BOT_TOKEN, clientId: process.env.ROAST_CLIENT_ID, commands: roast.commands },
  { name: 'Asta', token: process.env.ASTA_BOT_TOKEN, clientId: process.env.ASTA_CLIENT_ID, commands: asta.commands },
  { name: 'Noelle', token: process.env.NOELLE_BOT_TOKEN, clientId: process.env.NOELLE_CLIENT_ID, commands: noelle.commands },
  { name: 'Zora', token: process.env.ZORA_BOT_TOKEN, clientId: process.env.ZORA_CLIENT_ID, commands: zora.commands },
  { name: 'Klaus', token: process.env.KLAUS_BOT_TOKEN, clientId: process.env.KLAUS_CLIENT_ID, commands: klaus.commands },
  { name: 'Nero', token: process.env.NERO_BOT_TOKEN, clientId: process.env.NERO_CLIENT_ID, commands: nero.commands },
];

async function main() {
  for (const t of targets) {
    try {
      const rest = new REST({ version: '10' }).setToken(t.token);
      if (guildId) {
        await rest.put(Routes.applicationGuildCommands(t.clientId, guildId), { body: t.commands });
      } else {
        await rest.put(Routes.applicationCommands(t.clientId), { body: t.commands });
      }
      console.log(`✅ Registered commands for ${t.name}`);
    } catch (err) {
      console.error(`❌ Failed to register commands for ${t.name}:`, err.message);
    }
  }
  process.exit(0);
}

main();
