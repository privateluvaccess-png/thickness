import React, { useEffect, useState } from 'react';
import { getGiftHuntStatus, claimGiftHunt, getMissionsToday } from '../api';

// All progress numbers here come straight from the server — nothing
// is computed or trusted client-side. Tapping "Claim" doesn't grant
// anything itself; it just asks the backend to check (again,
// server-side) whether the user has actually earned it.
export default function ChallengesSection({ telegramId, onReward }) {
  const [giftHunt, setGiftHunt] = useState(null);
  const [missions, setMissions] = useState([]);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState('');

  function load() {
    if (!telegramId) return;
    getGiftHuntStatus(telegramId).then(res => setGiftHunt(res.data)).catch(() => {});
    getMissionsToday(telegramId).then(res => setMissions(res.data.missions || [])).catch(() => {});
  }

  useEffect(load, [telegramId]);

  async function handleClaim() {
    setClaiming(true);
    setClaimMsg('');
    try {
      const res = await claimGiftHunt(telegramId);
      if (res.data.claimed) {
        setClaimMsg(`🎁 Gift found! +${res.data.rewardDays} day${res.data.rewardDays > 1 ? 's' : ''} Premium`);
        onReward?.();
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

  if (!giftHunt && missions.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {giftHunt?.enabled && (
        <div className="bg-zinc-800 rounded-xl px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-white text-sm font-semibold">🎁 Daily Gift Hunt</span>
            <span className="text-gray-400 text-xs">{giftHunt.progress}/{giftHunt.required}</span>
          </div>
          <div className="w-full h-2 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, (giftHunt.progress / giftHunt.required) * 100)}%` }}
            />
          </div>
          {giftHunt.alreadyClaimedToday ? (
            <p className="text-green-400 text-xs">✅ Claimed today — come back tomorrow!</p>
          ) : giftHunt.readyToClaim ? (
            <button
              onClick={handleClaim}
              disabled={claiming}
              className="w-full py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400 text-sm font-semibold disabled:opacity-50"
            >
              {claiming ? 'Claiming...' : `Claim ${giftHunt.rewardDays}d Premium`}
            </button>
          ) : (
            <p className="text-gray-500 text-xs">Reward: {giftHunt.rewardDays} day{giftHunt.rewardDays > 1 ? 's' : ''} Premium</p>
          )}
          {claimMsg && <p className="text-gray-400 text-xs">{claimMsg}</p>}
        </div>
      )}

      {missions.length > 0 && (
        <div className="bg-zinc-800 rounded-xl px-4 py-3 flex flex-col gap-2">
          <span className="text-white text-sm font-semibold">🎯 Today's Missions</span>
          {missions.map(m => (
            <div key={m.id} className="flex items-center justify-between">
              <span className={`text-xs ${m.completed ? 'text-green-400' : 'text-gray-300'}`}>
                {m.completed ? '✅' : '◻️'} {m.title}
              </span>
              <span className="text-gray-500 text-xs">
                {m.progress}/{m.requirementCount} · +{m.xpReward} XP
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
