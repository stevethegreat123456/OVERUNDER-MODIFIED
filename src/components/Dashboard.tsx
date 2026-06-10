import React, { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { SettingsPanel } from './SettingsPanel';
import { HistoryPanel } from './HistoryPanel';
import { MarkovVisualizer } from './MarkovVisualizer';
import { MarketGrid } from './MarketGrid';
import { TradeLog } from './TradeLog';
import { StatsPanel } from './StatsPanel';
import { useWakeLock } from '../hooks/useWakeLock';
import { io, Socket } from 'socket.io-client';

import { RefreshCw } from 'lucide-react';

export function Dashboard() {
  useWakeLock();
  
  const isInitialized = useRef<boolean>(false);
  const socketRef = useRef<Socket | null>(null);

  const [isPending, setIsPending] = React.useState(false);
  const isRunning = useStore((state) => state.isRunning);
  const setIsRunning = useStore((state) => state.setIsRunning);
  const settings = useStore((state) => state.settings);
  const sessionPnL = useStore((state) => state.sessionPnL);
  
  // Need raw store fns for the worker
  const bulkUpdateMarkets = useStore((state) => state.bulkUpdateMarkets);
  const addTrade = useStore((state) => state.addTrade);
  const updateTrade = useStore((state) => state.updateTrade);
  const incrementDigit = useStore((state) => state.incrementDigit);
  const setConnectionStatus = useStore((state) => state.setConnectionStatus);
  const setBalance = useStore((state) => state.setBalance);
  
  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on('connect', () => {
      socketRef.current?.emit('worker_command', { type: 'REQUEST_SYNC' });
    });

    socketRef.current.on('bot_sync', (data) => {
      if (data.isRunning !== undefined) {
         setIsPending(false);
         if (data.isRunning !== useStore.getState().isRunning) {
            useStore.getState().setIsRunning(data.isRunning);
         }
      }
      if (data.connectionStatus !== undefined) {
         useStore.getState().setConnectionStatus(data.connectionStatus);
      }
      if (data.lastLostSymbol !== undefined) {
         useStore.getState().setLastLostSymbol(data.lastLostSymbol);
      }
      if (data.isWaitingForRecovery !== undefined) {
         useStore.getState().setIsWaitingForRecovery(data.isWaitingForRecovery);
      }
      if (data.currentSettings !== undefined && data.currentSettings !== null) {
         const localSettings = useStore.getState().settings;
         if (JSON.stringify(localSettings) !== JSON.stringify(data.currentSettings)) {
            useStore.getState().setSettings(data.currentSettings);
         }
         isInitialized.current = true;
      }
    });

    socketRef.current.on('past_trades', (pastTrades) => {
      // Map these partial past trades into basic UI Trade objects
      // We only have the finalized properties from DB, which is exactly why the user was missing them.
      const mapped = pastTrades.map((t: any) => ({
        id: t.id,
        timestamp: t.timestamp || Date.now(), 
        market: t.market || 'R_100', 
        contractId: 0,
        buyPrice: t.buyPrice || 0,
        result: t.result,
        pnl: t.pnl,
        entryTick: t.entryTick,
        exitTick: t.exitTick,
        entryDigit: t.entryDigit,
        exitDigit: t.exitDigit,
      }));
      useStore.getState().setTradeLog(mapped);
    });

    socketRef.current.on('bot_event', (msg) => {
      if (msg.type === 'MARKET_UPDATES') {
        bulkUpdateMarkets(msg.updates);
      } else if (msg.type === 'TRADE_INIT') {
        addTrade(msg.trade);
      } else if (msg.type === 'TRADE_RESULT') {
        updateTrade(msg.id, { 
          result: msg.result, 
          pnl: msg.pnl,
          entryTick: msg.entryTick,
          exitTick: msg.exitTick,
          entryDigit: msg.entryDigit,
          exitDigit: msg.exitDigit
        });
      } else if (msg.type === 'SCHEDULE_START') {
        useStore.getState().setIsRunning(true);
      } else if (msg.type === 'SCHEDULE_STOP') {
        useStore.getState().setIsRunning(false);
      } else if (msg.type === 'LIMIT_REACHED') {
        useStore.getState().setIsRunning(false);
        const hitLimitStatus = msg.message;
        useStore.getState().saveAndResetSession();
        alert(`${hitLimitStatus} - Session automatically saved and memory flushed.`);
      } else if (msg.type === 'DIGIT_STAT') {
        incrementDigit(msg.digit);
      } else if (msg.type === 'STATUS') {
        setConnectionStatus(msg.status);
      } else if (msg.type === 'BALANCE') {
        setBalance(msg.balance);
      } else if (msg.type === 'ERROR') {
        console.error('Deriv WS Error:', msg.message);
      }
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [bulkUpdateMarkets, addTrade, updateTrade, incrementDigit, setConnectionStatus, setBalance]);

  useEffect(() => {
    const handleSettingsChange = (e: any) => {
      socketRef.current?.emit('worker_command', { type: 'UPDATE_SETTINGS', settings: e.detail });
    };
    window.addEventListener('bot_settings_changed', handleSettingsChange);
    
    return () => {
      window.removeEventListener('bot_settings_changed', handleSettingsChange);
    };
  }, []);

  const connectionStatus = useStore((state) => state.connectionStatus);
  const balance = useStore((state) => state.balance);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#09090b] text-[#e4e4e7] font-sans">
      <header className="h-[56px] sm:h-[64px] border-b border-[#27272a] bg-[#111114] px-3 sm:px-6 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto whitespace-nowrap scrollbar-hide">
          <div className="font-extrabold text-[14px] sm:text-[18px] tracking-tight text-[#00ff9c] flex items-center shrink-0">
            DERIV<span className="hidden sm:inline text-[#e4e4e7] ml-1">HF-BOT_v4</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs font-mono shrink-0">
            <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-[#00ff9c] shadow-[0_0_8px_#00ff9c]' : 'bg-[#ff4b4b]'}`} />
            <span className={`w-8 ${connectionStatus === 'connected' ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}`}>
              {connectionStatus === 'connected' ? 'CONN' : 'DISC'}
            </span>
          </div>
          {balance !== null && (
            <div className="ml-2 sm:ml-4 flex items-center font-mono tabular-nums text-[10px] sm:text-sm shrink-0">
              <span className="text-[#a1a1aa]">BAL: </span>
              <span className="text-[#e4e4e7] ml-1">${balance.toFixed(2)}</span>
              <button 
                onClick={() => socketRef.current?.emit('worker_command', { type: 'TOPUP' })}
                className="ml-2 text-[#00ff9c] hover:text-[#e4e4e7] transition-colors p-1 rounded bg-[#00ff9c]/10"
                title="Top-up Virtual Account ($10,000)"
              >
                <RefreshCw size={12} strokeWidth={3} />
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-2 sm:gap-4 items-center shrink-0 ml-2">
          <MarkovVisualizer />
          <HistoryPanel />
          <SettingsPanel />
          <button 
            disabled={isPending}
            onClick={() => {
              if (isPending) return;
              setIsPending(true);
              const nextState = !isRunning;
              if (nextState) {
                  if (!settings.apiToken) {
                      alert("API Token required for trading");
                      setIsPending(false);
                      return;
                  }
                  socketRef.current?.emit('worker_command', { type: 'START', settings, sessionPnL: useStore.getState().sessionPnL });
              } else {
                  socketRef.current?.emit('worker_command', { type: 'STOP' });
              }
            }}
            className={`px-3 py-1.5 sm:px-6 sm:py-2 rounded font-bold text-[10px] sm:text-sm transition-colors whitespace-nowrap ${isPending ? 'opacity-50 cursor-not-allowed bg-gray-500 text-white' : isRunning ? 'bg-[#ff4b4b] text-[#e4e4e7]' : 'bg-[#00ff9c] text-[#09090b]'}`}
          >
            {isPending ? '...' : isRunning ? 'HALT' : 'START'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden pb-[env(safe-area-inset-bottom)]">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3 sm:p-5">
            <MarketGrid />
          </div>
          <div className="shrink-0 h-[120px] sm:h-[140px]">
            <TradeLog />
          </div>
        </div>

        <div className="w-full lg:w-[300px] xl:w-[320px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#27272a] bg-[#111114] p-3 sm:p-5 overflow-y-auto">
          <StatsPanel />
        </div>
      </main>
    </div>
  );
}
