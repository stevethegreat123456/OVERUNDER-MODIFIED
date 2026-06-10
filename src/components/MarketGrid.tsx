import React from 'react';
import { useStore, MarketData } from '../store/useStore';

export function MarketGrid() {
  const markets = useStore((state) => state.markets);
  const settings = useStore((state) => state.settings);
  const lastLostSymbol = useStore((state) => state.lastLostSymbol);
  const isWaitingForRecovery = useStore((state) => state.isWaitingForRecovery);
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
      {Object.values(markets).map(market => (
        <MarketCard 
          key={market.symbol} 
          market={market} 
          targetStreak={settings.targetStreak} 
          lastLostSymbol={lastLostSymbol}
          isWaitingForRecovery={isWaitingForRecovery}
        />
      ))}
    </div>
  );
}

const MarketCard: React.FC<{ market: MarketData, targetStreak: number, lastLostSymbol: string | null, isWaitingForRecovery: boolean }> = ({ market, targetStreak, lastLostSymbol, isWaitingForRecovery }) => {
  // Render digit history boxes
  const history = market.streakHistory.slice(-10);
  while (history.length < 10) history.unshift(-1); // Pad with -1 or empty
  
  const maxStreak = Math.max(market.overStreak, market.underStreak);
  const isCloseToTarget = maxStreak >= targetStreak - 1 && maxStreak < targetStreak;
  const isTargetMet = maxStreak >= targetStreak;
  const inRecoveryThisSymbol = isWaitingForRecovery && lastLostSymbol === market.symbol;

  return (
    <div className={`bg-[#111114] border rounded-lg p-4 flex flex-col gap-3 transition-colors ${isCloseToTarget ? 'border-[#ffb000]/50 shadow-[0_0_15px_rgba(255,176,0,0.1)]' : isTargetMet ? 'border-[#ff4b4b] shadow-[0_0_15px_rgba(255,75,75,0.2)]' : 'border-[#27272a]'}`}>
      <div className="flex justify-between items-start">
        <div className="font-semibold text-[14px]">
            {market.name}
            {inRecoveryThisSymbol && (
              <span className="ml-2 text-[10px] bg-[#ff4b4b]/20 text-[#ff4b4b] px-1.5 py-0.5 rounded font-mono uppercase">
                Recovery Target
              </span>
            )}
        </div>
        <div className="text-[10px] text-[#00ff9c] flex items-center gap-1">
          <div className="w-1.5 h-1.5 bg-[#00ff9c] rounded-full animate-pulse" /> SCANNING
        </div>
      </div>
      
      <div className="font-mono text-[20px] font-bold">
        {market.currentPrice === 0 ? '---.----' : market.currentPrice.toFixed(4)}
      </div>
      
      <div className="flex gap-1 mt-1 flex-wrap">
        {history.map((digit, i) => {
          const isOverHighlight = digit === 0 || digit === 1;
          const isUnderHighlight = digit === 8 || digit === 9;
          
          if (digit === -1) return <div key={i} className="w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center font-mono text-[10px] sm:text-[12px] rounded bg-white/5 border border-[#27272a]" />;
          return (
            <div 
              key={i} 
              className={`w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center font-mono text-[10px] sm:text-[12px] rounded border ${isOverHighlight ? 'bg-[#ff4b4b]/20 text-[#ff4b4b] border-[#ff4b4b]' : isUnderHighlight ? 'bg-[#3b82f6]/20 text-[#3b82f6] border-[#3b82f6]' : 'bg-white/5 border-[#27272a]'}`}
            >
              {digit}
            </div>
          );
        })}
      </div>
      
      <div className="grid grid-cols-5 gap-2 mt-4">
        {Array.from({ length: 10 }).map((_, digit) => {
          const counts = market.digitCounts || Array(10).fill(0);
          const count = counts[digit];
          const total = counts.reduce((a, b) => a + b, 0) || 1;
          const percentage = ((count / total) * 100).toFixed(1);
          
          // Only calculate max/min if we have meaningful data
          const hasData = total > 1;
          const maxCount = hasData ? Math.max(...counts) : 0;
          const minCount = hasData ? Math.min(...counts) : 0;
          
          const isMax = hasData && count === maxCount;
          const isMin = hasData && count === minCount;
          
          // Determine styles
          let circleStyle = 'border-[#27272a] text-[#e4e4e7]';
          if (isMax) circleStyle = 'border-[#eab308] border-2 shadow-[0_0_8px_rgba(234,179,8,0.4)] text-[#eab308] font-bold';
          if (isMin) circleStyle = 'border-[#ef4444] border-2 shadow-[0_0_8px_rgba(239,68,68,0.4)] text-[#ef4444] font-bold';

          return (
            <div key={digit} className={`flex flex-col items-center justify-between gap-1 bg-[#18181b] p-1.5 rounded-lg border ${isMax ? 'border-[#eab308]/30' : isMin ? 'border-[#ef4444]/30' : 'border-[#27272a]'}`}>
              <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-[#27272a] flex items-center justify-center font-mono text-[12px] sm:text-[14px] ${circleStyle}`}>
                {digit}
              </div>
              <div className="w-full flex flex-col gap-1 mt-0.5">
                <div className="w-full h-1 bg-[#27272a] rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${isMax ? 'bg-[#eab308]' : isMin ? 'bg-[#ef4444]' : 'bg-[#00ff9c]/50'}`} 
                    style={{ width: `${percentage}%` }} 
                  />
                </div>
                <div className={`text-center text-[9px] sm:text-[10px] font-mono ${isMax ? 'text-[#eab308]' : isMin ? 'text-[#ef4444]' : 'text-[#00ff9c]'}`} title={`${count} ticks`}>
                  {percentage}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
