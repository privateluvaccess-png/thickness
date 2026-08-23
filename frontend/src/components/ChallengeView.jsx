import React, { useEffect, useState } from 'react';
import { getMyXp, getGiftHuntStatus, claimGiftHunt, getMissionsToday, getWeeklyLeaderboard } from '../api';
import RewardedAdButton from './RewardedAdButton';

// The full game system lives here — the feed and profile stay clean
// (just a subtle Premium badge), per "don't overload the feed with
// gamification, the full system lives inside the Challenge section."
export default function ChallengeView({ telegramId }) {
  const [xp, setXp]                 = useState(null);
  const [giftHunt, setGiftHunt]     = useState(null);
  const [missions, setMissions]     = useState([]);
  const [leaderboard, setLeaderboard] = useState(null);
  const [claiming, setClaiming]     = useState(false);
  const [claimMsg, setClaimMsg]     = useState('');
  const [loading, setLoading]       = useState(true);

  function load() {
    if (!telegramId) return;
    Promise.all([
      getMyXp(telegramId).catch(() => null),
      getGiftHuntStatus(telegramId).catch(() => null),
      getMissionsToday(telegramId).catch(() => null),
      getWeeklyLeaderboard(telegramId).catch(() => null),
    ]).then(([xpRes, ghRes, mRes, lbRes]) => {
      if (xpRes) setXp(xpRes.data);
      if (ghRes) setGiftHunt(ghRes.data);
      if (mRes) setMissions(mRes.data.missions || []);
      if (lbRes) setLeaderboard(lbRes.data);
      setLoading(false);
    });
  }

  useEffect(load, [telegramId]);

  async function handleClaim() {
    setClaiming(true);
    setClaimMsg('');
    try {
      const res = await claimGiftHunt(telegramId);
      if (res.data.claimed) {
        setClaimMsg(`🎁 Gift found! +${res.data.rewardDays} day${res.data.rewardDays > 1 ? 's' : ''} Premium`);
      } else {
        setClaimMsg(res.data.reason || 'Not ready yet.');
      }
      load();
    } catch (err) {
      setClaimMsg(err?.response?.data?.error || 'Something went wrong.');
    } finally {
      setClaiming(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading challenges...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-8">

      {/* Level / XP */}
      {xp && (
        <div className="bg-zinc-900 rounded-xl px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-white font-bold text-base">⭐ Level {xp.level}</span>
            <span className="text-gray-500 text-xs">{xp.weeklyXp} XP this week</span>
          </div>
          <div className="w-full h-2 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, (xp.xpIntoLevel / xp.xpForNextLevel) * 100)}%` }}
            />
          </div>
          <span className="text-gray-500 text-xs">
            {xp.xpIntoLevel} / {xp.xpForNextLevel} XP to Level {xp.level + 1}
          </span>
          {xp.streak?.currentStreak > 0 && (
            <span className="text-amber-400 text-xs">
              🔥 {xp.streak.currentStreak} day streak (best: {xp.streak.longestStreak})
            </span>
          )}
        </div>
      )}

      {/* Rewarded Ads entry point */}
      <RewardedAdButton telegramId={telegramId} onXpRefresh={load} />

      {/* Weekly Leaderboard */}
      {leaderboard?.top?.length > 0 && (
        <div className="bg-zinc-900 rounded-xl px-4 py-3 flex flex-col gap-2">
          <span className="text-white text-base font-bold">🏆 Weekly Leaderboard</span>
          {leaderboard.top.slice(0, 3).map(row => (
            <div key={row.userId} className="flex items-center justify-between text-sm">
              <span className="text-gray-300">
                {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : '🥉'} {row.displayName}
              </span>
              <span className="text-gray-500">{row.xp.toLocaleString()} XP</span>
            </div>
          ))}
          {leaderboard.me && (
            <div className="pt-2 mt-1 border-t border-zinc-700">
              <p className="text-amber-400 text-sm font-medium">
                You — #{leaderboard.me.rank} — {leaderboard.me.xp.toLocaleString()} XP
              </p>
              {leaderboard.me.xpToThirdPlace > 0 && (
                <p className="text-gray-500 text-xs mt-0.5">
                  Only {leaderboard.me.xpToThirdPlace.toLocaleString()} XP to reach #3.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Daily Gift Hunt */}
      {giftHunt?.enabled && (
        <div className="bg-zinc-900 rounded-xl px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-white text-base font-bold">🎁 Daily Gift Hunt</span>
            <span className="text-gray-400 text-sm">{giftHunt.progress}/{giftHunt.required}</span>
          </div>
          <p className="text-gray-500 text-xs">Find today's hidden gift.</p>
          <div className="w-full h-2 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, (giftHunt.progress / giftHunt.required) * 100)}%` }}
            />
          </div>
          {giftHunt.alreadyClaimedToday ? (
            <p className="text-green-400 text-sm">✅ Claimed today — come back tomorrow!</p>
          ) : giftHunt.readyToClaim ? (
            <button
              onClick={handleClaim}
              disabled={claiming}
              className="w-full py-2.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400 text-sm font-semibold disabled:opacity-50"
            >
              {claiming ? 'Claiming...' : `Claim ${giftHunt.rewardDays}d Premium`}
            </button>
          ) : (
            <p className="text-gray-500 text-xs">
              Reward: {giftHunt.rewardDays} day{giftHunt.rewardDays > 1 ? 's' : ''} Premium
            </p>
          )}
          {claimMsg && <p className="text-gray-400 text-xs">{claimMsg}</p>}
        </div>
      )}

      {/* Daily Missions */}
      {missions.length > 0 && (
        <div className="bg-zinc-900 rounded-xl px-4 py-3 flex flex-col gap-2">
          <span className="text-white text-base font-bold">🎯 Today's Missions</span>
          {missions.map(m => (
            <div key={m.id} className="flex items-center justify-between">
              <span className={`text-sm ${m.completed ? 'text-green-400' : 'text-gray-300'}`}>
                {m.completed ? '✅' : '◻️'} {m.title}
              </span>
              <span className="text-gray-500 text-xs">
                {m.progress}/{m.requirementCount} · +{m.xpReward} XP
              </span>
            </div>
          ))}
        </div>
      )}

      {!giftHunt?.enabled && missions.length === 0 && !leaderboard?.top?.length && (
        <p className="text-gray-500 text-sm text-center mt-8">Nothing active right now — check back soon!</p>
      )}
    </div>
  );
}
