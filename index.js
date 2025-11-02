// ───────────────────────────────────────────────
// Minecraft AFK Bot "CodedByLegend"
// Coded by Legend 💪
// Keeps Aternos server alive 24/7 with UptimeRobot + Render
// Auto reconnects, moves every second, and throws random Indian roast lines 😎
// Works even if server is on 1.21.1 using ViaBackwards (fake version 1.20.4)
// ───────────────────────────────────────────────

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('✅ Bot is running — CodedByLegend!'));
app.listen(3000, () => console.log('🌐 Express server started for UptimeRobot ping!'));

function createBot() {
  const bot = mineflayer.createBot({
    host: "HOGAKING.aternos.me", // ⚙️ Replace with your Aternos server IP
    port: 19754, // ⚙️ Replace with your Aternos server port
    username: "CodedByLegend", // 👑 Bot username
    version: "1.20.4", // 🎮 Fake version for 1.21.1 servers with ViaBackwards
  });

  // Load pathfinder for movement
  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log(`[BOT] Joined server successfully as ${bot.username} ✅`);

    // Movement setup
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    // Move randomly every 1 second to prevent AFK kick
    setInterval(() => {
      const x = bot.entity.position.x + (Math.random() - 0.5) * 2;
      const z = bot.entity.position.z + (Math.random() - 0.5) * 2;
      const y = bot.entity.position.y;
      bot.pathfinder.setGoal(new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
    }, 1000);

    // Random Indian roast lines (family-friendly 😄)
    const roasts = [
      "Bhai tu to legend nikla 😎",
      "Arey bhai zyada pro mat ban! 😂",
      "Server ka owner mai hoon 😏",
      "Tu khel, mai AFK sambhalta hoon 😤",
      "Ping low, attitude high 💀",
      "Lag hua kya? Nahi bro, tera net gaya! 🤣",
      "Aaja 1v1 kar le, dekhte hain kaun king hai 👑",
      "Server sambhal mere bina tut jayega 💪",
      "AFK nahi hoon, bas soch raha hoon 😴",
      "Coding aur roasting dono me top level 🔥"
    ];

    // Send random roast message every 60 seconds
    setInterval(() => {
      const msg = roasts[Math.floor(Math.random() * roasts.length)];
      bot.chat(msg);
    }, 60000);
  });

  // Handle disconnections and reconnect automatically
  bot.on('end', () => {
    console.log('[INFO] Bot disconnected. Reconnecting in 15 seconds...');
    setTimeout(createBot, 15000);
  });

  bot.on('kicked', (reason) => {
    console.log(`[KICKED] ${reason}`);
  });

  bot.on('error', (err) => {
    console.log(`[ERROR] ${err.message}`);
  });
}

// Start the bot
createBot();
