import { useEffect, useRef } from 'react';

export function useWakeLock() {
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          console.log('Wake Lock is active: Screen will not sleep.');
        }
      } catch (err: any) {
        // Silently catch the iframe permission error so it stops spamming your console
        if (err.name === 'NotAllowedError') {
          console.warn('Wake Lock blocked by browser iframe policy. Open the app in a new tab to enable it.');
        } else {
          console.error('Wake Lock request failed:', err);
        }
      }
    };

    requestWakeLock();

    // If the user minimizes the window and comes back, re-request the lock
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(console.error);
      }
    };
  }, []);
}
