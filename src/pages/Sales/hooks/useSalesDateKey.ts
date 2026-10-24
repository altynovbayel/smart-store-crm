import { useState, useEffect } from 'react';
import { formatCalendarDateKey } from '../../../utils/dateUtils';

/**
 * Current local calendar date key (YYYY-MM-DD) that refreshes across midnight and on tab focus,
 * so "today" statistics and period filters stay correct in long-lived cashier sessions.
 */
export const useSalesDateKey = (): string => {
  const [currentDateKey, setCurrentDateKey] = useState(() => formatCalendarDateKey(new Date()));

  useEffect(() => {
    const updateDate = () => {
      const newKey = formatCalendarDateKey(new Date());
      setCurrentDateKey((prev) => (prev !== newKey ? newKey : prev));
    };

    window.addEventListener('focus', updateDate);
    document.addEventListener('visibilitychange', updateDate);
    const interval = setInterval(updateDate, 30_000);

    return () => {
      window.removeEventListener('focus', updateDate);
      document.removeEventListener('visibilitychange', updateDate);
      clearInterval(interval);
    };
  }, []);

  return currentDateKey;
};
