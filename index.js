// ============================================
// Roaster Bot — "CodedByLegend"
// 24/7 Minecraft AFK + Roast Bot
// Works with Render + UptimeRobot
// Auto reconnects, walks randomly, and chats desi style
// ============================================

const mineflayer = require('mineflayer');
const express = require('express');

// Web server for Render & UptimeRobot to keep it 24/7 online
const app = express();
app.get('/', (req, res) => res.send('Roaster Bot by Legend is ALIVE'));
app.listen(3000, () => console.log('Web server started — ready for UptimeRobot'));

// Bot options
const botOptions = {
  host: 'your.server.ip',   // Replace with your Minecraft server IP
  port: 25565,              // Change port if different
  username: 'CodedByLegend', // Bot’s name
  version: '1.21.1'         // Match your server version
};

// Start function
function startBot() {
  const bot = mineflayer.createBot(botOptions);

  // When bot joins
  bot.once('spawn', () => {
    console.log('Bot has joined the server successfully.');
    bot.chat('Aa gaya mai — CodedByLegend');

    // Move randomly every 1 second to avoid AFK kick
    setInterval(() => {
      const x = bot.entity.position.x + (Math.random() - 0.5) * 2;
      const z = bot.entity.position.z + (Math.random() - 0.5) * 2;
      bot.lookAt({ x, y: bot.entity.position.y, z });
      bot.setControlState('forward', true);
      setTimeout(() => bot.setControlState('forward', false), 500);
    }, 1000);
  });

  // Chat replies + Indian roast mode
  const roasts = [
    'Abe chup kar, mai server ka owner hu',
    'Tere jese to mai lunch break me harata hu',
    'Ping dekh zara, tujhe to lag hi kha gaya',
    'Server mera, rules bhi mere',
    'Beta padhai likhai karo, Minecraft baad me',
    'Abe hacker nahi hu, bas smart hu',
    'Lagta hai tu apne base me obsidian se zyada slow hai',
    'Apne level pe rehna seekh bhai',
    'Yaha mai afk bhi raho to tu mar jaata hai',
    'Legend naam hai mera, roasting ka kaam hai mera'
  ];

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;

    if (message.toLowerCase().includes('bot')) {
      const roast = roasts[Math.floor(Math.random() * roasts.length)];
      bot.chat(roast);
    }

    if (message.toLowerCase().includes('hi') || message.toLowerCase().includes('hello')) {
      bot.chat(`Yo ${username}, kya haal hai bhai`);
    }
  });

  // Auto reconnect on kick or error
  bot.on('end', () => {
    console.log('Bot disconnected. Reconnecting in 10 seconds...');
    setTimeout(startBot, 10000);
  });

  bot.on('error', err => {
    console.log('Error:', err);
  });
}

startBot();
