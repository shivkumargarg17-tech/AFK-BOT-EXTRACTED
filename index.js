const mineflayer = require('mineflayer');
const express = require('express');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// KEEP ALIVE WEB SERVER
// =========================
app.get('/', (req, res) => {
  res.send('Minecraft Bot is alive - CodedByLegend');
});
app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

// =========================
// BOT START FUNCTION
// =========================
function startBot() {
  const bot = mineflayer.createBot({
    host: 'HOGAKING.aternos.me',
    port: 19754,
    username: 'CodedByLegend',
    version: '1.21.1'
  });

  bot.loadPlugin(pathfinder);

  bot.on('login', () => {
    console.log('Bot joined the server successfully!');
    bot.chat('CodedByLegend aa gaya server pe!');
  });

  bot.on('spawn', () => {
    console.log('Bot spawned and moving randomly every second!');
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);

    setInterval(() => {
      if (!bot.entity) return;
      const x = bot.entity.position.x + (Math.random() * 10 - 5);
      const z = bot.entity.position.z + (Math.random() * 10 - 5);
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalNear(x, bot.entity.position.y, z, 1));
    }, 1000);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const msg = message.toLowerCase();

    // DESI ROASTING LINES 🔥
    const roasts = [
      "Bhai tu bolta kam, karta zyada kar!",
      "Aree bhai, teri speed to turtle se bhi kam hai!",
      "Server bhi sochta hoga, isko kyu join karaya!",
      "Jyada hawa mein mat ud, net ka ping yaad rakh!",
      "Legend ke samne bakchodi allowed nahi bhai!"
    ];

    if (msg.includes('hello') || msg.includes('hi')) {
      bot.chat(`Kya haal hai ${username}?`);
    } else if (msg.includes('roast')) {
      const line = roasts[Math.floor(Math.random() * roasts.length)];
      bot.chat(line);
    } else if (msg.includes('owner')) {
      bot.chat('Server ka asli owner HOGAKING hai!');
    } else if (msg.includes('bye')) {
      bot.chat(`Chal ${username}, milte hain agli baar!`);
    }
  });

  bot.on('end', () => {
    console.log('Bot disconnected. Reconnecting in 10 seconds...');
    setTimeout(startBot, 10000);
  });

  bot.on('kicked', (reason) => {
    console.log(`Kicked: ${reason}`);
  });

  bot.on('error', (err) => {
    console.log(`Error: ${err.message}`);
  });
}

startBot();
