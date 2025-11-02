// Minecraft AFK + Roaster Bot
// Name: CodedByLegend
// Coded by Legend 😎

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// 🟢 Keep Render app alive
app.get('/', (req, res) => res.send('Bot is running 24/7 🚀'));
app.listen(PORT, () => console.log(`Web server running on port ${PORT}`));

// 🧠 Server & Bot Info
const botInfo = {
  host: 'YOUR_SERVER_IP_HERE', // example: 'play.example.aternos.me'
  port: 25565,                 // your server port
  username: 'CodedByLegend',
  version: '1.21'              // force version close to 1.21.10
};

// 💬 Some Indian-style roasts
const roasts = [
  "Bhai tu khelta kam aur mar khata zyada hai 💀",
  "Server me aa gaya main, ab tu gaya 😎",
  "Lagta hai tu creative me bhi mar jata hoga 😂",
  "Bro ke paas armor hai par skills gayab 😭",
  "Legend joined — noobs run for your life 💨",
  "Aree bhai tu to XP bhi chhod ke bhag gaya 🤣",
  "Ye kya speedrun kar raha ya comedy show? 🤔",
  "Bot hu par tera aim se accha mera hai 😏"
];

// 🧍 Create the bot
function createBot() {
  const bot = mineflayer.createBot(botInfo);
  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log(`[BOT] Joined server successfully as ${botInfo.username}`);
    startMoving(bot);
    roastLoop(bot);
  });

  // Send roasts every 30–60 seconds randomly
  function roastLoop(bot) {
    setInterval(() => {
      const msg = roasts[Math.floor(Math.random() * roasts.length)];
      bot.chat(msg);
    }, Math.floor(Math.random() * 30000) + 30000);
  }

  // Move every 1 second randomly
  function startMoving(bot) {
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    setInterval(() => {
      const x = bot.entity.position.x + (Math.random() * 4 - 2);
      const z = bot.entity.position.z + (Math.random() * 4 - 2);
      const y = bot.entity.position.y;
      bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
    }, 1000);
  }

  bot.on('kicked', (reason) => {
    console.log(`[KICKED] ${reason}`);
  });

  bot.on('error', (err) => {
    console.log(`[ERROR] ${err}`);
  });

  bot.on('end', () => {
    console.log(`[INFO] Bot disconnected. Reconnecting in 10 seconds...`);
    setTimeout(createBot, 10000);
  });
}

createBot();
