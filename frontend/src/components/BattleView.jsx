import React, { useEffect, useRef, useState } from 'react';
import { getBattle, castBattleVote, createTokenInvoice, castFreeBattleVote } from '../api';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
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

// Small preview card: shows the first frame, tap anywhere to watch full screen.
function Preview({ post, label, onWatch }) {
  const src = mediaSrc(post);
  if (post?.locked) {
    return (
      <div className="w-full h-44 flex flex-col items-center justify-center gap-1 bg-zinc-900 text-amber-400">
        <span className="text-3xl">🔒</span>
        <span className="text-xs font-semibold">Premium video</span>
      </div>
    );
  }
  if (!src) {
    return <div className="w-full h-44 flex items-center justify-center bg-zinc-900 text-gray-600 text-xs">Media unavailable</div>;
  }
  return (
    <button onClick={onWatch} className="relative block w-full h-44 bg-black" aria-label={`Watch video ${label} full screen`}>
      {post.type === 'video' ? (
        <video src={`${src}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-contain pointer-events-none" />
      ) : (
        <img src={src} alt="" className="w-full h-full object-contain pointer-events-none" />
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/20">
        <span className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center text-black text-2xl pl-1">▶</span>
      </span>
      <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[11px] font-semibold rounded-full px-2.5 py-1">
        ⛶ Full screen
      </span>
    </button>
  );
}

// Full-screen player. Closing it brings the user straight back to the vote buttons.
function FullScreenViewer({ post, label, onClose }) {
  const src = mediaSrc(post);
  return (
    <div className="fixed inset-0 z-[90] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-white text-sm font-bold">Video {label}</span>
        <button onClick={onClose} className="bg-white text-black text-sm font-bold rounded-full px-4 py-2">
          ✕ Close &amp; vote
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center min-h-0">
        {post?.type === 'video' ? (
          <video src={src} controls autoPlay playsInline loop className="max-w-full max-h-full" />
        ) : (
          <img src={src} alt="" className="max-w-full max-h-full object-contain" />
        )}
      </div>
      {post?.caption && <p className="text-gray-300 text-sm text-center px-4 py-3 truncate">{post.caption}</p>}
    </div>
  );
}

function Contender({ side, post, votes, total, myVotes, cost, freeLeft, busy, onVote, onFreeVote, onWatch }) {
  const pct = total > 0 ? Math.round((votes / total) * 100) : 50;
  const letter = side.toUpperCase();
  const accent = side === 'a' ? 'border-amber-500/60' : 'border-sky-500/60';
  const main = side === 'a' ? 'bg-amber-500 text-black' : 'bg-sky-500 text-black';
  const soft = side === 'a'
    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40'
    : 'bg-sky-500/15 text-sky-400 border border-sky-500/40';
  return (
    <div className={`rounded-2xl overflow-hidden bg-zinc-800/60 border ${accent}`}>
      <Preview post={post} label={letter} onWatch={onWatch} />
      <div className="p-3 flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-white text-sm font-semibold truncate">{post?.caption || `Video ${letter}`}</p>
          <p className="text-gray-300 text-xs flex-shrink-0">{votes} votes · {pct}%</p>
        </div>
        {myVotes > 0 && <p className="text-xs text-green-400">You have {myVotes} vote{myVotes > 1 ? 's' : ''} here</p>}

        {freeLeft > 0 && (
          <button onClick={() => onFreeVote(side)} disabled={busy}
            className="w-full py-2.5 rounded-xl bg-green-600/20 border border-green-600/40 text-green-400 text-sm font-semibold disabled:opacity-50">
            Free vote ({freeLeft} left)
          </button>
        )}

        {/* The main, obvious vote button */}
        <button onClick={() => onVote(side, 1)} disabled={busy}
          className={`w-full py-3.5 rounded-xl text-base font-extrabold disabled:opacity-50 ${main}`}>
          ❤️ Vote for Video {letter} · 🪙 {cost}
        </button>

        <div className="grid grid-cols-2 gap-2">
          {[5, 10].map(q => (
            <button key={q} onClick={() => onVote(side, q)} disabled={busy}
              className={`py-2 rounded-xl text-sm font-bold disabled:opacity-50 ${soft}`}>
              {q} votes · 🪙 {q * cost}
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
  const [watching, setWatching] = useState(null); // 'a' | 'b' | null
  const timers = useRef([]);
  const scroller = useRef(null);

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
      setMsg(`You need 🪙 ${cost} to vote — you have ${data.balance}. Pick a token pack below to top up.`);
      setShowShop(true);
      scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
    <div ref={scroller} className="flex-1 overflow-y-auto px-4 pt-4 pb-8 flex flex-col gap-3" style={{ minHeight: 0 }}>
      {watching && current && (
        <FullScreenViewer
          post={watching === 'a' ? current.post_a : current.post_b}
          label={watching.toUpperCase()}
          onClose={() => setWatching(null)}
        />
      )}
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

      {msg && (
        <p className="sticky top-0 z-10 text-center text-sm text-white bg-zinc-700 border border-zinc-600 rounded-xl py-2.5 px-3 shadow-lg">{msg}</p>
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
          <div className="bg-zinc-800/60 rounded-2xl px-3.5 py-3">
            <p className="text-white text-sm font-semibold">Vote for the video you love! 🔥</p>
            <p className="text-gray-400 text-xs mt-1">
              Tap a video to watch it full screen, then vote for your favourite. Each vote costs 🪙 {data.vote_cost_tokens}.
              Back the winner and earn {data.winner_xp} XP when the round ends.
            </p>
          </div>

          <Contender side="a" post={current.post_a} votes={current.votes_a} total={total}
            myVotes={current.my_votes_a} cost={data.vote_cost_tokens} freeLeft={current.free_votes_left}
            busy={busy} onVote={handleVote} onFreeVote={handleFreeVote} onWatch={() => setWatching('a')} />

          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-xs font-bold">A</span>
            <div className="flex-1 h-2 rounded-full bg-sky-500/70 overflow-hidden">
              <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${pctA}%` }} />
            </div>
            <span className="text-sky-400 text-xs font-bold">B</span>
          </div>

          <Contender side="b" post={current.post_b} votes={current.votes_b} total={total}
            myVotes={current.my_votes_b} cost={data.vote_cost_tokens} freeLeft={current.free_votes_left}
            busy={busy} onVote={handleVote} onFreeVote={handleFreeVote} onWatch={() => setWatching('b')} />

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
