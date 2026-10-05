import React, { useEffect, useRef, useState } from 'react';
import { getBattle, castBattleVote, createTokenInvoice, castFreeBattleVote } from '../api';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const VOTE_PACKS = [1, 5, 10];
const POLL_MS = 45 * 1000;

function mediaSrc(post) {
  if (!post || post.locked) return null;
  if (post.media_url) return post.media_url;
  if (post.file_id) return `${BACKEND}/api/posts/media/${post.file_id}`;
  return null;
}

function useCountdown(endsAt) {
  const [left, setLeft] = useState(() => (endsAt ? new Date(endsAt) - Date.now() : 0));
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setLeft(new Date(endsAt) - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  return left;
}

function formatLeft(ms) {
  if (ms <= 0) return 'Ending…';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m ${s % 60}s left`;
}

function Media({ post }) {
  const src = mediaSrc(post);
  if (post?.locked) {
    return (
      <div className="w-full h-48 flex flex-col items-center justify-center gap-1 bg-zinc-900 text-amber-400">
        <span className="text-3xl">🔒</span>
        <span className="text-xs font-semibold">Premium video</span>
      </div>
    );
  }
  if (!src) return <div className="w-full h-48 flex items-center justify-center bg-zinc-900 text-gray-600 text-xs">Media unavailable</div>;
  if (post.type === 'video') {
    return <video src={src} controls muted loop playsInline preload="metadata" className="w-full max-h-[320px] bg-black object-contain" />;
  }
  return <img src={src} alt={post.caption || 'battle'} className="w-full max-h-[320px] bg-black object-contain" />;
}

function Contender({ side, post, votes, total, myVotes, cost, freeLeft, busy, onVote, onFreeVote }) {
  const pct = total > 0 ? Math.round((votes / total) * 100) : 50;
  const accent = side === 'a' ? 'border-amber-500/60' : 'border-sky-500/60';
  const btn = side === 'a' ? 'bg-amber-500 text-black' : 'bg-sky-500 text-black';
  return (
    <div className={`rounded-2xl overflow-hidden bg-zinc-800/60 border ${accent}`}>
      <Media post={post} />
      <div className="p-3 flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-white text-sm font-semibold truncate">{post?.caption || `Video ${side.toUpperCase()}`}</p>
          <p className="text-gray-300 text-xs flex-shrink-0">{votes} votes · {pct}%</p>
        </div>
        {myVotes > 0 && <p className="text-xs text-green-400">You have {myVotes} vote{myVotes > 1 ? 's' : ''} here</p>}
        {freeLeft > 0 && (
          <button
            onClick={() => onFreeVote(side)}
            disabled={busy}
            className="w-full py-2 rounded-xl bg-green-600/20 border border-green-600/40 text-green-400 text-sm font-semibold disabled:opacity-50"
          >
            Free vote ({freeLeft} left)
          </button>
        )}
        <div className="grid grid-cols-3 gap-2">
          {VOTE_PACKS.map(q => (
            <button
              key={q}
              onClick={() => onVote(side, q)}
              disabled={busy}
              className={`py-2 rounded-xl text-sm font-bold disabled:opacity-50 ${btn}`}
            >
              {q > 1 ? `${q} votes` : '1 vote'}
              <span className="block text-[11px] font-semibold opacity-80">🪙 {q * cost}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BattleView({ telegramId, initData }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState('');
  const [showShop, setShowShop] = useState(false);
  const timers = useRef([]);

  function load() {
    return getBattle(telegramId)
      .then(res => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => { clearInterval(id); timers.current.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramId]);

  const current = data?.current;
  const left = useCountdown(current?.ends_at);

  // The server counts a vote only once Telegram confirms the Stars payment,
  // which can lag a moment behind the app — so re-check a couple of times.
  function refreshSoon() {
    [1500, 4000, 8000].forEach(ms => timers.current.push(setTimeout(load, ms)));
  }

  async function handleVote(side, qty) {
    const cost = qty * data.vote_cost_tokens;
    if (data.balance < cost) {
      setMsg(`You need ${cost} tokens for that — you have ${data.balance}.`);
      setShowShop(true);
      return;
    }
    setBusy(true); setMsg('');
    try {
      const res = await castBattleVote(initData, current.id, side, qty);
      setMsg(`✅ ${qty} vote${qty > 1 ? 's' : ''} counted for Video ${side.toUpperCase()}!`);
      setData(d => ({ ...d, balance: res.data.balance }));
      await load();
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Could not cast the vote.');
      if (err?.response?.data?.reason === 'insufficient') setShowShop(true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleBuy(pack) {
    if (!window.Telegram?.WebApp?.openInvoice) { setMsg('Open this inside Telegram to buy tokens.'); return; }
    setBusy(true); setMsg('');
    try {
      const res = await createTokenInvoice(initData, pack.id);
      window.Telegram.WebApp.openInvoice(res.data.invoice, status => {
        setBusy(false);
        if (status === 'paid') { setMsg('🎉 Payment received — adding your tokens…'); setShowShop(false); refreshSoon(); }
        else if (status === 'failed') setMsg('Payment failed. Please try again.');
      });
    } catch (err) {
      setBusy(false);
      setMsg(err?.response?.data?.error || 'Could not start the payment.');
    }
  }

  async function handleFreeVote(side) {
    setBusy(true); setMsg('');
    try {
      await castFreeBattleVote(initData, current.id, side);
      setMsg('✅ Vote counted!');
      await load();
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Could not cast the vote.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><p className="text-gray-500 text-sm">Loading battle...</p></div>;
  }

  const prev = data?.previous;
  const total = current ? current.votes_a + current.votes_b : 0;
  const pctA = total > 0 ? (current.votes_a / total) * 100 : 50;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3" style={{ minHeight: 0 }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-white text-lg font-bold">⚔️ Video Battle</h2>
        <button
          onClick={() => setShowShop(v => !v)}
          className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1"
        >
          <span className="text-white text-sm font-bold">🪙 {data?.balance ?? 0}</span>
          <span className="bg-amber-500 text-black text-xs font-bold rounded-full px-2 py-0.5">+ Buy</span>
        </button>
      </div>

      {showShop && (
        <div className="bg-zinc-800/70 border border-zinc-700 rounded-2xl p-3 flex flex-col gap-2">
          <p className="text-white text-sm font-semibold">Buy tokens</p>
          {(data?.packs || []).length === 0 ? (
            <p className="text-gray-500 text-xs">No packs available right now.</p>
          ) : (data.packs).map(p => (
            <button
              key={p.id}
              onClick={() => handleBuy(p)}
              disabled={busy}
              className="flex items-center justify-between bg-zinc-900 rounded-xl px-3 py-2.5 disabled:opacity-50"
            >
              <span className="text-left">
                <span className="block text-white text-sm font-semibold">🪙 {p.tokens} tokens</span>
                {data.vote_cost_tokens > 0 && (
                  <span className="block text-gray-500 text-[11px]">≈ {Math.floor(p.tokens / data.vote_cost_tokens)} votes</span>
                )}
              </span>
              <span className="bg-amber-500 text-black text-sm font-bold rounded-full px-3 py-1">⭐ {p.stars}</span>
            </button>
          ))}
          <p className="text-gray-500 text-[11px]">Each vote costs {data?.vote_cost_tokens} tokens. Tokens never expire.</p>
        </div>
      )}

      {current && (
        <div className="flex justify-end -mt-1">
          <span className="text-xs font-semibold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full">{formatLeft(left)}</span>
        </div>
      )}

      {!data?.enabled || !current ? (
        <div className="bg-zinc-800/60 rounded-2xl p-6 text-center">
          <p className="text-gray-300 text-sm">No battle is running right now.</p>
          <p className="text-gray-500 text-xs mt-1">Check back soon — a new one starts shortly.</p>
        </div>
      ) : (
        <>
          <p className="text-gray-400 text-xs">
            Back your favourite. Each vote costs 🪙 {data.vote_cost_tokens}. Voters who back the winner earn {data.winner_xp} XP when the round ends.
          </p>

          <Contender side="a" post={current.post_a} votes={current.votes_a} total={total}
            myVotes={current.my_votes_a} cost={data.vote_cost_tokens} freeLeft={current.free_votes_left}
            busy={busy} onVote={handleVote} onFreeVote={handleFreeVote} />

          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-xs font-bold">A</span>
            <div className="flex-1 h-2 rounded-full bg-sky-500/70 overflow-hidden">
              <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${pctA}%` }} />
            </div>
            <span className="text-sky-400 text-xs font-bold">B</span>
          </div>

          <Contender side="b" post={current.post_b} votes={current.votes_b} total={total}
            myVotes={current.my_votes_b} cost={data.vote_cost_tokens} freeLeft={current.free_votes_left}
            busy={busy} onVote={handleVote} onFreeVote={handleFreeVote} />

          {msg && <p className="text-center text-sm text-gray-200 bg-zinc-800 rounded-xl py-2.5 px-3">{msg}</p>}
        </>
      )}

      {prev && (
        <div className="bg-zinc-800/40 rounded-2xl p-3 text-center">
          <p className="text-gray-400 text-xs">Last battle</p>
          <p className="text-white text-sm font-semibold mt-0.5">
            {prev.winner_side
              ? `🏆 Video ${prev.winner_side.toUpperCase()} won ${Math.max(prev.votes_a, prev.votes_b)} – ${Math.min(prev.votes_a, prev.votes_b)}`
              : prev.votes_a + prev.votes_b === 0 ? 'No votes were cast' : '🤝 It was a draw'}
          </p>
          {prev.winner_post?.caption && <p className="text-gray-500 text-xs mt-0.5 truncate">{prev.winner_post.caption}</p>}
        </div>
      )}
    </div>
  );
}
