const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { GoalBlock } = require('mineflayer-pathfinder').goals;
const express = require('express');
const config = require('./settings.json');

const app = express();
app.get('/', (req, res) => res.send('Bot is running safely 24/7! 😎'));
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`[SERVER] Express running on port ${PORT}`));

function createBot() {
  const bot = mineflayer.createBot({
    username: "CodedByLegend", // 👈 New unique bot name
    password: config['bot-account'].password,
    auth: config['bot-account'].type,
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log('[BOT] Joined server successfully ✅');

    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    // Wait 5 seconds before actions (prevents instant ban)
    setTimeout(() => {
      const roastMessages = [
        "Bro plays Minecraft on mobile and still dies to zombies 💀",
        "Abe realm kharid liya, skill kab kharidega? 😂",
        "Main free hu, tu realm ke paise deke bhi loser hai 😎",
        "Server mere naam se chal raha hai bhai 💀🔥",
        "Bina paise ke bhi main legend hu 🤣🤣",
        "Tu keyboard pe tryhard, main code se god 😎",
        "Mujhe ban karne se pehle apni gameplay thodi improve kar 😂",
        "Main free me chal raha hu, tu paisa de ke crash kar raha hai 😂",
        "Server chal raha hai, tu so raha hai 😂",
        "Lag ka reason: tu khud 💀🤣",
        "Minecraft mobile gang still suffering 💀💀💀"
      ];

      // Send random roast message every 60 seconds
      setInterval(() => {
        const msg = roastMessages[Math.floor(Math.random() * roastMessages.length)];
        bot.chat(msg);
      }, 60000);

      // Move a little every 20 seconds to prevent idle
      setInterval(() => {
        const x = bot.entity.position.x + (Math.random() * 4 - 2);
        const z = bot.entity.position.z + (Math.random() * 4 - 2);
        const y = bot.entity.position.y;
        bot.pathfinder.setGoal(new GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
      }, 20000);
    }, 5000);
  });

  // Auto reconnect if disconnected
  bot.on('end', () => {
    console.log(`[INFO] Bot disconnected. Reconnecting in ${config.utils['auto-reconnect-delay']} ms...`);
    setTimeout(createBot, config.utils['auto-reconnect-delay']);
  });

  // Error and kick logs
  bot.on('kicked', reason => console.log(`[KICKED] ${reason}`));
  bot.on('error', err => console.log(`[ERROR] ${err.message}`));
}

createBot();
