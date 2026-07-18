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
const OWNER_ID = process.env.OWNER_ID; // Only this user can trigger powerful tools

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

Special abilities — you have real tools to take action in this server:
- create_channel: create a new text, voice, or category channel when asked.
- change_nickname: change a server member's nickname when asked. User mentions in Discord look like <@123456789> — extract the numeric ID from those.
- Only use tools when someone is clearly requesting that action. For normal conversation, just talk.
- After a tool succeeds, confirm in character. If it fails (e.g. missing permissions), acknowledge that you were unable to carry it out.`;

const tools = [
  {
    name: 'create_channel',
    description: 'Create a new channel in the current Discord server.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the channel to create.' },
        type: {
          type: 'string',
          enum: ['text', 'voice', 'category'],
          description: 'Type of channel to create.',
        },
        parent_category_name: {
          type: 'string',
          description: 'Optional: name of an existing category to nest the new channel under.',
        },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'change_nickname',
    description: "Change a server member's nickname. Extract the numeric user ID from a Discord mention like <@123456789>.",
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'The Discord user ID (numeric) of the member to rename.' },
        new_nickname: { type: 'string', description: 'The new nickname to set. Pass an empty string "" to reset to their username.' },
      },
      required: ['user_id', 'new_nickname'],
    },
  },
];

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

    // Quick ID lookup — bypass AI entirely
    const rawText = message.content.replace(/<@!?\d+>/g, '').trim().toLowerCase();
    if (rawText.includes('my id') || rawText.includes('what is my discord id') || rawText.includes('what\'s my id')) {
      await message.reply(`Your Discord user ID is: \`${message.author.id}\``);
      return;
    }

    await message.channel.sendTyping();

    const memKey = `klaus:${message.channelId}`;
    const cleanContent = message.content.replace(/<@!?\d+>/g, (match) => {
      // Keep mentions as-is so Klaus can extract user IDs from them
      return match;
    }).trim();

    const isOwner = message.author.id === OWNER_ID;

    memory.addTurn(memKey, 'user', `${message.member?.displayName || message.author.username}: ${message.content}`);

    // Only the owner gets access to powerful tools (channel creation, nickname changes)
    let res = await chat({
      system: persona,
      messages: memory.getHistory(memKey),
      tools: isOwner ? tools : undefined,
      maxTokens: 400,
    });

    const toolUses = extractToolUses(res);

    if (toolUses.length > 0 && message.guild) {
      const toolResultMessages = [];

      for (const tu of toolUses) {
        const args = JSON.parse(tu.function.arguments);
        let resultText;

        if (tu.function.name === 'create_channel') {
          const { name, type, parent_category_name: parentName } = args;
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

        } else if (tu.function.name === 'change_nickname') {
          const { user_id, new_nickname } = args;
          try {
            const member = await message.guild.members.fetch(user_id);
            await member.setNickname(new_nickname || null);
            const display = new_nickname ? `"${new_nickname}"` : 'their original username';
            resultText = `Changed nickname of ${member.user.username} to ${display}.`;
          } catch (err) {
            resultText = `Failed to change nickname: ${err.message}`;
          }
        } else {
          resultText = `Unknown tool: ${tu.function.name}`;
        }

        toolResultMessages.push({
          role: 'tool',
          tool_call_id: tu.id,
          content: resultText,
        });
      }

      // Feed tool results back so Klaus can respond in character
      const assistantMsg = res.choices[0].message;
      const followupMessages = [
        ...memory.getHistory(memKey),
        { role: 'assistant', content: assistantMsg.content || null, tool_calls: assistantMsg.tool_calls },
        ...toolResultMessages,
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
