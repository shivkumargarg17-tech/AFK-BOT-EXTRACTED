const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { GoalBlock } = require('mineflayer-pathfinder').goals;
const express = require('express');
const config = require('./settings.json');

const app = express();
app.get('/', (req, res) => res.send('Bot is running 24/7!'));
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`[SERVER] Running on port ${PORT}`));

function createBot() {
  const bot = mineflayer.createBot({
    username: "RoasterXXX24/7Fryer",
    password: config['bot-account'].password,
    auth: config['bot-account'].type,
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log('[BOT] RoasterXXX24/7Fryer joined the server! 🔥');
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    // 💬 Random Indian roast messages
    const roastMessages = [
      "Bro plays Minecraft on mobile and still dies to zombies 💀",
      "Abe realm kharid liya, skill kab kharidega? 😂",
      "Main free hu, tu realm ke paise deke bhi loser hai 😎",
      "Server mere naam se chal raha hai bhai 💀🔥",
      "Bina paise ke bhi main legend hu 🤣🤣",
      "Jitna tu realm me time deta hai, utna main code me deta hu 😏",
      "Tu keyboard pe tryhard, main code se god 😎",
      "Mujhe ban karne se pehle apni gameplay thodi improve kar 😂",
      "Tere jaise logon ke liye bots hi kaafi hain 💀",
      "Main free me chal raha hu, tu paisa de ke crash kar raha hai 😂"
    ];

    // 💬 Send random roast every 60 seconds
    setInterval(() => {
      const msg = roastMessages[Math.floor(Math.random() * roastMessages.length)];
      bot.chat(msg);
    }, 60000);

    // 🤖 Random movement (Anti-AFK)
    setInterval(() => {
      const x = bot.entity.position.x + (Math.random() * 4 - 2);
      const z = bot.entity.position.z + (Math.random() * 4 - 2);
      const y = bot.entity.position.y;
      bot.pathfinder.setGoal(new GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 500);
    }, 20000); // Move every 20 seconds
  });

  // 🔁 Auto reconnect
  bot.on('end', () => {
    console.log(`[INFO] Bot disconnected. Reconnecting in ${config.utils['auto-reconnect-delay']}ms...`);
    setTimeout(createBot, config.utils['auto-reconnect-delay']);
  });

  bot.on('kicked', (reason) => console.log(`[KICKED] ${reason}`));
  bot.on('error', (err) => console.log(`[ERROR] ${err.message}`));
}

createBot();
