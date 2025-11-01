// 💻 Minecraft AFK Roaster Bot
// 👑 Coded By Legend — stable + anti-timeout + 24/7 uptime

const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

// Keep-alive web server (for Render/UptimeRobot)
app.get('/', (req, res) => res.send('✅ Roaster bot is alive — CodedByLegend'));
app.listen(port, () => console.log(`[WEB] Online at port ${port}`));

function startBot() {
  const bot = mineflayer.createBot({
    host: 'HOGAKING.aternos.me', // your Aternos IP (without https://)
    port: 19754,                 // server port
    username: 'CodedByLegend',   // bot name
    version: '1.21.1',           // Minecraft version
  });

  bot.once('spawn', () => {
    console.log('[BOT] Joined server successfully as CodedByLegend ✅');

    // 🔁 Move slightly every second to avoid AFK timeout
    setInterval(() => {
      try {
        const yaw = Math.random() * Math.PI * 2;
        bot.look(yaw, 0, true);
        bot.setControlState('forward', true);
        bot.setControlState('jump', true);
        setTimeout(() => {
          bot.setControlState('forward', false);
          bot.setControlState('jump', false);
        }, 500);
      } catch (err) {
        console.log('[WARN] Movement loop error:', err.message);
      }
    }, 1000);

    // 🎯 Random roast every 25 seconds
    const roasts = [
      "Bhai tu toh respawn expert nikla!",
      "Lag nahi bhai, skill issue 😭",
      "Tu mobile pe khelta hai na? Dikh raha hai 😆",
      "Armor pehna bhi tha kya?",
      "Server ke liye AFK, roasting ke liye 24/7 active 💪",
      "Main bot hoon, tu bhi lagta hai auto-mode me hai 😜",
      "Minecraft bhi tujhe dekh ke sad ho gaya 💀",
      "Bro sochta hai pro hai, par villagers bhi has rahe hain 😂"
    ];

    setInterval(() => {
      try {
        const roast = roasts[Math.floor(Math.random() * roasts.length)];
        bot.chat(roast);
      } catch (err) {
        console.log('[WARN] Chat error:', err.message);
      }
    }, 25000);
  });

  bot.on('error', (err) => {
    console.log('[ERROR]', err.code || err.message);
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      console.log('[INFO] Connection reset — retrying in 10s...');
      setTimeout(startBot, 10000);
    }
  });

  bot.on('end', () => {
    console.log('[INFO] Bot disconnected. Reconnecting in 10s...');
    setTimeout(startBot, 10000);
  });

  bot.on('kicked', (reason) => console.log('[KICKED]', reason));
}

startBot();
