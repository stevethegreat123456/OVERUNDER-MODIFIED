// type definitions for communication

export type WorkerCommand = 
  | { type: 'START', settings: any, sessionPnL: number }
  | { type: 'STOP' }
  | { type: 'UPDATE_SETTINGS', settings: any }
  | { type: 'TOPUP' };

export type WorkerMessage = 
  | { type: 'MARKET_UPDATES', updates: Record<string, any> }
  | { type: 'TRADE_INIT', trade: any }
  | { type: 'TRADE_RESULT', id: string, result: 'won' | 'lost', pnl: number, entryTick?: string, exitTick?: string, entryDigit?: number, exitDigit?: number }
  | { type: 'DIGIT_STAT', digit: number }
  | { type: 'STATUS', status: 'connected' | 'disconnected' }
  | { type: 'SCHEDULE_START' }
  | { type: 'SCHEDULE_STOP' }
  | { type: 'LIMIT_REACHED', message: string }
  | { type: 'BALANCE', balance: number }
  | { type: 'ERROR', message: string };

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
const HISTORY_SIZE = 50;

// Memory Management: Typed Arrays and Circular Buffers over dynamic Arrays
interface MarketState {
  symbol: string;
  price: number;
  digit: number;
  streak: number;
  history: Int8Array;
  historyIndex: number;
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
    streak: 0,
    history: new Int8Array(HISTORY_SIZE).fill(-1),
    historyIndex: 0,
    // Network Proximity optimization: Pre-compiled payload string segments to bypass JSON.stringify latency
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
let cumulativeLoss = 0;
let stopScheduledAndWaitingForRecovery = false;
let deadlockTimeoutId: any = null;

let pendingUpdates: Record<string, any> = {};
let batchTimeout: any = null;

let pendingContracts: Record<number, { customId: string, symbol: string }> = {}; 
let reqIdToSymbol: Record<number, string> = {};
let pingInterval: any = null;
let reqIdCounter = Math.floor(Date.now() / 1000); // Uses current timestamp to prevent ID overlap across page reloads

let hasConnectedOnce = false;

let lastCheckedMinute: string | null = null;
let scheduleInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
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
        markets.forEach(m => { marketStates[m].streak = 0; });
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
          markets.forEach(m => { marketStates[m].streak = 0; });
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

  ws.onopen = () => {
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
    hasConnectedOnce = true;
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    if (data.error) {
      postMessage({ type: 'ERROR', message: data.error.message });
      if (data.echo_req && data.echo_req.req_id) {
         delete reqIdToSymbol[data.echo_req.req_id];
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
  };

  ws.onclose = () => {
    clearInterval(pingInterval);
    postMessage({ type: 'STATUS', status: 'disconnected' });
    if (isRunning) {
      setTimeout(connect, 2000); // Reconnect
    }
  };
}

function subscribeToTicks() {
  markets.forEach(symbol => {
    ws?.send(JSON.stringify({ ticks: symbol }));
  });
}

function handleTick(tickInfo: any) {
  const symbol = tickInfo.symbol;
  const state = marketStates[symbol];
  if (!state) return;

  const price = tickInfo.quote;
  const pipSize = tickInfo.pip_size || 4;
  
  // Computational Efficiency: Math over Strings avoids slow string allocations
  // Extracts the specific decimal digit quickly while accounting for IEEE 754 precision drifts
  const digit = Math.round(price * Math.pow(10, pipSize)) % 10;

  state.price = price;
  state.digit = digit;

  postMessage({ type: 'DIGIT_STAT', digit });

  const prevDigit = state.history[(state.historyIndex - 1 + HISTORY_SIZE) % HISTORY_SIZE];
  const prevPrevDigit = state.history[(state.historyIndex - 2 + HISTORY_SIZE) % HISTORY_SIZE];

  if (digit === 0 || digit === 1) {
    state.streak += 1;
  } else {
    state.streak = 0;
  }

  // Defeating GC: Circular buffer implementation (no Array.push or shift)
  state.history[state.historyIndex] = digit;
  state.historyIndex = (state.historyIndex + 1) % HISTORY_SIZE;

  queueUpdate(symbol, state);

  // Trigger evaluation
  if (isRunning && currentSettings) {
    if (state.streak >= (currentSettings.targetStreak || 3)) {
      state.streak = 0; // reset
      if (!isTradeActive) {
        isTradeActive = true;
        executeBuy(symbol);
      }
    }
  }
}

function queueUpdate(symbol: string, state: MarketState) {
  // Unwrap the circular buffer chronologically for UI ingestion
  const unwrappedHistory = new Array(HISTORY_SIZE);
  for (let i = 0; i < HISTORY_SIZE; i++) {
    unwrappedHistory[i] = state.history[(state.historyIndex + i) % HISTORY_SIZE];
  }

  pendingUpdates[symbol] = {
    currentPrice: state.price,
    currentDigit: state.digit,
    streak: state.streak,
    streakHistory: unwrappedHistory
  };

  if (!batchTimeout) {
    // 250ms batch window to offload main thread DOM layout calculation impact
    batchTimeout = setTimeout(() => {
      postMessage({ type: 'MARKET_UPDATES', updates: pendingUpdates });
      pendingUpdates = {};
      batchTimeout = null;
    }, 250);
  }
}


function executeBuy(symbol: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!currentSettings || !currentSettings.apiToken) return;

  const reqId = reqIdCounter++;
  const state = marketStates[symbol];
  const stake = globalCurrentStake;
  
  reqIdToSymbol[reqId] = symbol;

  // Dynamically set barrier: use 4 during recovery, otherwise 1
  const barrier = cumulativeLoss > 0 ? "4" : "1";
  
  // Dynamic String Concatenation over generic Object Serialization
  const rawPayloadString = `{"buy":1,"price":${stake},"parameters":{"amount":${stake},"basis":"stake","contract_type":"DIGITOVER","currency":"USD","duration":1,"duration_unit":"t","symbol":"${symbol}","barrier":"${barrier}"},"req_id":${reqId}}`;
  
  // Drop payload directly down the pipe precisely the millisecond condition met
  ws.send(rawPayloadString);

  // Release main thread
  postMessage({
    type: 'TRADE_INIT',
    trade: {
      id: reqId.toString(),
      timestamp: Date.now(),
      market: symbol,
      contractId: 0,
      buyPrice: stake,
      result: 'pending',
      pnl: 0
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
      result: 'lost',
      pnl: pnl,
      entryTick: 'TIMEOUT',
      exitTick: 'TIMEOUT'
    });

    cumulativeLoss += Math.abs(pnl);
    
    globalCurrentStake = Number((globalCurrentStake * 2.5).toFixed(2));

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
    const symbol = reqIdToSymbol[reqId];
    if (symbol) {
      pendingContracts[contractId] = { customId: reqId.toString(), symbol };
      delete reqIdToSymbol[reqId];
    }
  }
}

function handleContractUpdate(contract: any) {
  if (!contract.is_expired && !contract.is_sold) return;

  if (deadlockTimeoutId) {
    clearTimeout(deadlockTimeoutId);
    deadlockTimeoutId = null;
  }

  const pending = pendingContracts[contract.contract_id];
  if (!pending) return;

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
    result: isWin ? 'won' : 'lost',
    pnl: pnl,
    entryTick: entryTickStr,
    exitTick: exitTickStr,
    entryDigit,
    exitDigit
  });

  if (isWin) {
    globalCurrentStake = currentSettings.globalStake;
    cumulativeLoss = 0;
    lastLostSymbol = null;
    
    if (stopScheduledAndWaitingForRecovery) {
      isRunning = false;
      stopScheduledAndWaitingForRecovery = false;
      markets.forEach(m => { marketStates[m].streak = 0; });
      postMessage({ type: 'SCHEDULE_STOP' });
    }
  } else {
    cumulativeLoss += Math.abs(pnl);
    
    globalCurrentStake = Number((globalCurrentStake * 2.5).toFixed(2));

    lastLostSymbol = symbol;
  }

  // Free memory to prevent V8 generic dictionary leak during high-frequency sessions
  delete pendingContracts[contract.contract_id];

  // Hard TP/SL enforcement check right inside the headless worker
  sessionPnL += pnl;
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

  // Release the global trade lock
  isTradeActive = false;
}

self.onmessage = (e) => {
  const data = e.data as WorkerCommand;

  if (data.type === 'UPDATE_SETTINGS') {
    const isNewToken = currentSettings?.apiToken !== data.settings?.apiToken;
    currentSettings = data.settings;
    
    if (isNewToken && ws && ws.readyState === WebSocket.OPEN) {
      ws.close(); // Force reconnect to authenticate new token
    } else {
      connect();
    }
  }

  if (data.type === 'START') {
    currentSettings = data.settings;
    
    globalCurrentStake = currentSettings?.globalStake || 1;
    cumulativeLoss = 0;
    stopScheduledAndWaitingForRecovery = false;
    isTradeActive = false;
    lastLostSymbol = null;
    sessionPnL = data.sessionPnL || 0;

    markets.forEach(m => { 
      marketStates[m].streak = 0;
    });

    isRunning = true;
    connect();
  }

  if (data.type === 'STOP') {
    isRunning = false;
    isTradeActive = false;
    stopScheduledAndWaitingForRecovery = false;
    markets.forEach(m => { 
      marketStates[m].streak = 0;
    });
  }

  if (data.type === 'TOPUP') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send('{"topup_virtual":1}');
    }
  }
};
