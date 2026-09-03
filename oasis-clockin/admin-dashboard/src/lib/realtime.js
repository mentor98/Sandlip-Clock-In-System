import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://gqwdibokfrzekmiwsska.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxd2RpYm9rZnJ6ZWttaXdzc2thIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNTc0NTYsImV4cCI6MjEwMzgzMzQ1Nn0.RB6Gb8ibxYJQ7fTZKayF3X7WeBzER0o1rgpIBL_FJfo';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
});

/**
 * Subscribe to INSERT / UPDATE / DELETE events on a table.
 * Combines native SSE stream from Express backend with Supabase channels and heartbeat.
 * Returns an unsubscribe function — call it in onDestroy.
 */
export function subscribeTable(table, event = '*', callback) {
  let channel = null;
  let eventSource = null;

  // 1. Direct Server-Sent Events stream from backend for instant zero-latency updates
  try {
    const token = localStorage.getItem('oasis_admin_token') || '';
    if (token && typeof window !== 'undefined' && window.EventSource) {
      eventSource = new EventSource(`/api/admin/stream?token=${encodeURIComponent(token)}`);
      
      eventSource.addEventListener('realtime', (e) => {
        try {
          const parsed = JSON.parse(e.data);
          if (parsed && (!table || table === '*' || parsed.table === table)) {
            callback(parsed);
          }
        } catch (_) {}
      });

      eventSource.addEventListener('attendance', (e) => {
        try {
          const parsed = JSON.parse(e.data);
          if (table === 'attendance' || table === '*' || !table) {
            callback({ eventType: 'INSERT', table: 'attendance', record: parsed });
          }
        } catch (_) {}
      });
    }
  } catch (e) {
    console.warn('Admin stream setup note:', e.message);
  }

  // 2. Supabase postgres_changes channel
  try {
    channel = supabase
      .channel(`rt_${table}_${event}_${Math.random().toString(36).slice(2, 9)}`)
      .on('postgres_changes', { event, schema: 'public', table }, (payload) => {
        try { callback(payload); } catch {}
      })
      .subscribe();
  } catch (e) {
    console.warn('Realtime channel error:', e);
  }

  // 3. Resilient heartbeat sync ensuring any external modification is reflected
  const interval = setInterval(() => {
    try {
      callback({ eventType: 'SYNC', table });
    } catch {}
  }, 4000);

  return () => {
    if (interval) clearInterval(interval);
    if (eventSource) {
      try { eventSource.close(); } catch {}
    }
    if (channel) {
      try { supabase.removeChannel(channel); } catch {}
    }
  };
}
