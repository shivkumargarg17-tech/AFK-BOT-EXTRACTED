// Minecraft AFK Roaster Bot - Coded By Legend 😎
// Keeps your Aternos server alive + roasts players for fun!

const express = require('express');
const mineflayer = require('mineflayer');

const app = express();
const port = process.env.PORT || 3000;

// --- Express keep-alive for Render + UptimeRobot ---
app.get('/', (req, res) => {
  res.send('Minecraft AFK Bot is running — CodedByLegend 💻🔥');
});
app.listen(port, () => {
  console.log(`[WEB] Express server started on port ${port}`);
});

// --- Minecraft Bot Setup ---
const bot = mineflayer.createBot({
  host: 'HOGAKING.aternos.me', // 🖥️ Your server IP
  port: 19754,                 // 🔌 Your server port
  username: 'CodedByLegend',   // 🤖 Your bot username
  version: '1.21.1',           // ✅ Match your server version
});

bot.on('spawn', () => {
  console.log('[BOT] Joined server successfully as CodedByLegend ✅');

  // 👣 Move randomly to avoid AFK kick
  setInterval(() => {
    const yaw = Math.random() * Math.PI * 2;
    bot.look(yaw, 0, true);
    bot.setControlState('forward', true);
    setTimeout(() => bot.setControlState('forward', false), 500);
  }, 2000);

  // 💬 Random roast messages every 20 seconds
  const roasts = [
    "Bro plays on mobile but still misses every hit 💀",
    "Armor kaha gaya bhai? Oh wait, you never had one 😆",
    "Lag ya skill issue? 🤔",
    "Nice aim bro... oh wait, there isn’t one 😭",
    "Villagers trade better than you 😂",
    "24/7 online unlike your brain 😎",
    "You bought a realm but still can’t play properly 💀",
    "Bhai tu toh respawn machine ban gaya 😂",
    "Server ke liye main bot, gameplay ke liye tu flop 😭",
    "Tu sochta hai main afk hu, main tera roast likh raha hu 😏"
  ];

  setInterval(() => {
    const randomRoast = roasts[Math.floor(Math.random() * roasts.length)];
    bot.chat(randomRoast);
  }, 20000); // Every 20 seconds
});

// --- Error & Reconnect Handling ---
bot.on('kicked', (reason) => {
  console.log('[KICKED]', reason);
});
bot.on('error', (err) => {
  console.log('[ERROR]', err);
});
bot.on('end', () => {
  console.log('[INFO] Bot disconnected. Reconnecting in 10 seconds...');
  setTimeout(() => {
    process.exit(1); // Let Render auto-restart the bot
  }, 10000);
});
