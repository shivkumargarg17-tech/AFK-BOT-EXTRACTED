const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('RoasterXXX is online 24/7 🔥💀'));
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Web server running on port ${PORT}`));

function createBot() {
  const bot = mineflayer.createBot({
    username: "RoasterXXX24/7",
    host: "HOGAKING.aternos.me",
    port: 19754,
    version: "1.12.1",
    auth: "mojang"
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log(`[INFO] ${bot.username} joined the server successfully!`);

    // 💀 Desi + mobile player roasts
    const messages = [
      "Tu mobile se khelta hai? FPS bhi soch raha hai ‘main kyun exist karta hoon?’ 💀",
      "Bro ke thumbs bhi lag karte hain 📱💀",
      "Tere hitbox pe toh mobs bhi miss karte hain 😂",
      "Tu jump karta hai ya phone vibrate kar raha hai? 🤣",
      "Main bot hoon, tu toh lag ka prototype hai 💀",
      "Mobile pe PvP karta hai? bravery award milna chahiye 😂",
      "Server bola — ‘isko spectator mein daal do bhai’ 💀",
      "Tu aim karta hai ya screen clean kar raha hai? 😭",
      "Tera gameplay dekh ke mobs AFK ho gaye 💀",
      "Main 24/7 online, tu 24/7 lag mein 😎",
      "Tere thumbs ka ping bhi 999+ lagta hai 🤣",
      "Wi-Fi nahi, lag ka blessing mila hai tujhe 😂",
      "Mujhe laga tu hacker hai, par tu toh lagger nikla 💀",
      "Tera sprint dekh ke turtle bola ‘slow down bhai’ 🐢💀",
      "Tu crouch karta hai ya phone hang kar gaya? 💀",
      "Tu bolta pro hai, gameplay bolta respawn 💀",
      "Main code se chalta hoon, tu thumbnail dekh ke 💀",
      "Server ne bola ‘mobile player detected, reducing FPS’ 💀",
      "Tu aim karta hai ya selfie le raha hai? 📸💀",
      "Battery low, skill not found 💀😂"
    ];

    // 💬 Random roast every 40–70 seconds
    setInterval(() => {
      const msg = messages[Math.floor(Math.random() * messages.length)];
      bot.chat(msg);
    }, Math.floor(Math.random() * (70000 - 40000)) + 40000);

    // 🧍 Anti-AFK: move + look random
    setInterval(() => {
      const moves = ['forward', 'back', 'left', 'right', 'jump'];
      const move = moves[Math.floor(Math.random() * moves.length)];
      bot.setControlState(move, true);
      setTimeout(() => bot.setControlState(move, false), 800);

      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI / 3;
      bot.look(yaw, pitch, true);
    }, 15000);

    // ⏰ Auto-leave & reconnect (anti-idle)
    setTimeout(() => {
      console.log('[INFO] Leaving after 70s to refresh...');
      bot.quit('Rejoining...');
    }, 70000);
  });

  bot.on('end', () => {
    console.log('[INFO] Disconnected. Reconnecting in 10 seconds...');
    setTimeout(createBot, 10000);
  });

  bot.on('kicked', reason => console.log(`[KICKED] ${reason}`));
  bot.on('error', err => console.log(`[ERROR] ${err.message}`));
}

createBot();
