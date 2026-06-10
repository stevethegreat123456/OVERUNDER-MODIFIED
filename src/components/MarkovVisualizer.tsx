import React, { useState } from 'react';
import { Network, X } from 'lucide-react';
import { useStore } from '../store/useStore';

export function MarkovVisualizer() {
  const [isOpen, setIsOpen] = useState(false);
  const markets = useStore((state) => state.markets);
  const marketList = Object.values(markets);
  
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(marketList[0]?.symbol || null);

  const selectedMarket = marketList.find(m => m.symbol === selectedSymbol);

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="p-1.5 sm:p-2 text-[#a1a1aa] hover:text-[#e4e4e7] hover:bg-[#27272a] rounded transition-colors"
        title="Markov Transitions"
      >
        <Network size={16} />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#111114] border border-[#27272a] rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#27272a] shrink-0">
              <div className="flex items-center gap-2">
                <Network size={18} className="text-[#3b82f6]" />
                <h2 className="text-sm font-bold text-[#e4e4e7] uppercase tracking-wider">Markov Transitions Matrix</h2>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-[#a1a1aa] hover:text-[#e4e4e7]">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-col p-4 overflow-y-auto">
              
              <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
                {marketList.map(market => (
                  <button
                    key={market.symbol}
                    onClick={() => setSelectedSymbol(market.symbol)}
                    className={`px-3 py-1 text-xs rounded border transition-colors whitespace-nowrap ${selectedSymbol === market.symbol ? 'bg-[#3b82f6]/20 border-[#3b82f6] text-[#3b82f6]' : 'bg-[#18181b] border-[#27272a] text-[#a1a1aa] hover:text-[#e4e4e7]'}`}
                  >
                    {market.name}
                  </button>
                ))}
              </div>

              {selectedMarket && selectedMarket.transitions ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] sm:text-xs text-left border-collapse">
                    <thead>
                      <tr>
                        <th className="p-2 border border-[#27272a] bg-[#18181b] text-center text-[#a1a1aa]">From \ To</th>
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                          <th key={n} className="p-2 border border-[#27272a] bg-[#18181b] text-center text-[#e4e4e7]">{n}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedMarket.transitions.map((row, fromDigit) => {
                        const total = row.reduce((a, b) => a + b, 0);
                        return (
                          <tr key={fromDigit}>
                            <th className="p-2 border border-[#27272a] bg-[#18181b] text-center text-[#e4e4e7]">{fromDigit}</th>
                            {row.map((count, toDigit) => {
                              const pct = total === 0 ? 0 : (count / total) * 100;
                              // Highlight < 10.5% (Safe) or high risk
                              const isSafe = total > 1 && pct < 10.5;
                              const isHigh = total > 1 && pct > 20;

                              let cellColor = 'text-[#a1a1aa]';
                              let bg = '';
                              if (isSafe) {
                                cellColor = 'text-[#00ff9c] font-bold';
                                bg = 'bg-[#00ff9c]/10';
                              } else if (isHigh) {
                                cellColor = 'text-[#ff4b4b] font-bold';
                                bg = 'bg-[#ff4b4b]/10';
                              }

                              return (
                                <td key={toDigit} className={`p-2 border border-[#27272a] text-center ${cellColor} ${bg}`}>
                                  {total === 0 ? '-' : `${pct.toFixed(1)}%`}
                                  <div className="text-[9px] text-[#666] mt-0.5">{count} / {total}</div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  
                  <div className="mt-4 flex gap-4 text-[10px] text-[#a1a1aa]">
                      <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-[#00ff9c]/20 border border-[#00ff9c] rounded-full" />
                          <span>&lt; 10.5% (Safe)</span>
                      </div>
                      <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-[#ff4b4b]/20 border border-[#ff4b4b] rounded-full" />
                          <span>&gt; 20.0% (Hot)</span>
                      </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-[#a1a1aa] p-8 text-sm">
                  {selectedMarket ? 'Awaiting Markov matrix data...' : 'Select a market'}
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </>
  );
}
