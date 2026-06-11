import React, { useState } from 'react';
import { Filter } from 'lucide-react';
import { useStore, MarketData } from '../store/useStore';

export function MarketGrid() {
  const markets = useStore((state) => state.markets);
  const settings = useStore((state) => state.settings);
  const lastLostSymbol = useStore((state) => state.lastLostSymbol);
  const isWaitingForRecovery = useStore((state) => state.isWaitingForRecovery);
  
  const [showHotOnly, setShowHotOnly] = useState(false);

  const marketList = Object.values(markets);
  
  const filteredMarkets = showHotOnly
    ? marketList.filter(m => {
        if (!m.digitCounts || m.digitCounts.length === 0) return false;
        
        const totalHistory = m.digitCounts.reduce((a, b) => a + b, 0);
        if (totalHistory === 0) return false;

        const getPct = (d: number) => (m.digitCounts![d] / totalHistory) * 100;
        const isMaxMin = (d: number) => {
          const max = Math.max(...m.digitCounts!);
          const min = Math.min(...m.digitCounts!);
          return m.digitCounts![d] === max || m.digitCounts![d] === min;
        };

        const macroOver1 = !isMaxMin(0) && !isMaxMin(1) && getPct(0) < 10 && getPct(1) < 10;
        const macroUnder8 = !isMaxMin(8) && !isMaxMin(9) && getPct(8) < 10 && getPct(9) < 10;

        return macroOver1 || macroUnder8 || lastLostSymbol === m.symbol;
      })
    : marketList;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowHotOnly(!showHotOnly)}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded border transition-colors ${showHotOnly ? 'bg-[#ffb000]/20 text-[#ffb000] border-[#ffb000]' : 'bg-[#18181b] text-[#a1a1aa] border-[#27272a] hover:text-[#e4e4e7]'}`}
        >
          <Filter size={14} />
          {showHotOnly ? 'Showing Hot Markets' : 'Filter Hot Markets'}
        </button>
      </div>
      
      {filteredMarkets.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-[#a1a1aa] border border-[#27272a] border-dashed rounded-lg bg-[#111114]">
          <Filter size={24} className="mb-2 opacity-50" />
          <p className="text-sm">No markets currently meet the hot conditions.</p>
          <p className="text-xs opacity-70 mt-1">Waiting for macro probabilities to align...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
          {filteredMarkets.map(market => (
            <MarketCard 
              key={market.symbol} 
              market={market} 
              lastLostSymbol={lastLostSymbol}
              isWaitingForRecovery={isWaitingForRecovery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const MarketCard: React.FC<{ market: MarketData, isWaitingForRecovery: boolean, lastLostSymbol: string | null }> = ({ market, lastLostSymbol, isWaitingForRecovery }) => {
  // Digit history setup
  const history = market.streakHistory.slice(-10);
  while (history.length < 10) history.unshift(-1);
  
  const inRecoveryThisSymbol = lastLostSymbol === market.symbol;

  const totalHistory = market.digitCounts?.reduce((a, b) => a + b, 0) || 0;
  const getPct = (d: number) => totalHistory === 0 ? 0 : (market.digitCounts![d] / totalHistory) * 100;
  
  let isMaxMin = (d: number) => false;
  let maxCount = 0;
  let minCount = 0;
  
  if (totalHistory > 0 && market.digitCounts) {
    maxCount = Math.max(...market.digitCounts);
    minCount = Math.min(...market.digitCounts);
    isMaxMin = (d: number) => market.digitCounts![d] === maxCount || market.digitCounts![d] === minCount;
  }

  const macroOver1 = !isMaxMin(0) && !isMaxMin(1) && getPct(0) < 10 && getPct(1) < 10;
  const macroUnder8 = !isMaxMin(8) && !isMaxMin(9) && getPct(8) < 10 && getPct(9) < 10;

  const getTransitionPct = (from: number, to: number) => {
    if (!market.transitions) return 0;
    const totalOut = market.transitions[from].reduce((a, b) => a + b, 0);
    if (totalOut === 0) return 0;
    return (market.transitions[from][to] / totalOut) * 100;
  };

  const prob5to01 = getTransitionPct(5, 0) + getTransitionPct(5, 1);
  const prob6to01 = getTransitionPct(6, 0) + getTransitionPct(6, 1);
  const over1MarkovOk = prob5to01 < 18.5 && prob6to01 < 18.5;

  const prob4to89 = getTransitionPct(4, 8) + getTransitionPct(4, 9);
  const prob7to89 = getTransitionPct(7, 8) + getTransitionPct(7, 9);
  const prob9to89 = getTransitionPct(9, 8) + getTransitionPct(9, 9);
  const under8MarkovOk = prob4to89 < 18.5 && prob7to89 < 18.5 && prob9to89 < 18.5;

  const isHot = macroOver1 || macroUnder8;

  return (
    <div className={`bg-[#111114] border rounded-lg p-4 flex flex-col gap-3 transition-colors ${inRecoveryThisSymbol ? 'border-[#ff00a0] shadow-[0_0_15px_rgba(255,0,160,0.15)]' : isHot ? 'border-[#00ff9c]/50 shadow-[0_0_15px_rgba(0,255,156,0.1)]' : 'border-[#27272a]'}`}>
      <div className="flex justify-between items-start">
        <div className="font-semibold text-[14px]">
            {market.name}
        </div>
        <div className={`text-[10px] flex items-center gap-1 ${inRecoveryThisSymbol ? 'text-[#ff00a0]' : isHot ? 'text-[#00ff9c]' : 'text-[#a1a1aa]'}`}>
          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${inRecoveryThisSymbol ? 'bg-[#ff00a0]' : isHot ? 'bg-[#00ff9c]' : 'bg-[#a1a1aa]'}`} /> 
          {inRecoveryThisSymbol ? 'RECOVERING' : isHot ? 'HOT SETUP' : 'SCANNING'}
        </div>
      </div>
      
      <div className="flex items-end gap-3">
        <div className="font-mono text-[20px] font-bold leading-none">
          {market.currentPrice === 0 ? '---.----' : market.currentPrice.toFixed(4)}
        </div>
        <div className="flex gap-0.5 flex-1 justify-end">
          {history.map((digit, i) => {
            const isEntryOver = digit === 5 || digit === 6;
            const isEntryUnder = digit === 4 || digit === 7 || digit === 9;
            if (digit === -1) return <div key={i} className="w-4 h-4 flex items-center justify-center font-mono text-[9px] rounded bg-white/5 border border-[#27272a]" />;
            return (
              <div 
                key={i} 
                className={`w-4 h-4 flex items-center justify-center font-mono text-[9px] rounded border ${isEntryOver ? 'bg-[#00ff9c]/20 text-[#00ff9c] border-[#00ff9c]' : isEntryUnder ? 'bg-[#3b82f6]/20 text-[#3b82f6] border-[#3b82f6]' : 'bg-white/5 text-[#e4e4e7] border-[#27272a]'}`}
              >
                {digit}
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-2 mt-2">
        {/* OVER 1 SETUP */}
        <div className={`p-2 rounded border flex flex-col gap-1.5 text-[10px] ${macroOver1 ? 'bg-[#00ff9c]/5 border-[#00ff9c]/30' : 'bg-[#18181b] border-[#27272a]'}`}>
          <div className="font-semibold text-[#e4e4e7] mb-0.5">OVER 1</div>
          <div className="flex justify-between">
            <span className="text-[#a1a1aa]">0 & 1 Macro:</span>
            <span className={!isMaxMin(0) && !isMaxMin(1) ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}>NOT MIN/MAX</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#a1a1aa]">Danger %:</span>
            <span className={getPct(0) < 10 && getPct(1) < 10 ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}>&lt; 10%</span>
          </div>
          <div className="flex justify-between hover:opacity-80">
            <span className="text-[#a1a1aa]" title="Transitions 5/6 to 0/1">Markov:</span>
            <span className={over1MarkovOk ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}>{over1MarkovOk ? 'OK' : 'RISK'}</span>
          </div>
        </div>

        {/* UNDER 8 SETUP */}
        <div className={`p-2 rounded border flex flex-col gap-1.5 text-[10px] ${macroUnder8 ? 'bg-[#3b82f6]/5 border-[#3b82f6]/30' : 'bg-[#18181b] border-[#27272a]'}`}>
          <div className="font-semibold text-[#e4e4e7] mb-0.5">UNDER 8</div>
          <div className="flex justify-between">
            <span className="text-[#a1a1aa]">8 & 9 Macro:</span>
            <span className={!isMaxMin(8) && !isMaxMin(9) ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}>NOT MIN/MAX</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#a1a1aa]">Danger %:</span>
            <span className={getPct(8) < 10 && getPct(9) < 10 ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}>&lt; 10%</span>
          </div>
          <div className="flex justify-between hover:opacity-80">
             <span className="text-[#a1a1aa]" title="Transitions 4/7/9 to 8/9">Markov:</span>
             <span className={under8MarkovOk ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}>{under8MarkovOk ? 'OK' : 'RISK'}</span>
          </div>
        </div>
      </div>
      
      {/* Mini Distribution Bar (replaces the 10 big circles) */}
      <div className="flex w-full h-2 mt-1 rounded overlow-hidden bg-[#27272a] gap-px">
          {Array.from({ length: 10 }).map((_, d) => {
            const count = market.digitCounts?.[d] || 0;
            const percentage = totalHistory ? (count / totalHistory) * 100 : 0;
            const isDangerOver = d === 0 || d === 1;
            const isDangerUnder = d === 8 || d === 9;
            const color = isDangerOver ? '#ff4b4b' : isDangerUnder ? '#3b82f6' : '#52525b';
            
            return (
              <div 
                key={d} 
                className="h-full first:rounded-l last:rounded-r transition-all duration-300" 
                style={{ width: `${percentage}%`, backgroundColor: color }}
                title={`Digit ${d}: ${percentage.toFixed(1)}%`}
              />
            );
          })}
      </div>
    </div>
  );
}
