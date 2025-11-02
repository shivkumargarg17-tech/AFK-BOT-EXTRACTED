// ===============================
// Minecraft AFK + Roaster Bot
// Name: CodedByLegend
// Coded by: Legend
// Server: HOGAKING.aternos.me:19754
// Fully works with Render + UptimeRobot (24/7)
// ===============================

const mineflayer = require('mineflayer');
const express = require('express');
const app = express();

// Express web server for uptime
app.get('/', (req, res) => res.send('Bot is running 24/7 - CodedByLegend'));
app.listen(3000, () => console.log('Web server is live on port 3000 for Render/UptimeRobot!'));

// Minecraft bot details
const bot = mineflayer.createBot({
  host: 'HOGAKING.aternos.me',
  port: 19754,
  username: 'CodedByLegend',
  version: false // auto-detect version
});

// Roasting lines (Desi Indian style)
const roastLines = [
  "Bhai tu to creeper se bhi kam dhamaka karta hai.",
  "Aree bhai tu chal raha hai ya server lag ho gaya?",
  "Tere aim dekh ke skeleton bhi sharma jaaye.",
  "Tu maarne gaya tha ya selfie lene?",
  "Tere move dekh ke lagta hai Wi-Fi dukaan se liya hai.",
  "Bro tu fight karta hai ya yoga kar raha hai?",
  "Tere jaise players ke liye respawn invent kiya gaya tha.",
  "Tu marne ke baad bhi excuse ready rakhta hai kya?",
  "Aree bhai tu mining kar raha hai ya chhup-chhup ke rotis paka raha hai?",
  "Server ne bhi kaha — 'isko kick karo, ye AFK nahi, slow hai!'",
  "Tere piche zombie bhi keh rahe the — 'isse door rehna bhai!'",
  "Bhai tu mar gaya? Nahi? Oh sorry, lagta to tha.",
  "Tere speed dekh ke ghoda bhi soch raha hai chhod yaar.",
  "Tu diamond ke sapne dekhta hai, cobblestone milta hai.",
  "Bhai tu Nether jaane layak nahi, ghar sambhal pehle."
];

// Function to send random roast every 60 seconds
function sendRandomRoast() {
  if (bot.player) {
    const roast = roastLines[Math.floor(Math.random() * roastLines.length)];
    bot.chat(roast);
    console.log('Sent roast:', roast);
  }
}

// Every 60 seconds, send a roast
setInterval(sendRandomRoast, 60000);

// Move the bot a bit every second to prevent AFK kick
setInterval(() => {
  if (!bot.entity || !bot.entity.position) return;
  const pos = bot.entity.position;
  bot.look(Math.random() * Math.PI * 2, 0); // looks around randomly
  bot.setControlState('forward', true);
  setTimeout(() => bot.setControlState('forward', false), 400);
}, 1000);

// Logging join/leave/errors
bot.on('login', () => console.log('Bot has joined the server successfully!'));
bot.on('spawn', () => console.log('Bot spawned in the world.'));
bot.on('chat', (username, message) => console.log(`${username}: ${message}`));
bot.on('kicked', (reason) => console.log('Bot was kicked:', reason));
bot.on('end', () => console.log('Bot disconnected. Attempting to reconnect...'));
bot.on('error', (err) => console.log('Error:', err));

// Auto reconnect if bot gets disconnected
function reconnect() {
  console.log('Reconnecting bot...');
  setTimeout(() => {
    process.exit(1); // Render auto restarts the process
  }, 5000);
}
bot.on('end', reconnect);
bot.on('kicked', reconnect);
