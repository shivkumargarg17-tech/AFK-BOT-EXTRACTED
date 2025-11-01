/*
  🔥 Minecraft AFK Roaster Bot 🔥
  Bot Username: CodedByLegend
  Coded by Legend 😎
  - Sends random Indian roast messages
  - Moves randomly every 1–3 seconds (anti-idle & natural)
  - Auto reconnects if kicked or disconnected
  - Works 24/7 with Render or Replit
*/

const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { GoalNear } = require('mineflayer-pathfinder').goals;
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('🔥 CodedByLegend is running 24/7 - Roasting since birth 😎'));
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`[SERVER] Running on port ${PORT}`));

function createBot() {
  const bot = mineflayer.createBot({
    username: "CodedByLegend", // Bot name
    auth: "mojang",
    host: "HOGAKING.aternos.me", // Your server IP
    port: 19754, // Your server port
    version: "1.12.1" // Server version
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log('[BOT] Joined server successfully as CodedByLegend ✅');

    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    // 💬 Desi Roast Messages
    const roastMessages = [
      "Bro plays Minecraft on mobile and still dies to zombies",
      "Abe realm kharid liya, skill kab kharidega?",
      "Main free hu, tu realm ke paise deke bhi haar gaya",
      "Server mere naam se chal raha hai bhai",
      "Bina paise ke bhi main pro hu",
      "Tu keyboard pe tryhard, main code se god",
      "Mujhe ban karne se pehle apni gameplay improve kar",
      "Main free me chal raha hu, tu paisa deke crash kar raha hai",
      "Server chal raha hai, tu so raha hai",
      "Lag ka reason: tu khud",
      "Minecraft mobile gang abhi bhi dukhi hai"
    ];

    // 🔄 Send random roast every 60 seconds
    setInterval(() => {
      const msg = roastMessages[Math.floor(Math.random() * roastMessages.length)];
      bot.chat(msg);
    }, 60000);

    // 🚶 Random movement every 1–3 seconds (natural anti-idle)
    function moveRandomly() {
      const x = bot.entity.position.x + (Math.random() * 6 - 3);
      const z = bot.entity.position.z + (Math.random() * 6 - 3);
      const y = bot.entity.position.y;
      bot.pathfinder.setGoal(new GoalNear(x, y, z, 1));

      bot.look(Math.random() * Math.PI * 2, 0);
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 300);

      // Random delay between 1–3 seconds
      const delay = Math.random() * 2000 + 1000;
      setTimeout(moveRandomly, delay);
    }
    moveRandomly();
  });

  // 🔁 Auto reconnect
  bot.on('end', () => {
    console.log(`[INFO] Bot disconnected. Reconnecting in 10 seconds...`);
    setTimeout(createBot, 10000);
  });

  bot.on('kicked', reason => console.log(`[KICKED] ${reason}`));
  bot.on('error', err => console.log(`[ERROR] ${err.message}`));
}

createBot();
