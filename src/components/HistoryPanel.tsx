import React, { useState } from 'react';
import { History, X, Trash2, Calendar, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { useStore, TradingSession } from '../store/useStore';

export function HistoryPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  
  const pastSessions = useStore(state => state.pastSessions);
  const deleteSession = useStore(state => state.deleteSession);

  const selectedSession = pastSessions.find(s => s.id === selectedSessionId);

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString(undefined, { 
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="p-1.5 sm:p-2 text-[#a1a1aa] hover:text-[#e4e4e7] hover:bg-[#27272a] rounded transition-colors"
        title="Session History"
      >
        <History size={16} />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#111114] border border-[#27272a] rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#27272a] shrink-0">
              <div className="flex items-center gap-2">
                <History size={18} className="text-[#00ff9c]" />
                <h2 className="text-sm font-bold text-[#e4e4e7] uppercase tracking-wider">Trading History Archives</h2>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-[#a1a1aa] hover:text-[#e4e4e7]">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              
              {/* Left sidebar: Session List */}
              <div className="w-full md:w-80 border-r border-[#27272a] overflow-y-auto flex flex-col shrink-0">
                {pastSessions.length === 0 ? (
                   <div className="p-8 text-center text-[#a1a1aa] text-xs">No saved sessions yet. <br/>Click 'Save & Flush Memory' in stats to save a session.</div>
                ) : (
                  pastSessions.map((session: TradingSession) => (
                    <div 
                      key={session.id} 
                      onClick={() => setSelectedSessionId(session.id)}
                      className={`p-3 border-b border-[#27272a] cursor-pointer transition-colors hover:bg-black/40 group ${selectedSessionId === session.id ? 'bg-[#27272a]/50 border-l-4 border-l-[#00ff9c]' : 'border-l-4 border-l-transparent'}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="text-[10px] font-mono text-[#a1a1aa] flex items-center gap-1"><Clock size={10} /> {formatTime(session.timestamp)}</div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteSession(session.id); if(selectedSessionId===session.id) setSelectedSessionId(null); }}
                          className="opacity-0 group-hover:opacity-100 text-[#ff4b4b] hover:text-red-400 p-1"
                        ><Trash2 size={12}/></button>
                      </div>
                      <div className="flex justify-between items-end">
                        <div className={`text-base font-bold font-mono ${session.pnl >= 0 ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}`}>
                          {session.pnl >= 0 ? '+' : ''}${session.pnl.toFixed(2)}
                        </div>
                        <div className="text-[10px] font-mono tracking-wider">
                           <span className="text-[#00ff9c]">{session.wins}W</span> / <span className="text-[#ff4b4b]">{session.losses}L</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Right area: Details */}
              <div className="flex-1 bg-black/20 overflow-y-auto p-4">
                {!selectedSession ? (
                  <div className="w-full h-full flex items-center justify-center text-[#a1a1aa] text-sm italic">
                    Select a session from the list to view its deep trade log.
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="flex gap-4 mb-6">
                      <div className="flex-1 bg-[#111114] border border-[#27272a] rounded p-4">
                        <div className="text-[10px] text-[#a1a1aa] uppercase tracking-wider mb-1 flex items-center gap-1"><TrendingUp size={12}/> Net PnL</div>
                        <div className={`text-2xl font-bold font-mono ${selectedSession.pnl >= 0 ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}`}>
                          {selectedSession.pnl >= 0 ? '+' : ''}${selectedSession.pnl.toFixed(2)}
                        </div>
                      </div>
                      <div className="flex-1 bg-[#111114] border border-[#27272a] rounded p-4">
                        <div className="text-[10px] text-[#a1a1aa] uppercase tracking-wider mb-1 flex items-center gap-1"><Calendar size={12}/> Total Trades</div>
                        <div className="text-2xl font-bold font-mono text-[#e4e4e7]">
                          {selectedSession.wins + selectedSession.losses}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 bg-[#111114] border border-[#27272a] rounded overflow-hidden flex flex-col">
                      <div className="p-3 border-b border-[#27272a] text-[10px] uppercase font-bold tracking-widest text-[#a1a1aa] bg-[#09090b]">
                        Raw Trade Ledger
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        <table className="w-full text-left font-mono text-[10px] sm:text-xs">
                          <thead className="sticky top-0 bg-[#09090b] shadow-md z-10">
                            <tr className="text-[#a1a1aa]">
                              <th className="py-2 px-3 font-normal">Time</th>
                              <th className="py-2 px-3 font-normal">Market</th>
                              <th className="py-2 px-3 font-normal">Stake</th>
                              <th className="py-2 px-3 font-normal">Exit</th>
                              <th className="py-2 px-3 font-normal text-right">PnL</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedSession.tradeLog.map((trade) => (
                              <tr key={trade.id} className="border-b border-[#27272a]/50 hover:bg-[#27272a]/30">
                                <td className="py-2 px-3 text-[#a1a1aa]">
                                  {new Date(trade.timestamp).toLocaleTimeString(undefined, {
                                    hour12: false,
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                  })}
                                </td>
                                <td className="py-2 px-3">{trade.market}</td>
                                <td className="py-2 px-3">${trade.buyPrice.toFixed(2)}</td>
                                <td className="py-2 px-3 text-[#a1a1aa]">{trade.exitDigit !== undefined ? trade.exitDigit : '-'}</td>
                                <td className={`py-2 px-3 text-right font-bold ${trade.result === 'won' ? 'text-[#00ff9c]' : trade.result === 'lost' ? 'text-[#ff4b4b]' : 'text-yellow-400'}`}>
                                  {trade.result === 'pending' ? '...' : `${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}`}
                                </td>
                              </tr>
                            ))}
                            {selectedSession.tradeLog.length === 0 && (
                              <tr>
                                <td colSpan={5} className="py-8 text-center text-[#a1a1aa] italic">No trades recorded in this session.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}
    </>
  );
}
