import React, { useState } from 'react';
import { Settings as SettingsIcon, X } from 'lucide-react';
import { useStore } from '../store/useStore';

export function SettingsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const settings = useStore(state => state.settings);
  const setSettings = useStore(state => state.setSettings);

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const newSettings = {
      apiToken: fd.get('apiToken') as string,
      globalStake: Number(fd.get('globalStake')),
      targetStreak: Number(fd.get('targetStreak')),
      takeProfit: Number(fd.get('takeProfit')),
      stopLoss: Number(fd.get('stopLoss')),
      useSchedule: fd.get('useSchedule') === 'on',
      startTime: (fd.get('startTime') as string) || '08:00',
      stopTime: (fd.get('stopTime') as string) || '17:00',
    };
    setSettings(newSettings);
    window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: newSettings }));
    setIsOpen(false);
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="p-2 text-[#a1a1aa] hover:text-[#e4e4e7] transition-colors rounded hover:bg-white/5">
        <SettingsIcon size={20} />
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#111114] border border-[#27272a] w-full max-w-md p-6 relative rounded-lg">
            <button 
              onClick={() => setIsOpen(false)} 
              className="absolute top-4 right-4 text-[#a1a1aa] hover:text-[#e4e4e7]"
            >
              <X size={20} />
            </button>
            <h2 className="text-[14px] font-bold text-[#00ff9c] mb-6 uppercase tracking-widest">Global Parameters</h2>
            
            <form onSubmit={handleSave} className="space-y-4 font-mono text-sm">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">API Token (Trade Scope)</label>
                <input 
                  type="password" 
                  name="apiToken"
                  defaultValue={settings.apiToken}
                  className="w-full bg-black/30 border border-[#27272a] text-[#00ff9c] px-3 py-2 focus:border-[#00ff9c] outline-none rounded font-mono text-[12px]"
                  placeholder="Deriv API Token..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">Initial Stake ($)</label>
                  <input 
                    type="number" 
                    name="globalStake"
                    defaultValue={settings.globalStake}
                    className="w-full bg-black/30 border border-[#27272a] text-[#00ff9c] px-3 py-2 outline-none text-right font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    step="0.01"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">Target Streak</label>
                  <input 
                    type="number" 
                    name="targetStreak"
                    defaultValue={settings.targetStreak}
                    className="w-full bg-black/30 border border-[#27272a] text-[#00ff9c] px-3 py-2 outline-none text-right font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">Take Profit ($)</label>
                  <input 
                    type="number" 
                    name="takeProfit"
                    defaultValue={settings.takeProfit}
                    className="w-full bg-black/30 border border-[#27272a] text-[#00ff9c] px-3 py-2 outline-none text-right font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">Stop Loss ($)</label>
                  <input 
                    type="number" 
                    name="stopLoss"
                    defaultValue={settings.stopLoss}
                    className="w-full bg-black/30 border border-[#27272a] text-[#00ff9c] px-3 py-2 outline-none text-right font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    required
                  />
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-[#27272a] space-y-4">
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    name="useSchedule" 
                    id="useSchedule"
                    defaultChecked={settings.useSchedule}
                    className="accent-[#00ff9c]" 
                  />
                  <label htmlFor="useSchedule" className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">Enable Daily Schedule</label>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">Start Time</label>
                    <input 
                      type="time" 
                      name="startTime"
                      defaultValue={settings.startTime}
                      className="w-full bg-black/30 border border-[#27272a] text-[#a1a1aa] px-3 py-2 outline-none font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">Stop Time</label>
                    <input 
                      type="time" 
                      name="stopTime"
                      defaultValue={settings.stopTime}
                      className="w-full bg-black/30 border border-[#27272a] text-[#a1a1aa] px-3 py-2 outline-none font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-[#27272a] flex justify-end">
                <button type="submit" className="bg-[#00ff9c] text-[#09090b] px-6 py-2 font-bold uppercase tracking-wider rounded transition-colors hover:opacity-90 text-[12px]">
                  Save Config
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
