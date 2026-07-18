const { Client, GatewayIntentBits, Partials, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { chat, extractText } = require('./aiClient');
const memory = require('./memoryStore');

/**
 * @param {Object} cfg
 * @param {string} cfg.name - display name, used in logs
 * @param {string} cfg.token - bot token
 * @param {string} cfg.clientId - bot application id
 * @param {string} cfg.channelId - the ONLY channel this bot will talk in
 * @param {string} cfg.persona - system prompt describing how the bot should act
 */
function createPersonaBot(cfg) {
  const { name, token, clientId, channelId, persona } = cfg;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  const commands = [
    new SlashCommandBuilder()
      .setName('reset')
      .setDescription(`Reset ${name}'s conversation memory`),
  ].map((c) => c.toJSON());

  client.once(Events.ClientReady, () => {
    console.log(`[${name}] logged in as ${client.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'reset') {
      memory.reset(channelId);
      await interaction.reply({ content: `${name}'s memory has been reset.`, ephemeral: true });
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author.bot) return;
      if (message.channelId !== channelId) return;

      await message.channel.sendTyping();

      memory.addTurn(channelId, 'user', `${message.member?.displayName || message.author.username}: ${message.content}`);

      const res = await chat({
        system: persona,
        messages: memory.getHistory(channelId),
        maxTokens: 300,
      });

      const text = extractText(res) || "...";
      memory.addTurn(channelId, 'assistant', text);

      // Discord hard-caps messages at 2000 chars
      await message.reply(text.slice(0, 2000));
    } catch (err) {
      console.error(`[${name}] error handling message:`, err);
    }
  });

  async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(token);
    const guildId = process.env.GUILD_ID;
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
    }
  }

  async function start() {
    await registerCommands();
    await client.login(token);
  }

  return { client, commands, start, registerCommands };
}

module.exports = { createPersonaBot };
