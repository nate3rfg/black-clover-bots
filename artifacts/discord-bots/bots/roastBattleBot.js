require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { chat, extractText } = require('../shared/aiClient');
const stats = require('../shared/statsStore');

const NAME = 'RoastBattle';
const TOKEN = process.env.ROAST_BOT_TOKEN;
const CLIENT_ID = process.env.ROAST_CLIENT_ID;

const CHALLENGE_TIMEOUT_MS = 60_000; // time to accept/decline
const BATTLE_DURATION_MS = 120_000; // the actual 120s battle window

// channelId -> battle state, so only one battle can run per channel at a time
const activeBattles = new Map();

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
    .setName('battle')
    .setDescription('Challenge someone to a roast battle')
    .addUserOption((opt) => opt.setName('opponent').setDescription('Who you want to roast battle').setRequired(true)),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the roast battle leaderboard'),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show roast battle stats for a user')
    .addUserOption((opt) => opt.setName('user').setDescription('User to check (defaults to you)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('forfeit')
    .setDescription('Forfeit your current roast battle'),
  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Force-clear a stuck battle in this channel (use if the bot gets stuck)'),
].map((c) => c.toJSON());

client.once(Events.ClientReady, () => {
  console.log(`[${NAME}] logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'battle') return handleBattleCommand(interaction);
      if (interaction.commandName === 'leaderboard') return handleLeaderboard(interaction);
      if (interaction.commandName === 'stats') return handleStats(interaction);
      if (interaction.commandName === 'forfeit') return handleForfeit(interaction);
      if (interaction.commandName === 'reset') return handleReset(interaction);
    }
  } catch (err) {
    console.error(`[${NAME}] interaction error:`, err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong. Try again.', ephemeral: true }).catch(() => {});
    }
  }
});

async function handleBattleCommand(interaction) {
  const challenger = interaction.user;
  const opponent = interaction.options.getUser('opponent');
  const channelId = interaction.channelId;

  if (opponent.bot) {
    return interaction.reply({ content: "You can't roast battle a bot.", ephemeral: true });
  }
  if (opponent.id === challenger.id) {
    return interaction.reply({ content: "You can't roast battle yourself.", ephemeral: true });
  }
  if (activeBattles.has(channelId)) {
    return interaction.reply({ content: 'There is already a battle happening (or pending) in this channel. Try again after it finishes, or ask an admin to run /reset.', ephemeral: true });
  }

  // reserve the slot immediately to prevent race conditions
  activeBattles.set(channelId, { phase: 'pending', challenger, opponent });

  const acceptButton = new ButtonBuilder()
    .setCustomId(`battle_accept_${challenger.id}_${opponent.id}`)
    .setLabel('Accept')
    .setStyle(ButtonStyle.Success);
  const declineButton = new ButtonBuilder()
    .setCustomId(`battle_decline_${challenger.id}_${opponent.id}`)
    .setLabel('Decline')
    .setStyle(ButtonStyle.Danger);
  const row = new ActionRowBuilder().addComponents(acceptButton, declineButton);

  const embed = new EmbedBuilder()
    .setTitle('🔥 Roast Battle Challenge!')
    .setDescription(`${opponent}, ${challenger} wants to roast battle you!\nYou have ${CHALLENGE_TIMEOUT_MS / 1000}s to accept or decline.`)
    .setColor(0xff4500);

  const challengeMsg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

  const collector = challengeMsg.createMessageComponentCollector({
    time: CHALLENGE_TIMEOUT_MS,
    max: 1,
    filter: (i) => i.user.id === opponent.id,
  });

  collector.on('collect', async (i) => {
    if (i.customId.startsWith('battle_accept')) {
      await i.update({ content: `${opponent} accepted! Battle starting now — you both have ${BATTLE_DURATION_MS / 1000} seconds. Go!`, embeds: [], components: [] });
      startBattle(interaction.channel, challenger, opponent);
    } else {
      await i.update({ content: `${opponent} declined the battle. Coward.`, embeds: [], components: [] });
      activeBattles.delete(channelId);
    }
  });

  collector.on('end', (collected) => {
    if (collected.size === 0) {
      activeBattles.delete(channelId);
      challengeMsg.edit({ content: 'Challenge expired — no response in time.', embeds: [], components: [] }).catch(() => {});
    }
  });
}

function startBattle(channel, challenger, opponent) {
  const state = {
    phase: 'active',
    challenger,
    opponent,
    startedAt: Date.now(),
    lines: { [challenger.id]: [], [opponent.id]: [] },
  };
  activeBattles.set(channel.id, state);

  const collector = channel.createMessageCollector({
    filter: (m) => m.author.id === challenger.id || m.author.id === opponent.id,
    time: BATTLE_DURATION_MS,
  });

  collector.on('collect', (m) => {
    state.lines[m.author.id].push(m.content);
  });

  collector.on('end', async () => {
    // could have already ended via /forfeit
    const current = activeBattles.get(channel.id);
    if (!current || current.phase !== 'active') return;
    await judgeBattle(channel, state);
  });

  state.collector = collector;
}

async function judgeBattle(channel, state) {
  const { challenger, opponent, lines } = state;
  activeBattles.set(channel.id, { phase: 'judging', challenger, opponent });

  const aLines = lines[challenger.id];
  const bLines = lines[opponent.id];

  if (aLines.length === 0 && bLines.length === 0) {
    activeBattles.delete(channel.id);
    return channel.send('Neither fighter said anything. No winner — that was pathetic, honestly.');
  }
  if (aLines.length === 0) {
    stats.recordResult(opponent.id, challenger.id);
    activeBattles.delete(channel.id);
    return channel.send(`${challenger} didn't say a word. ${opponent} wins by default.`);
  }
  if (bLines.length === 0) {
    stats.recordResult(challenger.id, opponent.id);
    activeBattles.delete(channel.id);
    return channel.send(`${opponent} didn't say a word. ${challenger} wins by default.`);
  }

  const transcript = `Fighter A (${challenger.username}) said:\n${aLines.map((l) => `- ${l}`).join('\n')}\n\nFighter B (${opponent.username}) said:\n${bLines.map((l) => `- ${l}`).join('\n')}`;

  const system = `You are an impartial roast battle judge. You will be given lines from two fighters, labeled Fighter A and Fighter B. Judge purely on comedic and roasting quality: creativity, wordplay, delivery, and how well each roast lands - NOT on the target's real-world traits, appearance, identity, or anything hateful. Ignore fighter names/usernames as a factor; do not favor a fighter for any reason unrelated to the actual content and quality of their lines. Respond with ONLY valid JSON in this exact shape, no other text: {"winner": "A" or "B", "reasoning": "2-3 sentence explanation of why, referencing specific lines"}`;

  let winnerId = challenger.id;
  let reasoning = 'Judging failed, defaulting to a coin-flip style result.';

  try {
    const res = await chat({
      system,
      messages: [{ role: 'user', content: transcript }],
      maxTokens: 300,
    });
    const text = extractText(res);
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    winnerId = parsed.winner === 'B' ? opponent.id : challenger.id;
    reasoning = parsed.reasoning || reasoning;
  } catch (err) {
    console.error(`[${NAME}] judging error:`, err);
  }

  const loserId = winnerId === challenger.id ? opponent.id : challenger.id;
  stats.recordResult(winnerId, loserId);
  activeBattles.delete(channel.id);

  const winnerUser = winnerId === challenger.id ? challenger : opponent;
  const embed = new EmbedBuilder()
    .setTitle('🏆 Battle Results')
    .setDescription(`**Winner: ${winnerUser}**\n\n${reasoning}`)
    .setColor(0xffd700);

  await channel.send({ embeds: [embed] });
}

async function handleLeaderboard(interaction) {
  const top = stats.getLeaderboard(10);
  if (top.length === 0) {
    return interaction.reply('No battles recorded yet. Start one with /battle!');
  }
  const lines = top.map((s, i) => `**${i + 1}.** <@${s.id}> — ${s.wins}W / ${s.losses}L`);
  const embed = new EmbedBuilder().setTitle('🔥 Roast Battle Leaderboard').setDescription(lines.join('\n')).setColor(0xff4500);
  await interaction.reply({ embeds: [embed] });
}

async function handleStats(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const s = stats.getStats(user.id);
  await interaction.reply(`**${user.username}**: ${s.wins}W / ${s.losses}L`);
}

async function handleForfeit(interaction) {
  const channelId = interaction.channelId;
  const state = activeBattles.get(channelId);
  if (!state || state.phase !== 'active') {
    return interaction.reply({ content: 'There is no active battle in this channel.', ephemeral: true });
  }
  const { challenger, opponent } = state;
  if (interaction.user.id !== challenger.id && interaction.user.id !== opponent.id) {
    return interaction.reply({ content: "You're not part of this battle.", ephemeral: true });
  }
  const winner = interaction.user.id === challenger.id ? opponent : challenger;
  const loser = interaction.user;

  if (state.collector) state.collector.stop('forfeit');
  stats.recordResult(winner.id, loser.id);
  activeBattles.delete(channelId);

  await interaction.reply(`${loser} forfeited. ${winner} wins by default!`);
}

async function handleReset(interaction) {
  const channelId = interaction.channelId;
  const had = activeBattles.has(channelId);
  const state = activeBattles.get(channelId);
  if (state && state.collector) state.collector.stop('reset');
  activeBattles.delete(channelId);
  await interaction.reply({ content: had ? 'Cleared any stuck battle state for this channel.' : 'Nothing to reset — no battle was active here.', ephemeral: true });
}

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
