import React from 'react';
import { useStore } from '../store/useStore';

export function StatsPanel() {
  const sessionPnL = useStore(state => state.sessionPnL);
  const wins = useStore(state => state.wins);
  const losses = useStore(state => state.losses);
  const maxConsecutiveLosses = useStore(state => state.maxConsecutiveLosses);
  const currentConsecutiveLosses = useStore(state => state.currentConsecutiveLosses);
  const saveAndResetSession = useStore(state => state.saveAndResetSession);
  const takeProfit = useStore(state => state.settings.takeProfit);
  const stopLoss = useStore(state => state.settings.stopLoss);

  const totalTrades = wins + losses;
  const winRate = totalTrades === 0 ? 0 : (wins / totalTrades) * 100;

  return (
    <div className="flex flex-col gap-5 h-full">
      <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Session Performance</div>
      
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3">
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Total PnL</div>
          <div className={`mt-1 font-mono text-[18px] font-bold ${sessionPnL >= 0 ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}`}>
             {sessionPnL >= 0 ? '+' : ''}${sessionPnL.toFixed(2)}
          </div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Win Rate</div>
          <div className="mt-1 font-mono text-[18px] font-bold text-[#e4e4e7]">{winRate.toFixed(1)}%</div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Trades</div>
          <div className="mt-1 font-mono text-[18px] font-bold text-[#e4e4e7]">{totalTrades}</div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Wins/Losses</div>
          <div className="mt-1 font-mono text-[16px] font-bold text-[#e4e4e7]"><span className="text-[#00ff9c]">{wins}</span> / <span className="text-[#ff4b4b]">{losses}</span></div>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider mb-2">Session Analytics</div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
            <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Max Cons. Losses</div>
            <div className="mt-1 font-mono text-[18px] font-bold text-[#ff4b4b]">{maxConsecutiveLosses}</div>
          </div>
          <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
            <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Current Cons. Losses</div>
            <div className="mt-1 font-mono text-[18px] font-bold text-[#ff4b4b]">{currentConsecutiveLosses}</div>
          </div>
        </div>
      </div>
      
      <div className="mt-auto border border-[#27272a] p-3 rounded text-sm bg-black/20">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#ff4b4b]">Circuit Breakers</div>
        <div className="text-xs mt-2 flex justify-between">
          <span>Take Profit</span><span className="text-[#00ff9c]">${takeProfit.toFixed(2)}</span>
        </div>
        <div className="text-xs mt-1 flex justify-between">
          <span>Stop Loss</span><span className="text-[#ff4b4b]">-${stopLoss.toFixed(2)}</span>
        </div>
      </div>

      <button 
        onClick={saveAndResetSession}
        className="w-full mt-2 py-2 text-[10px] font-mono uppercase tracking-widest text-[#a1a1aa] border border-[#27272a] rounded bg-black/20 hover:bg-[#27272a] hover:text-[#e4e4e7] transition-colors"
      >
        Save & Flush Memory
      </button>
    </div>
  );
}
