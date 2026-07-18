require('dotenv').config();

const bots = [
  { name: 'RoastBattle', mod: require('./bots/roastBattleBot') },
  { name: 'Asta', mod: require('./bots/astaBot') },
  { name: 'Noelle', mod: require('./bots/noelleBot') },
  { name: 'Zora', mod: require('./bots/zoraBot') },
  { name: 'Klaus', mod: require('./bots/klausBot') },
  { name: 'Nero', mod: require('./bots/neroBot') },
];

async function main() {
  for (const { name, mod } of bots) {
    try {
      await mod.start();
      console.log(`✅ ${name} started`);
    } catch (err) {
      console.error(`❌ ${name} failed to start:`, err);
    }
  }
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});

main();
