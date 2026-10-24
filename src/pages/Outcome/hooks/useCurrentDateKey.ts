import { useState, useEffect } from 'react';

const buildDateKey = (now: Date): string =>
  `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

/**
 * Current local calendar date key (YYYY-M-D) that refreshes across midnight and on tab focus,
 * so date-dependent statistics and filters stay correct in long-lived sessions.
 */
export const useCurrentDateKey = (): string => {
  const [currentDateKey, setCurrentDateKey] = useState(() => buildDateKey(new Date()));

  useEffect(() => {
    const updateDate = () => {
      const newKey = buildDateKey(new Date());
      setCurrentDateKey((prev) => (prev !== newKey ? newKey : prev));
    };

    // 1. Refresh on tab focus and visibility change
    window.addEventListener('focus', updateDate);
    document.addEventListener('visibilitychange', updateDate);

    // 2. Periodic interval (every 30s) to catch midnight transition smoothly
    const interval = setInterval(updateDate, 30_000);

    return () => {
      window.removeEventListener('focus', updateDate);
      document.removeEventListener('visibilitychange', updateDate);
      clearInterval(interval);
    };
  }, []);

  return currentDateKey;
};
