require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
} = require('discord.js');
const { chat, extractText, extractToolUses } = require('../shared/aiClient');
const memory = require('../shared/memoryStore');

const NAME = 'Klaus';
const TOKEN = process.env.KLAUS_BOT_TOKEN;
const CLIENT_ID = process.env.KLAUS_CLIENT_ID;

const persona = `You are role-playing as Klaus Lunettes, a character from Black Clover, chatting in a Discord server.

Personality to embody:
- Serious, rule-abiding, formal, and a bit uptight. You care a lot about tradition, order, and doing things "properly."
- You often reference rules, precedent, or the "right way" to do things, and you get exasperated by recklessness or rule-breaking.
- Despite the stiffness, you're genuinely helpful and dependable - if someone needs something done, you'll get it done correctly.
- You occasionally reference your noble house or the importance of order and discipline.

Writing style rules (important):
- Talk like you're actually texting in a Discord chat, not narrating.
- Use LIGHT punctuation, but you can be a bit more formal in word choice than the other characters. Avoid heavy comma chains and semicolons though.
- Keep replies reasonably short and to the point.
- No stage directions or asterisk actions. Just talk.
- Stay in character at all times. Never mention that you are an AI or a bot.

Special ability:
- You have the power to create new channels in the server when a member asks you to (e.g. "create a channel called strategy-room"). Use the create_channel tool when someone clearly asks you to make/create a channel. Infer a reasonable channel type (text, voice, or category) from context; default to text.
- Only use the tool when the request is actually asking you to create a channel. For normal conversation, just reply in character with no tool use.
- After the tool result comes back, confirm what you did in character (e.g. acknowledge it's been handled, properly, as it should be).`;

const createChannelTool = {
  name: 'create_channel',
  description: 'Create a new channel in the current Discord server.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the channel to create (Discord will lowercase/hyphenate text channel names automatically).' },
      type: {
        type: 'string',
        enum: ['text', 'voice', 'category'],
        description: 'Type of channel to create.',
      },
      parent_category_name: {
        type: 'string',
        description: 'Optional: name of an existing category to nest the new channel under, if mentioned.',
      },
    },
    required: ['name', 'type'],
  },
};

function channelTypeFor(type) {
  if (type === 'voice') return ChannelType.GuildVoice;
  if (type === 'category') return ChannelType.GuildCategory;
  return ChannelType.GuildText;
}

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
    .setDescription("Reset Klaus's conversation memory"),
].map((c) => c.toJSON());

client.once(Events.ClientReady, () => {
  console.log(`[${NAME}] logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'reset') {
    memory.reset(`klaus:${interaction.channelId}`);
    await interaction.reply({ content: "Klaus's memory has been reset.", ephemeral: true });
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    if (!client.user || !message.mentions.has(client.user)) return;

    await message.channel.sendTyping();

    const memKey = `klaus:${message.channelId}`;
    const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();
    memory.addTurn(memKey, 'user', `${message.member?.displayName || message.author.username}: ${cleanContent}`);

    let res = await chat({
      system: persona,
      messages: memory.getHistory(memKey),
      tools: [createChannelTool],
      maxTokens: 400,
    });

    const toolUses = extractToolUses(res);

    if (toolUses.length > 0 && message.guild) {
      const toolResults = [];
      for (const tu of toolUses) {
        const { name, type, parent_category_name: parentName } = tu.input;
        let resultText;
        try {
          let parent;
          if (parentName) {
            parent = message.guild.channels.cache.find(
              (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === parentName.toLowerCase()
            );
          }
          const created = await message.guild.channels.create({
            name,
            type: channelTypeFor(type),
            parent: parent ? parent.id : undefined,
          });
          resultText = `Created channel "${created.name}" (${type}), id ${created.id}.`;
        } catch (err) {
          resultText = `Failed to create channel: ${err.message}`;
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: resultText,
        });
      }

      // feed the tool result back so Klaus can respond in character
      const followupMessages = [
        ...memory.getHistory(memKey),
        { role: 'assistant', content: res.content },
        { role: 'user', content: toolResults },
      ];

      res = await chat({
        system: persona,
        messages: followupMessages,
        maxTokens: 300,
      });
    }

    const text = extractText(res) || 'It has been handled.';
    memory.addTurn(memKey, 'assistant', text);
    await message.reply(text.slice(0, 2000));
  } catch (err) {
    console.error(`[${NAME}] error handling message:`, err);
  }
});

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const guildId = process.env.GUILD_ID;
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands });
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  }
}

async function start() {
  await registerCommands();
  await client.login(TOKEN);
}

module.exports = { client, commands, start, registerCommands };

if (require.main === module) {
  start().catch((err) => console.error(`[${NAME}] failed to start:`, err));
}
