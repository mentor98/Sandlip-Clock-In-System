import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('your-')
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        realtime: { params: { eventsPerSecond: 10 } },
      })
    : null;

// Singleton shared Server-Sent Events stream
let sharedEventSource = null;
let sseListeners = new Set();

function getSharedEventSource() {
  if (typeof window === 'undefined' || !window.EventSource) return null;
  const token = localStorage.getItem('oasis_admin_session') || localStorage.getItem('oasis_admin_token') || '';
  if (!token) return null;

  if (!sharedEventSource || sharedEventSource.readyState === EventSource.CLOSED) {
    try {
      sharedEventSource = new EventSource(`/api/admin/stream?token=${encodeURIComponent(token)}`);

      sharedEventSource.addEventListener('realtime', (e) => {
        try {
          const parsed = JSON.parse(e.data);
          const normalized = {
            ...parsed,
            eventType: parsed.eventType || parsed.action || 'INSERT',
          };
          sseListeners.forEach((listener) => {
            try { listener(normalized); } catch (_) {}
          });
        } catch (_) {}
      });

      sharedEventSource.addEventListener('session', (e) => {
        try {
          const parsed = JSON.parse(e.data);
          const sessionRecord = parsed.session || (parsed.deletedId ? { id: parsed.deletedId } : parsed);
          const isDelete = parsed.active === false || parsed.eventType === 'DELETE' || parsed.action === 'DELETE' || Boolean(parsed.deletedId);
          const normalized = {
            eventType: isDelete ? 'DELETE' : 'UPDATE',
            action: isDelete ? 'DELETE' : 'UPDATE',
            table: 'attendance_sessions',
            record: sessionRecord,
            session: sessionRecord,
            deletedId: parsed.deletedId || (isDelete ? sessionRecord?.id : null),
          };
          sseListeners.forEach((listener) => {
            try { listener(normalized); } catch (_) {}
          });
        } catch (_) {}
      });

      sharedEventSource.addEventListener('attendance', (e) => {
        try {
          const parsed = JSON.parse(e.data);
          sseListeners.forEach((listener) => {
            try {
              listener({ eventType: 'INSERT', table: 'attendance', record: parsed });
            } catch (_) {}
          });
        } catch (_) {}
      });

      sharedEventSource.onerror = () => {
        // Browser will auto-reconnect SSE with backoff
      };
    } catch (err) {
      console.warn('SSE stream init warning:', err);
    }
  }
  return sharedEventSource;
}

export function reconnectRealtime() {
  if (sharedEventSource) {
    try { sharedEventSource.close(); } catch (_) {}
    sharedEventSource = null;
  }
  return getSharedEventSource();
}

/**
 * Subscribe to INSERT / UPDATE / DELETE events on a table.
 * Combines native SSE stream from Express backend with Supabase channels.
 * Returns an unsubscribe function — call it in onDestroy.
 */
export function subscribeTable(table, event = '*', callback) {
  let channel = null;

  // 1. Shared SSE listener
  const sseHandler = (payload) => {
    if (!payload) return;
    const pTable = String(payload.table || '').toLowerCase();
    const tTable = String(table || '').toLowerCase();
    const isSessionMatch =
      (tTable === 'sessions' || tTable === 'attendance_sessions') &&
      (pTable === 'sessions' || pTable === 'attendance_sessions');

    if (!table || table === '*' || pTable === tTable || isSessionMatch) {
      callback(payload);
    }
  };

  sseListeners.add(sseHandler);
  getSharedEventSource();

  // 2. Supabase postgres_changes channel
  if (supabase) {
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
  }

  // 3. Gentle periodic sync (every 30 seconds) to ensure long-term consistency without flooding
  const interval = setInterval(() => {
    try {
      if (document.visibilityState === 'visible') {
        callback({ eventType: 'SYNC', table });
      }
    } catch {}
  }, 30000);

  return () => {
    if (interval) clearInterval(interval);
    sseListeners.delete(sseHandler);
    if (sseListeners.size === 0 && sharedEventSource) {
      try { sharedEventSource.close(); } catch {}
      sharedEventSource = null;
    }
    if (channel && supabase) {
      try { supabase.removeChannel(channel); } catch {}
    }
  };
}

