import { Server } from "socket.io";
import WebSocket from "ws";
import { getSupabase } from "./supabase.ts";

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
const HISTORY_SIZE = 1000;

interface MarketState {
  symbol: string;
  price: number;
  digit: number;
  overStreak: number;
  underStreak: number;
  history: Int8Array;
  historyIndex: number;
  digitCounts: number[];
  transitions: number[][];
  precompiledPrefix: string;
  precompiledSuffix: string;
}

const markets = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V', 'JD10', 'JD25', 'JD50', 'JD75', 'JD100', 'RDBEAR', 'RDBULL'];
const marketStates: Record<string, MarketState> = {};

markets.forEach(symbol => {
  marketStates[symbol] = {
    symbol,
    price: 0,
    digit: 0,
    overStreak: 0,
    underStreak: 0,
    history: new Int8Array(HISTORY_SIZE).fill(-1),
    historyIndex: 0,
    digitCounts: Array(10).fill(0),
    transitions: Array(10).fill(0).map(() => Array(10).fill(0)),
    precompiledPrefix: `{"buy":1,"price":`,
    precompiledSuffix: `,"basis":"stake","contract_type":"DIGITOVER","currency":"USD","duration":1,"duration_unit":"t","symbol":"${symbol}","barrier":"1"},"req_id":`
  };
});

let ws: WebSocket | null = null;
let isRunning = false;
let currentSettings: any = null;
let currentBalance = 0;

let globalCurrentStake = 1;
let isTradeActive = false;
let sessionPnL = 0;
let lastLostSymbol: string | null = null;
let lastLostTradeType: 'OVER' | 'UNDER' | 'DIFF' | null = null;
let cumulativeLoss = 0;
let recoveryTier = 0;
let stopScheduledAndWaitingForRecovery = false;
let deadlockTimeoutId: any = null;
let lastTradeAttemptTime = 0; // Added to prevent concurrent signal processing

let expectedCallbacks = 0;
let batchPnL = 0;
let batchSymbol: string | null = null;

let pendingUpdates: Record<string, any> = {};
let batchTimeout: any = null;

let pendingContracts: Record<number, { customId: string, symbol: string, type: 'OVER' | 'UNDER' | null, barrier: string | null, stake: number, timestamp: number }> = {}; 
let reqIdToSymbol: Record<number, string> = {};

interface LocalTrade {
  reqIdStr: string;
  symbol: string;
  type: 'OVER' | 'UNDER';
  barrier: string;
  stake: number;
  startEpoch: number | null;
  resolved: boolean;
}
let localTradesTracker: Record<string, LocalTrade> = {};

let pingInterval: any = null;
let reqIdCounter = Date.now();

let ioServer: Server | null = null;

async function saveSettings(settings: any) {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('bot_data').upsert({ id: 'settings', data: settings, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error('Error saving settings:', err);
  }
}

let lastStateSaveTime = 0;
async function saveState(force = false) {
  try {
    const now = Date.now();
    if (!force && now - lastStateSaveTime < 2000) return;
    lastStateSaveTime = now;
    
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('bot_data').upsert({
      id: 'state',
      data: {
        isRunning,
        globalCurrentStake,
        sessionPnL,
        cumulativeLoss,
        lastLostSymbol: lastLostSymbol || null,
      },
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error saving state:', err);
  }
}

function postMessage(event: any) {
  if (ioServer) {
    ioServer.emit('bot_event', event);
  }
  
  if (event && event.type === 'TRADE_RESULT') {
    saveTrade(event);
  }
}

async function saveTrade(tradeEvent: any) {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.from('bot_trades').upsert({
      id: tradeEvent.id,
      market: tradeEvent.market || 'UNKNOWN',
      buy_price: tradeEvent.buyPrice || 0,
      timestamp: tradeEvent.timestamp || Date.now(),
      result: tradeEvent.result,
      pnl: tradeEvent.pnl,
      entry_tick: tradeEvent.entryTick,
      exit_tick: tradeEvent.exitTick,
      entry_digit: tradeEvent.entryDigit,
      exit_digit: tradeEvent.exitDigit,
      trade_type: tradeEvent.tradeType,
      barrier: tradeEvent.barrier,
      created_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) {
      console.error('Supabase error saving trade:', error);
    }
  } catch (err) {
    console.error('Error saving trade:', err);
  }
}

let lastCheckedMinute: string | null = null;
const scheduleInterval = setInterval(() => {
  if (!currentSettings || !currentSettings.useSchedule) return;

  const now = new Date();
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  const current = `${hh}:${mm}`;

  if (lastCheckedMinute !== current) {
    lastCheckedMinute = current;

    if (currentSettings.startTime && current === currentSettings.startTime) {
      if (!isRunning) {
        isRunning = true;
        globalCurrentStake = currentSettings.globalStake || 1;
        cumulativeLoss = 0;
        stopScheduledAndWaitingForRecovery = false;
        isTradeActive = false;
        lastLostSymbol = null;
        markets.forEach(m => { marketStates[m].overStreak = 0; marketStates[m].underStreak = 0; });
        connect();
        postMessage({ type: 'SCHEDULE_START' });
      }
    }

    if (currentSettings.stopTime && current === currentSettings.stopTime) {
      if (isRunning) {
        if (cumulativeLoss > 0) {
          stopScheduledAndWaitingForRecovery = true;
        } else {
          isRunning = false;
          markets.forEach(m => { marketStates[m].overStreak = 0; marketStates[m].underStreak = 0; });
          postMessage({ type: 'SCHEDULE_STOP' });
        }
      }
    }
  }
}, 1000);

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send('{"ping":1}');
      }
    }, 10000);

    if (currentSettings?.apiToken) {
      ws.send(JSON.stringify({ authorize: currentSettings.apiToken }));
    } else {
      postMessage({ type: 'STATUS', status: 'connected' });
      subscribeToTicks();
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket Error:', err);
    postMessage({ type: 'ERROR', message: `WS Error: ${err.message}` });
  });

  ws.on('message', (messageBuffer) => {
    let data;
    try {
      data = JSON.parse(messageBuffer.toString());
    } catch (e) {
      console.error('Invalid JSON from WS:', e);
      return;
    }

    if (data.error) {
      postMessage({ type: 'ERROR', message: data.error.message });
      if (data.echo_req && data.echo_req.req_id) {
         const reqId = data.echo_req.req_id;
         if (reqIdToSymbol[reqId]) {
           delete reqIdToSymbol[reqId];
           isTradeActive = false;
           expectedCallbacks = 0;
           if (deadlockTimeoutId) {
             clearTimeout(deadlockTimeoutId);
             deadlockTimeoutId = null;
           }
         }
      }
      return;
    }

    if (data.msg_type === 'authorize') {
      postMessage({ type: 'STATUS', status: 'connected' });
      if (data.authorize && data.authorize.balance) {
        currentBalance = data.authorize.balance;
      }
      ws?.send('{"balance":1,"subscribe":1}');
      subscribeToTicks();
      ws?.send('{"proposal_open_contract":1,"subscribe":1}');
    }

    if (data.msg_type === 'balance') {
      currentBalance = data.balance.balance;
      postMessage({ type: 'BALANCE', balance: data.balance.balance });
    }

    if (data.msg_type === 'history') {
      handleHistory(data.history, data.echo_req.ticks_history, data.pip_size);
    }

    if (data.msg_type === 'tick') {
      handleTick(data.tick);
    }

    if (data.msg_type === 'buy') {
      handleBuy(data.buy, data.echo_req);
    }

    if (data.msg_type === 'proposal_open_contract') {
      handleContractUpdate(data.proposal_open_contract);
    }

    if (data.msg_type === 'topup_virtual') {
      ws?.send('{"balance":1}');
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    postMessage({ type: 'STATUS', status: 'disconnected' });
    if (isRunning) {
      setTimeout(connect, 2000);
    }
  });
}

function subscribeToTicks() {
  markets.forEach(symbol => {
    ws?.send(JSON.stringify({ 
      ticks_history: symbol,
      end: 'latest',
      count: HISTORY_SIZE,
      style: 'ticks',
      subscribe: 1 
    }));
  });
}

function handleHistory(historyData: any, symbol: string, pipSizeRaw: number) {
  const state = marketStates[symbol];
  if (!state) return;

  const prices = historyData.prices;
  if (!prices || !Array.isArray(prices)) return;

  const pipSize = pipSizeRaw || 4;
  
  state.history.fill(-1);
  state.digitCounts.fill(0);
  state.historyIndex = 0;
  
  let overStreak = 0;
  let underStreak = 0;

  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    const digit = Math.round(price * Math.pow(10, pipSize)) % 10;
    
    const oldestDigit = state.history[state.historyIndex];
    const oldestNext = state.history[(state.historyIndex + 1) % HISTORY_SIZE];
    if (oldestDigit !== -1 && oldestNext !== -1) {
      state.transitions[oldestDigit][oldestNext]--;
    }
    const prevMostRecent = state.history[(state.historyIndex - 1 + HISTORY_SIZE) % HISTORY_SIZE];
    if (prevMostRecent !== -1) {
      state.transitions[prevMostRecent][digit]++;
    }

    if (oldestDigit !== -1) {
      state.digitCounts[oldestDigit]--;
    }
    state.digitCounts[digit]++;
    
    if (digit === 0 || digit === 1) {
      overStreak += 1;
    } else {
      overStreak = 0;
    }

    if (digit === 8 || digit === 9) {
      underStreak += 1;
    } else {
      underStreak = 0;
    }

    state.history[state.historyIndex] = digit;
    state.historyIndex = (state.historyIndex + 1) % HISTORY_SIZE;
    
    if (i === prices.length - 1) {
       state.price = price;
       state.digit = digit;
    }
  }

  state.overStreak = overStreak;
  state.underStreak = underStreak;

  queueUpdate(symbol, state);
}

function handleTick(tickInfo: any) {
  const symbol = tickInfo.symbol;
  const state = marketStates[symbol];
  if (!state) return;

  const price = tickInfo.quote;
  const pipSize = tickInfo.pip_size || 4;
  const digit = Math.round(price * Math.pow(10, pipSize)) % 10;

  // Perform immediate local resolution
  for (const reqIdStr in localTradesTracker) {
    const lt = localTradesTracker[reqIdStr];
    if (!lt.resolved && lt.symbol === symbol && lt.startEpoch && tickInfo.epoch > lt.startEpoch) {
      lt.resolved = true;
      const exitDigit = digit;
      let isWin = false;
      const barrierNum = parseInt(lt.barrier, 10);
      if (lt.type === 'OVER' && exitDigit > barrierNum) isWin = true;
      if (lt.type === 'UNDER' && exitDigit < barrierNum) isWin = true;
      if (lt.type === 'DIFF' && exitDigit !== barrierNum) isWin = true;

      expectedCallbacks = 0;
      if (deadlockTimeoutId) {
        clearTimeout(deadlockTimeoutId);
        deadlockTimeoutId = null;
      }

      if (isWin) {
         let estProfit = 0;
         if (lt.type === 'DIFF') estProfit = lt.stake * 0.09;
         else if (lt.type === 'OVER' && barrierNum === 1) estProfit = lt.stake * 0.23;
         else if (lt.type === 'UNDER' && barrierNum === 8) estProfit = lt.stake * 0.23;
         else if (lt.type === 'OVER' && barrierNum === 4) estProfit = lt.stake * 0.95;
         else if (lt.type === 'UNDER' && barrierNum === 5) estProfit = lt.stake * 0.95;
         else estProfit = lt.stake * 0.95; 

         cumulativeLoss -= estProfit;

         if (cumulativeLoss <= 0) {
             cumulativeLoss = 0;
             recoveryTier = 0;
             globalCurrentStake = currentSettings?.globalStake || 1;
             lastLostSymbol = null;
             lastLostTradeType = null;
             
             if (stopScheduledAndWaitingForRecovery) {
               isRunning = false;
               stopScheduledAndWaitingForRecovery = false;
               markets.forEach(m => { marketStates[m].overStreak = 0; marketStates[m].underStreak = 0; });
               postMessage({ type: 'SCHEDULE_STOP' });
             }
         } else {
             recoveryTier += 1;
             let payoutRate = 0.95; 
             globalCurrentStake = Math.max(currentSettings?.globalStake || 1, cumulativeLoss / payoutRate);
             globalCurrentStake = Math.max(0.35, Math.floor(globalCurrentStake * 100) / 100);
         }
         isTradeActive = false;
      } else {
         cumulativeLoss += lt.stake;
         recoveryTier += 1;
         
         if (lt.type === 'OVER' && barrierNum === 1) lastLostTradeType = 'OVER';
         else if (lt.type === 'UNDER' && barrierNum === 8) lastLostTradeType = 'UNDER';
         
         let targetPayoutRate = 0.95; 
         globalCurrentStake = Math.max(currentSettings?.globalStake || 1, cumulativeLoss / targetPayoutRate);
         globalCurrentStake = Math.max(0.35, Math.floor(globalCurrentStake * 100) / 100);

         lastLostSymbol = symbol;
         isTradeActive = false;
      }
    }
  }

  state.price = price;
  state.digit = digit;

  postMessage({ type: 'DIGIT_STAT', digit });

  const oldestDigit = state.history[state.historyIndex];
  const oldestNext = state.history[(state.historyIndex + 1) % HISTORY_SIZE];
  if (oldestDigit !== -1 && oldestNext !== -1) {
    state.transitions[oldestDigit][oldestNext]--;
  }
  const prevMostRecent = state.history[(state.historyIndex - 1 + HISTORY_SIZE) % HISTORY_SIZE];
  if (prevMostRecent !== -1) {
    state.transitions[prevMostRecent][digit]++;
  }

  if (oldestDigit !== -1) {
    state.digitCounts[oldestDigit]--;
  }
  state.digitCounts[digit]++;

  if (digit === 0 || digit === 1) {
    state.overStreak += 1;
  } else {
    state.overStreak = 0;
  }

  if (digit === 8 || digit === 9) {
    state.underStreak += 1;
  } else {
    state.underStreak = 0;
  }

  state.history[state.historyIndex] = digit;
  state.historyIndex = (state.historyIndex + 1) % HISTORY_SIZE;

  queueUpdate(symbol, state);

  if (isRunning && currentSettings) {
    const now = Date.now();
    if (!isTradeActive && (now - lastTradeAttemptTime > 1000)) {
      if (cumulativeLoss > 0 && lastLostSymbol === symbol) {
        // Immediate recovery entry on every tick
        isTradeActive = true;
        lastTradeAttemptTime = now;
        if (lastLostTradeType === 'UNDER') {
          executeBuy(symbol, 'OVER', '4');
        } else {
          executeBuy(symbol, 'UNDER', '5');
        }
      } else if (cumulativeLoss === 0 && !stopScheduledAndWaitingForRecovery) {
        let totalCounts = state.digitCounts.reduce((a, b) => a + b, 0);
        let hasData = totalCounts > 1;
        let maxCount = hasData ? Math.max(...state.digitCounts) : 0;
        let minCount = hasData ? Math.min(...state.digitCounts) : 0;

        let isMaxMin = (d: number) => {
          if (!hasData) return false;
          let c = state.digitCounts[d];
          return c === maxCount || c === minCount;
        };

        let getPct = (d: number) => {
          if (!hasData || totalCounts === 0) return 0;
          return (state.digitCounts[d] / totalCounts) * 100;
        };

        let getTransitionPct = (from: number, to: number) => {
          let totalOut = state.transitions[from].reduce((a, b) => a + b, 0);
          if (totalOut === 0) return 0;
          return (state.transitions[from][to] / totalOut) * 100;
        };

        let macroOver1 = !isMaxMin(0) && !isMaxMin(1) && getPct(0) < 10 && getPct(1) < 10;
        let macroUnder8 = !isMaxMin(8) && !isMaxMin(9) && getPct(8) < 10 && getPct(9) < 10;

        let probNext01 = getTransitionPct(digit, 0) + getTransitionPct(digit, 1);
        let probNext89 = getTransitionPct(digit, 8) + getTransitionPct(digit, 9);

        let canOver1 = macroOver1 && (digit === 5 || digit === 6) && getPct(digit) < 10.5 && probNext01 < 15.5;
        let canUnder8 = macroUnder8 && (digit === 4 || digit === 7 || digit === 9) && getPct(digit) < 10.5 && probNext89 < 15.5;

        if (canOver1) {
          isTradeActive = true;
          lastTradeAttemptTime = now;
          executeBuy(symbol, 'OVER', '1');
        } else if (canUnder8) {
          isTradeActive = true;
          lastTradeAttemptTime = now;
          executeBuy(symbol, 'UNDER', '8');
        }
      }
    }
  }
}

function queueUpdate(symbol: string, state: MarketState) {
  // Only send the last 10 digits for the mini UI history to save bandwidth
  const smallHistorySize = 10;
  const miniHistory = new Array(smallHistorySize);
  const startIndex = (state.historyIndex - smallHistorySize + HISTORY_SIZE) % HISTORY_SIZE;
  for (let i = 0; i < smallHistorySize; i++) {
    miniHistory[i] = state.history[(startIndex + i) % HISTORY_SIZE];
  }

  pendingUpdates[symbol] = {
    currentPrice: state.price,
    currentDigit: state.digit,
    overStreak: state.overStreak,
    underStreak: state.underStreak,
    streakHistory: miniHistory,
    digitCounts: [...state.digitCounts],
    transitions: state.transitions.map(row => [...row])
  };

  if (!batchTimeout) {
    batchTimeout = setTimeout(() => {
      postMessage({ type: 'MARKET_UPDATES', updates: pendingUpdates });
      pendingUpdates = {};
      batchTimeout = null;
    }, 250);
  }
}

function executeBuyDynamicDiffers(symbol: string, targetDigit: number) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!currentSettings || !currentSettings.apiToken) return;

  const reqId = reqIdCounter++;
  
  const riskPercent = currentSettings.riskPercentage || 5;
  // Risk EXACTLY the risk percentage of the current working bankroll
  let stake = currentBalance * (riskPercent / 100);
  stake = Math.max(0.35, Math.floor(stake * 100) / 100);
  
  // Track globally for UI fallback
  globalCurrentStake = stake;

  expectedCallbacks = 1;
  batchPnL = 0;
  batchSymbol = symbol;

  const reqIdStr = reqId.toString();
  reqIdToSymbol[reqId] = symbol;

  localTradesTracker[reqIdStr] = {
    reqIdStr,
    symbol,
    type: 'DIFF',
    barrier: targetDigit.toString(),
    stake,
    startEpoch: null,
    resolved: false
  };

  const rawPayloadString = `{"buy":1,"price":${stake.toFixed(2)},"parameters":{"amount":${stake.toFixed(2)},"basis":"stake","contract_type":"DIGITDIFF","currency":"USD","duration":1,"duration_unit":"t","symbol":"${symbol}","barrier":"${targetDigit}"},"req_id":${reqId}}`;
  
  ws.send(rawPayloadString);

  postMessage({
    type: 'TRADE_INIT',
    trade: {
      id: reqId.toString(),
      timestamp: Date.now(),
      market: symbol,
      contractId: 0,
      buyPrice: stake,
      result: 'pending',
      pnl: 0,
      tradeType: 'DIFF',
      barrier: targetDigit.toString(),
      entryDigit: targetDigit
    }
  });

  if (deadlockTimeoutId) {
    clearTimeout(deadlockTimeoutId);
    deadlockTimeoutId = null;
  }

  deadlockTimeoutId = setTimeout(() => {
    if (!isTradeActive) return;
    
    // Deadlock triggered: no response for 10s. Treat as loss.
    const customId = reqId.toString();
    const pnl = -stake;
    
    postMessage({
      type: 'TRADE_RESULT',
      id: customId,
      market: batchSymbol || 'UNKNOWN',
      buyPrice: stake,
      timestamp: Date.now(),
      result: 'lost',
      pnl: pnl,
      entryTick: 'TIMEOUT',
      exitTick: 'TIMEOUT'
    });

    isTradeActive = false;
    sessionPnL += pnl;
    
    if (currentSettings && isRunning) {
      if (sessionPnL <= -currentSettings.stopLoss) {
        isRunning = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
      }
    }
  }, 10000);
}

function executeBuy(symbol: string, tradeType: 'OVER' | 'UNDER', barrier: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!currentSettings || !currentSettings.apiToken) return;

  const reqId = reqIdCounter++;
  const stake = Math.max(0.35, Math.floor(globalCurrentStake * 100) / 100);

  expectedCallbacks = 1;
  batchPnL = 0;
  batchSymbol = symbol;
  
  reqIdToSymbol[reqId] = symbol;

  localTradesTracker[reqId.toString()] = {
    reqIdStr: reqId.toString(),
    symbol,
    type: tradeType,
    barrier,
    stake,
    startEpoch: null,
    resolved: false
  };

  const contractType = tradeType === 'OVER' ? "DIGITOVER" : "DIGITUNDER";
  
  const rawPayloadString = `{"buy":1,"price":${stake.toFixed(2)},"parameters":{"amount":${stake.toFixed(2)},"basis":"stake","contract_type":"${contractType}","currency":"USD","duration":1,"duration_unit":"t","symbol":"${symbol}","barrier":"${barrier}"},"req_id":${reqId}}`;
  
  ws.send(rawPayloadString);

  postMessage({
    type: 'TRADE_INIT',
    trade: {
      id: reqId.toString(),
      timestamp: Date.now(),
      market: symbol,
      contractId: 0,
      buyPrice: stake,
      result: 'pending',
      tradeType: tradeType,
      barrier: barrier,
      pnl: 0
    }
  });

  if (deadlockTimeoutId) {
    clearTimeout(deadlockTimeoutId);
    deadlockTimeoutId = null;
  }

  deadlockTimeoutId = setTimeout(() => {
    if (!isTradeActive) return;
    
    const customId = reqId.toString();
    const pnl = -stake;
    
    const lt = localTradesTracker[customId];
    postMessage({
      type: 'TRADE_RESULT',
      id: customId,
      market: symbol,
      buyPrice: stake,
      timestamp: Date.now(),
      result: 'lost',
      pnl: pnl,
      entryTick: 'TIMEOUT',
      exitTick: 'TIMEOUT',
      tradeType: lt ? lt.type : undefined,
      barrier: lt ? lt.barrier : undefined
    });

    cumulativeLoss += Math.abs(pnl);
    
    globalCurrentStake = currentSettings?.globalStake || 1;

    lastLostSymbol = symbol;
    isTradeActive = false;
    sessionPnL += pnl;
    
    if (currentSettings && isRunning) {
      if (sessionPnL <= -currentSettings.stopLoss) {
        isRunning = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
      }
    }
  }, 10000);
}

function handleBuy(buyInfo: any, echo_req: any) {
  const contractId = buyInfo.contract_id;
  const reqId = echo_req.req_id;
  if (reqId) {
    const reqIdStr = reqId.toString();
    const lt = localTradesTracker[reqIdStr];
    if (lt) {
      lt.startEpoch = Number(buyInfo.start_time);
    }
    const symbol = reqIdToSymbol[reqId];
    if (symbol) {
      pendingContracts[contractId] = { 
        customId: reqIdStr, 
        symbol,
        type: lt ? lt.type : null,
        barrier: lt ? lt.barrier : null,
        stake: Number(buyInfo.buy_price) || globalCurrentStake,
        timestamp: Number(buyInfo.start_time) * 1000 || Date.now()
      };
      delete reqIdToSymbol[reqId];
    }
  }
}

function handleContractUpdate(contract: any) {
  if (!contract.is_expired && !contract.is_sold) {
    return;
  }

  const pending = pendingContracts[contract.contract_id];
  if (!pending) {
    // If it's a recent contract we probably just haven't received the buy response yet.
    // Give it a max of 5 tries (1250ms) before giving up, to avoid infinite loops and memory leaks.
    if (!contract.__retries) contract.__retries = 0;
    if (contract.__retries < 5 && (contract.contract_type === 'DIGITOVER' || contract.contract_type === 'DIGITUNDER' || contract.contract_type === 'DIGITDIFF')) {
      contract.__retries++;
      setTimeout(() => handleContractUpdate(contract), 250);
    }
    return;
  }

  const { customId, symbol } = pending;
  const pnl = Number(contract.profit) || 0;
  const isWin = pnl > 0;

  const entryTickStr = contract.entry_tick_display_value || String(contract.entry_tick || '');
  const exitTickStr = contract.exit_tick_display_value || String(contract.exit_tick || '');
  const entryDigit = entryTickStr ? parseInt(entryTickStr.slice(-1), 10) : undefined;
  const exitDigit = exitTickStr ? parseInt(exitTickStr.slice(-1), 10) : undefined;

  postMessage({
    type: 'TRADE_RESULT',
    id: customId,
    market: symbol,
    buyPrice: contract.buy_price || globalCurrentStake,
    timestamp: contract.date_start ? contract.date_start * 1000 : Date.now(),
    result: isWin ? 'won' : 'lost',
    pnl: pnl,
    entryTick: entryTickStr,
    exitTick: exitTickStr,
    entryDigit,
    exitDigit,
    tradeType: pending.type || (contract.contract_type === 'DIGITOVER' ? 'OVER' : contract.contract_type === 'DIGITUNDER' ? 'UNDER' : contract.contract_type === 'DIGITDIFF' ? 'DIFF' : undefined),
    barrier: pending.barrier || contract.barrier,
    contractId: contract.contract_id
  });

  const pt = localTradesTracker[customId];
  const isHandledLocally = pt && pt.resolved;
  if (pt) {
    delete localTradesTracker[customId];
  }

  delete pendingContracts[contract.contract_id];
  sessionPnL += pnl;
  batchPnL += pnl;
  expectedCallbacks -= 1;

  if (expectedCallbacks <= 0 && !isHandledLocally) {
    if (deadlockTimeoutId) {
      clearTimeout(deadlockTimeoutId);
      deadlockTimeoutId = null;
    }
  
    const batchWin = batchPnL > 0;

    if (batchWin) {
      cumulativeLoss -= batchPnL;
      if (cumulativeLoss <= 0) {
        cumulativeLoss = 0;
        recoveryTier = 0;
        globalCurrentStake = currentSettings.globalStake || 1;
        lastLostSymbol = null;
        lastLostTradeType = null;
        
        if (stopScheduledAndWaitingForRecovery) {
          isRunning = false;
          stopScheduledAndWaitingForRecovery = false;
          markets.forEach(m => { marketStates[m].overStreak = 0; marketStates[m].underStreak = 0; });
          postMessage({ type: 'SCHEDULE_STOP' });
        }
      } else {
        recoveryTier += 1;
        let payoutRate = 0.95;
        globalCurrentStake = Math.max(currentSettings.globalStake || 1, cumulativeLoss / payoutRate);
        globalCurrentStake = Math.max(0.35, Math.floor(globalCurrentStake * 100) / 100);
      }
    } else {
      cumulativeLoss += Math.abs(batchPnL);
      recoveryTier += 1;
      
      const tradeType = pending.type || (contract.contract_type === 'DIGITOVER' ? 'OVER' : contract.contract_type === 'DIGITUNDER' ? 'UNDER' : null);
      const barrierNum = parseInt(pending.barrier || contract.barrier || '0', 10);
      
      if (tradeType === 'OVER' && barrierNum === 1) lastLostTradeType = 'OVER';
      else if (tradeType === 'UNDER' && barrierNum === 8) lastLostTradeType = 'UNDER';
      
      let targetPayoutRate = 0.95;
      globalCurrentStake = Math.max(currentSettings.globalStake || 1, cumulativeLoss / targetPayoutRate);
      globalCurrentStake = Math.max(0.35, Math.floor(globalCurrentStake * 100) / 100);

      lastLostSymbol = symbol;
    }

    isTradeActive = false;
    
    expectedCallbacks = 0;
    batchPnL = 0;
    batchSymbol = null;

    if (currentSettings && isRunning) {
      if (sessionPnL >= currentSettings.takeProfit) {
        isRunning = false;
        isTradeActive = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Take Profit Hit!' });
        return;
      } else if (sessionPnL <= -currentSettings.stopLoss) {
        isRunning = false;
        isTradeActive = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
        return;
      }
    }

    // Immediate recovery trade block removed in favor of Tiered Linear Staking
  } else if (expectedCallbacks <= 0 && isHandledLocally) {
    expectedCallbacks = 0;
    batchPnL = 0;
    batchSymbol = null;

    if (currentSettings && isRunning) {
      if (sessionPnL >= currentSettings.takeProfit) {
        isRunning = false;
        isTradeActive = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Take Profit Hit!' });
        return;
      } else if (sessionPnL <= -currentSettings.stopLoss) {
        isRunning = false;
        isTradeActive = false;
        postMessage({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
        return;
      }
    }
  }
    
  if (ioServer) {
    const isReady = ws && ws.readyState === 1; // WebSocket.OPEN is 1
    ioServer.emit('bot_sync', {
        isRunning,
        currentSettings,
        globalCurrentStake,
        sessionPnL,
        cumulativeLoss,
        lastLostSymbol,
        isWaitingForRecovery: stopScheduledAndWaitingForRecovery,
        isTradeActive,
        connectionStatus: isReady ? 'connected' : 'disconnected'
    });
  }
  saveState();
}

export async function initBot() {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    
    const { data: settingsRow } = await supabase.from('bot_data').select('data').eq('id', 'settings').single();
    if (settingsRow && settingsRow.data) {
      currentSettings = settingsRow.data;
    }
    
    const { data: stateRow } = await supabase.from('bot_data').select('data').eq('id', 'state').single();
    if (stateRow && stateRow.data) {
      const stateData = stateRow.data;
      isRunning = stateData?.isRunning || false;
      globalCurrentStake = stateData?.globalCurrentStake || 1;
      sessionPnL = stateData?.sessionPnL || 0;
      cumulativeLoss = stateData?.cumulativeLoss || 0;
      lastLostSymbol = stateData?.lastLostSymbol || null;
      
      // Auto resume
      if (isRunning && currentSettings) {
        connect();
      }
    }
  } catch (err) {
    console.error('Error loading DB state:', err);
  }
}

export function startBotEngine(io: Server) {
  ioServer = io;

  io.on('connection', (socket) => {
    const isReady = ws && ws.readyState === WebSocket.OPEN;
    // Send immediate sync data to newly connected client
    socket.emit('bot_sync', {
        isRunning,
        currentSettings,
        globalCurrentStake,
        sessionPnL,
        cumulativeLoss,
        lastLostSymbol,
        isWaitingForRecovery: stopScheduledAndWaitingForRecovery,
        isTradeActive,
        connectionStatus: isReady ? 'connected' : 'disconnected'
    });
    
    // Fetch past trades
    const supabase = getSupabase();
    if (supabase) {
      supabase.from('bot_trades').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => {
        if (data && data.length > 0) {
           const pastTrades = data.reverse().map(t => ({
             type: 'TRADE_RESULT',
             id: t.id,
             market: t.market,
             buyPrice: t.buy_price,
             timestamp: t.timestamp,
             result: t.result,
             pnl: t.pnl,
             entryTick: t.entry_tick,
             exitTick: t.exit_tick,
             entryDigit: t.entry_digit,
             exitDigit: t.exit_digit,
             tradeType: t.trade_type,
             barrier: t.barrier
           }));
           socket.emit('past_trades', pastTrades);
        }
      }).then(undefined, err => console.error('Error fetching past trades:', err));
    }

    socket.on('worker_command', (data: any) => {
      if (data.type === 'REQUEST_SYNC') {
        const isReady = ws && ws.readyState === WebSocket.OPEN;
        socket.emit('bot_sync', {
            isRunning,
            currentSettings,
            globalCurrentStake,
            sessionPnL,
            cumulativeLoss,
            lastLostSymbol,
            isWaitingForRecovery: stopScheduledAndWaitingForRecovery,
            isTradeActive,
            connectionStatus: isReady ? 'connected' : 'disconnected'
        });
        if (supabase) {
          supabase.from('bot_trades').select('*').order('created_at', { ascending: false }).limit(50).then(({ data: tradeData }) => {
            if (tradeData && tradeData.length > 0) {
               const pastTrades = tradeData.reverse().map(t => ({
                 type: 'TRADE_RESULT',
                 id: t.id,
                 market: t.market,
                 buyPrice: t.buy_price,
                 timestamp: t.timestamp,
                 result: t.result,
                 pnl: t.pnl,
                 entryTick: t.entry_tick,
                 exitTick: t.exit_tick,
                 entryDigit: t.entry_digit,
                 exitDigit: t.exit_digit,
                 tradeType: t.trade_type,
                 barrier: t.barrier
               }));
               socket.emit('past_trades', pastTrades);
            }
          }).then(undefined, err => console.error('Error fetching past trades sync:', err));
        }
      }

      if (data.type === 'UPDATE_SETTINGS') {
        const isNewToken = currentSettings?.apiToken !== data.settings?.apiToken;
        currentSettings = data.settings;
        
        saveSettings(currentSettings);

        // Also broadcast settings to other clients
        socket.broadcast.emit('bot_sync', { currentSettings });

        if (isNewToken && ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (!ws || ws.readyState !== WebSocket.OPEN) {
          connect();
        }
      }

      if (data.type === 'START') {
        currentSettings = data.settings;
        saveSettings(currentSettings);
        
        globalCurrentStake = currentSettings?.globalStake || 1;
        cumulativeLoss = 0;
        stopScheduledAndWaitingForRecovery = false;
        isTradeActive = false;
        lastLostSymbol = null;
        sessionPnL = data.sessionPnL || 0;

        markets.forEach(m => { 
          marketStates[m].overStreak = 0;
          marketStates[m].underStreak = 0;
        });

        isRunning = true;
        saveState(true);

        connect();
        io.emit('bot_sync', { isRunning: true }); // Notify all
      }

      if (data.type === 'STOP') {
        isRunning = false;
        isTradeActive = false;
        stopScheduledAndWaitingForRecovery = false;
        markets.forEach(m => { 
          marketStates[m].overStreak = 0;
          marketStates[m].underStreak = 0;
        });
        saveState(true);
        
        io.emit('bot_sync', { isRunning: false }); // Notify all
      }

      if (data.type === 'TOPUP') {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send('{"topup_virtual":1}');
        }
      }
    });
  });
}
