const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('24/7 RoasterXXX is vibing in your server 😎🔥'));
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Web server running on port ${PORT}`));

function createBot() {
  const bot = mineflayer.createBot({
    username: "RoasterXXX",
    host: "HOGAKING.aternos.me",
    port: 19754,
    version: "1.12.1",
    auth: "mojang"
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    console.log(`[INFO] ${bot.username} joined successfully!`);

    // 💀 Indian mobile player roasts 💀
    const messages = [
      "Tu mobile se khelta hai? sensitivity 0 pe hai kya 😂",
      "Bro ke thumbs bhi lag karte hain 💀📱",
      "Tu jump karte waqt bhi aim miss kar deta hai 😭",
      "Lagta hai tu crouch ka button search kar raha hai 💀",
      "Main PC se chalta hoon, tu lag se 💀💀",
      "Tera screen shake dekha? earthquake lag gaya kya 😂",
      "Tu attack karta hai ya screen clean kar raha hai? 💀",
      "Mujhe laga tu AFK hai, par tu toh aise hi slow hai 😭",
      "Wi-Fi nahi, 2G sim lagta hai tere phone mein 🤣",
      "Main code se chalta hoon, tu thumbnail dekh ke 💀",
      "Tu bolta pro hai, gameplay bolta 'respawn point set' 💀",
      "Mujhe lagta hai tu phone ulta pakad ke khelta hai 😂",
      "Tere hits connect hone se pehle server restart ho jata 💀",
      "Mobile pe PvP karta hai? Respect for bravery 😂🔥",
      "Tere gameplay dekh ke mobs bhi hans rahe the 💀",
      "Tere thumbs ka ping bhi 999+ lagta hai 🤣",
      "Tu crouch karta hai ya phone hang kar gaya? 💀",
      "Mujhe laga tu hacker hai, par tu toh lagger nikla 😭",
      "Server ne bola – 'mobile player detected, lower difficulty' 💀",
      "Main bot hoon, tu toh settings hi nahi khol paata 😂",
      "Tere phone ne bola – 'Battery low, Skill not found' 💀",
      "Tu aim karta hai ya selfie le raha hai? 🤣",
      "Bro mobile se try karta hai, aur bolta hai 'lag ho gaya' 💀",
      "Tera sprint dekh ke turtle bhi jealous ho gaya 🐢💀",
      "Main 24/7 online, tu 24/7 lag mein 😎",
      "Tu Bedrock se khelta hai? Phir toh lag hi destiny hai 💀",
      "Server bhi kehta – 'isko spectator mein daal do bhai' 💀"
    ];

    // 💬 Random roast every 40–70 seconds
    setInterval(() => {
      const msg = messages[Math.floor(Math.random() * messages.length)];
      bot.chat(msg);
    }, Math.floor(Math.random() * (70000 - 40000)) + 40000);

    // 🧍 Anti-AFK movement (move + look random)
    setInterval(() => {
      const moves = ['forward', 'back', 'left', 'right', 'jump'];
      const move = moves[Math.floor(Math.random() * moves.length)];
      bot.setControlState(move, true);
      setTimeout(() => bot.setControlState(move, false), 800);

      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI / 3;
      bot.look(yaw, pitch, true);
    }, 15000);

    // ⏰ Auto-leave and reconnect (anti-idle refresh)
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
