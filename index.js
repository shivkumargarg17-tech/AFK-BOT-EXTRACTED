// ------------------------------
// Minecraft AFK + Roasting Bot
// Name: CodedByLegend
// Server: HOGAKING.aternos.me:19754
// Always online with Render + UptimeRobot
// Coded for continuous uptime & fun roast messages
// ------------------------------

const mineflayer = require('mineflayer');
const express = require('express');

// Simple express web server (for UptimeRobot ping)
const app = express();
app.get('/', (req, res) => res.send('Bot is online 24/7 - CodedByLegend'));
app.listen(3000, () => console.log('🌐 Web server running for uptime check'));

// ---- Bot Configuration ----
const botOptions = {
  host: "HOGAKING.aternos.me",
  port: 19754,
  username: "CodedByLegend", // bot name
  version: "1.12.1"
};

// ---- Desi Roast Lines ----
const roasts = [
  "Server ka owner mai hun, tum log bas guest ho!",
  "Tu mobile pe khelta hai? Skill bhi wahi chhoti lagti hai!",
  "Main bot hu, par tu fir bhi haar gaya!",
  "Mujhe disconnect karne se pehle apni skill connect kar le!",
  "Free server, free bot, par tera gameplay fir bhi cheap!",
  "Aternos mere bina 2 minute nahi tikta!",
  "Tu pay-to-win hai, main code-to-rule!",
  "Tera realm khatam, mera uptime shuru!",
  "Main AFK nahi, bas tumse zyada efficient hoon!",
  "Minecraft ka asli admin yahan hai — CodedByLegend!"
];

// ---- Create the bot ----
function createBot() {
  const bot = mineflayer.createBot(botOptions);

  bot.once('spawn', () => {
    console.log(`[BOT] CodedByLegend joined ${botOptions.host}`);

    // Random roast every 60 seconds
    setInterval(() => {
      const roast = roasts[Math.floor(Math.random() * roasts.length)];
      bot.chat(roast);
      console.log(`[ROAST] ${roast}`);
    }, 60000);

    // Move every 1 second to avoid being idle
    setInterval(() => {
      const randomDirection = Math.random();
      if (randomDirection < 0.25) bot.setControlState('forward', true);
      else if (randomDirection < 0.5) bot.setControlState('back', true);
      else if (randomDirection < 0.75) bot.setControlState('left', true);
      else bot.setControlState('right', true);

      setTimeout(() => {
        bot.clearControlStates();
      }, 500);
    }, 1000);
  });

  // Auto reconnect if kicked or disconnected
  bot.on('end', () => {
    console.log('[INFO] Disconnected. Reconnecting in 10 seconds...');
    setTimeout(createBot, 10000);
  });

  bot.on('kicked', reason => console.log(`[KICKED] ${reason}`));
  bot.on('error', err => console.log(`[ERROR] ${err.message}`));
}

createBot();
