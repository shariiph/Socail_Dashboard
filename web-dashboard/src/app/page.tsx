'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { getProfile, profileInitials, saveProfile } from '@/lib/profileStorage';
import { appSourcePillClass, getAppSourceMeta } from '@/lib/appSourceMeta';
import { 
  MessageSquare, 
  Send, 
  Phone, 
  Settings, 
  Bell, 
  User,
  Filter,
  CheckCheck, 
  Clock,
  Search,
  Archive,
  Star,
  MoreVertical,
  CheckCircle2,
  Trash2,
  X,
  Plus,
  StickyNote,
  ExternalLink,
  ChevronRight,
  MessageCircle,
  Users,
  Database,
  ShieldCheck,
  ClipboardCheck,
  Smartphone,
  Info,
  Radio,
  Wifi,
  Activity,
  Mail,
  Wallet,
  RefreshCw,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { downloadCsv } from '@/lib/csv';
import { loadSavedViews, persistSavedViews, type SavedView } from '@/lib/dashboardStorage';
import { fetchWithRetry } from '@/lib/fetchWithRetry';

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        realtime: {
          params: { eventsPerSecond: 30 },
        },
      })
    : null;

/** Optional browser gate; PIN is visible in the client bundle — use only as a casual screen lock. */
const dashboardPin = process.env.NEXT_PUBLIC_DASHBOARD_PIN || '';
const PIN_SESSION_KEY = 'wallet-hub-dash-unlocked';

interface Message {
  id: string;
  device_id?: string | null;
  sender_name: string;
  message_title?: string;
  message_text: string;
  app_source: string;
  order_ref?: string | null;
  order_status_hint?: string | null;
  amount?: number | null;
  currency?: string | null;
  created_at: string;
  is_read: boolean;
  archived: boolean;
  notes?: string | null;
}

interface Device {
  id: string;
  device_name: string;
  last_seen: string;
  is_online: boolean;
}

interface Order {
  id: string;
  order_ref: string;
  status?: string | null;
  amount?: number | null;
  currency?: string | null;
  last_message_text?: string | null;
  last_message_at?: string | null;
  updated_at?: string | null;
}

interface SmsMessage {
  id: string;
  device_id: string;
  address: string;
  contact_name: string | null;
  body: string;
  sms_box: string;
  read_flag: boolean;
  occurred_at: string;
  created_at: string;
}

interface PhoneCallRow {
  id: string;
  device_id: string;
  phone_number: string;
  contact_name: string | null;
  duration_seconds: number;
  call_type: string;
  occurred_at: string;
  created_at: string;
}

export default function Dashboard() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [smsMessages, setSmsMessages] = useState<SmsMessage[]>([]);
  const [phoneCalls, setPhoneCalls] = useState<PhoneCallRow[]>([]);
  const [currentView, setCurrentView] = useState<'inbox' | 'orders' | 'contacts' | 'sms' | 'calls' | 'settings' | 'devices'>('inbox');
  const [activeTab, setActiveTab] = useState('all');
  const [activeStatus, setActiveStatus] = useState<'all' | 'unread' | 'read' | 'archived'>('all');
  const [activeOrderStatus, setActiveOrderStatus] = useState<'all' | 'paid' | 'processing' | 'failed' | 'refunded' | 'delivered' | 'cancelled'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [orderSearchQuery, setOrderSearchQuery] = useState('');
  const [smsSearchQuery, setSmsSearchQuery] = useState('');
  const [callSearchQuery, setCallSearchQuery] = useState('');
  const [messageDeviceFilter, setMessageDeviceFilter] = useState('all');
  const [callFilterFrom, setCallFilterFrom] = useState('');
  const [callFilterTo, setCallFilterTo] = useState('');
  const [smsFilterFrom, setSmsFilterFrom] = useState('');
  const [smsFilterTo, setSmsFilterTo] = useState('');
  const [smsDeviceFilter, setSmsDeviceFilter] = useState('all');
  const [callDeviceFilter, setCallDeviceFilter] = useState('all');
  const [collapsedCallDateSections, setCollapsedCallDateSections] = useState<Record<string, boolean>>({});
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [selectedOrderRef, setSelectedOrderRef] = useState<string | null>(null);
  const [isNoteEditing, setIsNoteEditing] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  
  const notificationSound = useRef<HTMLAudioElement | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchWarnings, setFetchWarnings] = useState<string[]>([]);
  /** Service-role row counts from /api/health — distinguishes RLS (DB has rows, client sees 0) vs empty table. */
  const [healthSnapshot, setHealthSnapshot] = useState<{
    tableCounts: Record<string, number | null> | null;
    supabaseAdminConfigured: boolean;
  } | null>(null);
  /** Supabase Realtime channel state (polling still runs as fallback). */
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [profileName, setProfileName] = useState('Admin');
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState('Admin');
  const [profileBanner, setProfileBanner] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [userMgmtBanner, setUserMgmtBanner] = useState<string | null>(null);
  const [userMgmtBusy, setUserMgmtBusy] = useState(false);
  const [allowedIpsDraft, setAllowedIpsDraft] = useState('');
  const [securityBanner, setSecurityBanner] = useState<string | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);

  const [messageFetchLimit, setMessageFetchLimit] = useState(100);
  const messageLimitRef = useRef(100);
  /** Ignore stale results when multiple loadDashboardData runs overlap (poll + visibility + manual refresh). */
  const loadDashboardGenerationRef = useRef(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pinUnlocked, setPinUnlocked] = useState(!dashboardPin);
  const [pinInput, setPinInput] = useState('');
  const [authReady, setAuthReady] = useState(!dashboardPin);
  const [groupOrdersByApp, setGroupOrdersByApp] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedViewNameDraft, setSavedViewNameDraft] = useState('');
  const [savedViewPicker, setSavedViewPicker] = useState('');

  useEffect(() => {
    messageLimitRef.current = messageFetchLimit;
  }, [messageFetchLimit]);

  useEffect(() => {
    if (!dashboardPin) return;
    if (typeof window === 'undefined') return;
    setPinUnlocked(sessionStorage.getItem(PIN_SESSION_KEY) === '1');
    setAuthReady(true);
  }, [dashboardPin]);

  useEffect(() => {
    setSavedViews(loadSavedViews());
  }, []);

  useEffect(() => {
    const loadProfile = () => {
      const p = getProfile();
      setProfileName(p.name);
      setProfileAvatar(p.avatarDataUrl);
      setProfileNameDraft(p.name);
    };
    loadProfile();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', loadProfile);
      window.addEventListener('social-inbox-profile-updated', loadProfile);
      return () => {
        window.removeEventListener('storage', loadProfile);
        window.removeEventListener('social-inbox-profile-updated', loadProfile);
      };
    }
  }, []);

  useEffect(() => {
    if (currentView !== 'settings') return;
    let cancelled = false;
    const loadSecurity = async () => {
      try {
        const res = await fetch('/api/security/settings', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const ips = Array.isArray(data?.allowedIps) ? data.allowedIps : [];
        setAllowedIpsDraft(ips.join('\n'));
      } catch {
        // Keep UI usable even if endpoint is unavailable.
      }
    };
    loadSecurity();
    return () => {
      cancelled = true;
    };
  }, [currentView]);

  const loadDashboardData = useCallback(
    async (opts?: { showRefreshing?: boolean }) => {
      const spin = opts?.showRefreshing === true;
      if (spin) setIsRefreshing(true);
      const generation = ++loadDashboardGenerationRef.current;
      const stillHere = () => generation === loadDashboardGenerationRef.current;

      try {
        if (stillHere()) {
          setFetchError(null);
          setFetchWarnings([]);
        }
        const warnings: string[] = [];
        if (!supabaseUrl || !supabaseKey) {
          warnings.push(
            'Browser Supabase env vars are missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). Using server APIs only.'
          );
        }

        let messagesLoaded = false;
        let inboxServerWarning: string | null = null;
        try {
          const inboxRes = await fetchWithRetry(
            `/api/inbox/messages?limit=${messageFetchLimit}`,
            { cache: 'no-store', credentials: 'same-origin' }
          );
          if (inboxRes.ok) {
            const inboxJson = (await inboxRes.json()) as { messages?: Message[] };
            if (Array.isArray(inboxJson.messages)) {
              if (stillHere()) setMessages(inboxJson.messages);
              messagesLoaded = true;
            }
          } else {
            const errJson = (await inboxRes.json().catch(() => ({}))) as {
              error?: string;
              fallbackToAnon?: boolean;
            };
            const detail = errJson.error || inboxRes.statusText || String(inboxRes.status);
            inboxServerWarning = `Social messages (server): ${detail} (using browser Supabase as fallback).`;
          }
        } catch {
          inboxServerWarning =
            'Social messages: server inbox request failed (network or 5xx). Using browser Supabase as fallback.';
        }

        if (supabase) {
          if (!messagesLoaded) {
            const { data: msgData, error: msgError } = await supabase
              .from('messages')
              .select('*')
              .order('created_at', { ascending: false })
              .limit(messageFetchLimit);
            if (msgError) {
              if (inboxServerWarning) warnings.push(inboxServerWarning);
              warnings.push(
                `Social messages (browser): ${msgError.message}. Check RLS on public.messages or run supabase/rls_anon_policies.sql; ensure Netlify has SUPABASE_SERVICE_ROLE_KEY (secret key, not publishable).`
              );
              if (stillHere()) setMessages([]);
            } else {
              const rows = (msgData || []) as Message[];
              if (stillHere()) setMessages(rows);
              if (inboxServerWarning && rows.length === 0) {
                warnings.push(inboxServerWarning);
              }
            }
          }

          const { data: devData, error: devError } = await supabase
            .from('devices')
            .select('*')
            .order('last_seen', { ascending: false });
          if (devError) {
            warnings.push(
              `Devices: ${devError.message}. Run supabase/fix_missing_devices.sql (or full schema.sql) in the Supabase SQL editor.`
            );
            if (stillHere()) setDevices([]);
          } else {
            if (stillHere()) setDevices((devData || []) as Device[]);
          }

          const { data: ordData, error: ordError } = await supabase
            .from('orders')
            .select('*')
            .order('updated_at', { ascending: false });
          if (ordError) {
            warnings.push(
              `Orders: ${ordError.message}. Run supabase/fix_missing_orders.sql (or full supabase/schema.sql) in the Supabase SQL editor.`
            );
            if (stillHere()) setOrders([]);
          } else {
            if (stillHere()) setOrders((ordData || []) as Order[]);
          }

          const { data: smsData, error: smsError } = await supabase
            .from('sms_messages')
            .select('*')
            .order('occurred_at', { ascending: false });
          const { data: callData, error: callError } = await supabase
            .from('phone_calls')
            .select('*')
            .order('occurred_at', { ascending: false });
          if (smsError || callError) {
            const hint = smsError?.message || callError?.message || 'unknown error';
            warnings.push(`SMS / call log: ${hint}. Run supabase/fix_sms_calls.sql in the Supabase SQL editor.`);
          }
          if (stillHere()) {
            if (smsError) setSmsMessages([]);
            else setSmsMessages((smsData || []) as SmsMessage[]);
            if (callError) setPhoneCalls([]);
            else setPhoneCalls((callData || []) as PhoneCallRow[]);
          }
        } else if (stillHere()) {
          setDevices([]);
          setOrders([]);
          setSmsMessages([]);
          setPhoneCalls([]);
        }

        if (stillHere()) {
          setFetchWarnings(warnings);
          setLastSyncedAt(new Date().toISOString());
        }

        try {
          const hr = await fetchWithRetry('/api/health', {
            cache: 'no-store',
            credentials: 'same-origin',
          });
          const hj = (await hr.json()) as {
            tableCounts?: Record<string, number | null> | null;
            supabaseAdminConfigured?: boolean;
          };
          if (stillHere()) {
            setHealthSnapshot({
              tableCounts: hj.tableCounts ?? null,
              supabaseAdminConfigured: !!hj.supabaseAdminConfigured,
            });
          }
        } catch {
          if (stillHere()) setHealthSnapshot(null);
        }
      } catch (err: unknown) {
        if (!stillHere()) return;
        const msg =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message?: string }).message)
            : String(err);
        setFetchError(msg);
        console.error('Dashboard fetch error:', err);
      } finally {
        if (spin) setIsRefreshing(false);
      }
    },
    [messageFetchLimit]
  );

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission();
    }
    notificationSound.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
  }, []);

  useEffect(() => {
    loadDashboardData();
    const pollMs = 25000;
    const pollTimer = window.setInterval(() => {
      loadDashboardData();
    }, pollMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadDashboardData();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadDashboardData]);

  useEffect(() => {
    if (!supabase) {
      setRealtimeStatus('error');
      return;
    }
    setRealtimeStatus('connecting');
    const dashboardChannel = supabase
      .channel('dashboard-sync')
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'messages' }, (payload: any) => {
        const newMessage = payload.new as Message;
        setMessages((prev) => {
          const next = [newMessage, ...prev.filter((m) => m.id !== newMessage.id)];
          return next.slice(0, messageLimitRef.current);
        });
        if (typeof window !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`New from ${newMessage.sender_name}`, { body: newMessage.message_text });
          notificationSound.current?.play().catch(() => {});
        }
      })
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload: any) => {
        const row = payload.new as Message;
        setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)));
      })
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'devices' }, (payload: any) => {
        if (payload.eventType === 'INSERT') {
          setDevices((prev) => [payload.new as Device, ...prev.filter((d) => d.id !== payload.new.id)]);
        } else if (payload.eventType === 'UPDATE') {
          setDevices((prev) => prev.map((d) => (d.id === payload.new.id ? (payload.new as Device) : d)));
        }
      })
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'orders' }, (payload: any) => {
        const newOrder = payload.new as Order;
        setOrders((prev) => [newOrder, ...prev.filter((o) => o.order_ref !== newOrder.order_ref)]);
      })
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload: any) => {
        const updated = payload.new as Order;
        setOrders((prev) => prev.map((o) => (o.order_ref === updated.order_ref ? updated : o)));
      })
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'sms_messages' }, (payload: any) => {
        const row = payload.new as SmsMessage;
        setSmsMessages((prev) => [row, ...prev.filter((s) => s.id !== row.id)]);
      })
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'sms_messages' }, (payload: any) => {
        const row = payload.new as SmsMessage;
        setSmsMessages((prev) => prev.map((s) => (s.id === row.id ? row : s)));
      })
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'phone_calls' }, (payload: any) => {
        const row = payload.new as PhoneCallRow;
        setPhoneCalls((prev) => [row, ...prev.filter((c) => c.id !== row.id)]);
      })
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'phone_calls' }, (payload: any) => {
        const row = payload.new as PhoneCallRow;
        setPhoneCalls((prev) => prev.map((c) => (c.id === row.id ? row : c)));
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('live');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeStatus('error');
          console.warn('Dashboard Realtime:', status);
        } else {
          setRealtimeStatus('connecting');
        }
      });

    return () => {
      supabase.removeChannel(dashboardChannel);
    };
  }, []);

  const handleAction = async (id: string, updates: Partial<Message>) => {
    if (!supabase) return;
    const { error } = await supabase.from('messages').update(updates).eq('id', id);
    if (!error) {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
      if (selectedMessage?.id === id) {
        setSelectedMessage(prev => prev ? { ...prev, ...updates } : null);
      }
    }
  };

  const handleCopyAndAttend = async () => {
    if (!selectedMessage || !replyText) return;
    await navigator.clipboard.writeText(replyText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
    await handleAction(selectedMessage.id, { is_read: true });
    setReplyText('');
  };

  const saveNote = async () => {
    if (selectedMessage) {
      await handleAction(selectedMessage.id, { notes: noteText });
      setIsNoteEditing(false);
    }
  };

  const renderOrderStatusPill = (status?: string | null) => {
    const st = (status || 'unknown').toLowerCase();
    const map: Record<string, { bg: string; fg: string; border: string }> = {
      paid: { bg: 'bg-green-500/10', fg: 'text-green-400', border: 'border-green-500/20' },
      delivered: { bg: 'bg-teal-500/10', fg: 'text-teal-300', border: 'border-teal-500/20' },
      processing: { bg: 'bg-amber-500/10', fg: 'text-amber-300', border: 'border-amber-500/20' },
      failed: { bg: 'bg-rose-500/10', fg: 'text-rose-300', border: 'border-rose-500/20' },
      refunded: { bg: 'bg-purple-500/10', fg: 'text-purple-300', border: 'border-purple-500/20' },
      cancelled: { bg: 'bg-slate-500/10', fg: 'text-slate-300', border: 'border-slate-500/20' },
      unknown: { bg: 'bg-slate-800/60', fg: 'text-slate-300', border: 'border-slate-700/60' },
    };

    const cfg = map[st] || map.unknown;
    const label = (status || 'Unknown').toString();
    return (
      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${cfg.bg} ${cfg.fg} ${cfg.border}`}>
        {label}
      </span>
    );
  };

  const handleOrderUpdate = async (orderRef: string, updates: Partial<Order>) => {
    if (!supabase) return;
    const { error } = await supabase.from('orders').update(updates).eq('order_ref', orderRef);
    if (!error) {
      setOrders(prev => prev.map(o => (o.order_ref === orderRef ? { ...o, ...updates } : o)));
    }
  };

  const inboxAppFilters = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of messages) {
      if (!seen.has(m.app_source)) {
        seen.set(m.app_source, getAppSourceMeta(m.app_source).label);
      }
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [messages]);

  const filteredMessages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return messages.filter((m) => {
      const matchesDevice =
        messageDeviceFilter === 'all' || (m.device_id || '') === messageDeviceFilter;
      const matchesTab = activeTab === 'all' || m.app_source === activeTab;
      const meta = getAppSourceMeta(m.app_source);
      const matchesSearch =
        !q ||
        (m.sender_name || '').toLowerCase().includes(q) ||
        (m.message_text || '').toLowerCase().includes(q) ||
        m.app_source.toLowerCase().includes(q) ||
        meta.label.toLowerCase().includes(q);
      const isRead = !!m.is_read;
      const isArchived = !!m.archived;
      let matchesStatus = false;
      if (activeStatus === 'all') matchesStatus = !isArchived;
      else if (activeStatus === 'unread') matchesStatus = !isRead && !isArchived;
      else if (activeStatus === 'read') matchesStatus = isRead && !isArchived;
      else if (activeStatus === 'archived') matchesStatus = isArchived;
      return matchesDevice && matchesTab && matchesSearch && matchesStatus;
    });
  }, [messages, activeTab, searchQuery, activeStatus, messageDeviceFilter]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const st = (o.status || '').toLowerCase();
      const matchesStatus = activeOrderStatus === 'all' || st === activeOrderStatus;
      const q = orderSearchQuery.toLowerCase();
      const matchesSearch =
        (o.order_ref || '').toLowerCase().includes(q) ||
        (o.last_message_text || '').toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [orders, activeOrderStatus, orderSearchQuery]);

  const ordersWithAppMeta = useMemo(
    () =>
      filteredOrders.map((order) => {
        const linked = messages.find((m) => (m.order_ref || null) === order.order_ref);
        const appKey = linked?.app_source ?? '__unknown__';
        const appLabel = linked ? getAppSourceMeta(linked.app_source).label : 'Unknown app';
        return { order, appKey, appLabel };
      }),
    [filteredOrders, messages]
  );

  const ordersGroupedByApp = useMemo(() => {
    const map = new Map<string, Array<{ order: Order; appKey: string; appLabel: string }>>();
    for (const row of ordersWithAppMeta) {
      const cur = map.get(row.appKey);
      if (cur) cur.push(row);
      else map.set(row.appKey, [row]);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[1][0].appLabel.localeCompare(b[1][0].appLabel)
    );
  }, [ordersWithAppMeta]);

  const deviceNameById = (deviceId: string) =>
    devices.find((d) => d.id === deviceId)?.device_name || `${deviceId.slice(0, 8)}…`;

  const deviceFilterOptions = useMemo(() => {
    const allIds = new Set<string>();
    smsMessages.forEach((s) => allIds.add(s.device_id));
    phoneCalls.forEach((c) => allIds.add(c.device_id));
    devices.forEach((d) => allIds.add(d.id));
    return Array.from(allIds)
      .map((id) => ({ id, label: deviceNameById(id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [smsMessages, phoneCalls, devices]);

  const filteredSms = useMemo(() => {
    return smsMessages
      .filter((s) => {
        if (smsDeviceFilter !== 'all' && s.device_id !== smsDeviceFilter) return false;
        const t = new Date(s.occurred_at).getTime();
        if (smsFilterFrom) {
          const from = new Date(smsFilterFrom).getTime();
          if (t < from) return false;
        }
        if (smsFilterTo) {
          const to = new Date(smsFilterTo).getTime();
          if (t > to) return false;
        }
        const q = smsSearchQuery.toLowerCase();
        return (
          !q ||
          (s.address || '').toLowerCase().includes(q) ||
          (s.contact_name || '').toLowerCase().includes(q) ||
          (s.body || '').toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
      );
  }, [smsMessages, smsSearchQuery, smsFilterFrom, smsFilterTo, smsDeviceFilter]);

  const filteredCalls = useMemo(() => {
    return phoneCalls
      .filter((c) => {
        if (callDeviceFilter !== 'all' && c.device_id !== callDeviceFilter) return false;
        const t = new Date(c.occurred_at).getTime();
        if (callFilterFrom) {
          const from = new Date(callFilterFrom).getTime();
          if (t < from) return false;
        }
        if (callFilterTo) {
          const to = new Date(callFilterTo).getTime();
          if (t > to) return false;
        }
        const q = callSearchQuery.toLowerCase();
        return (
          !q ||
          (c.phone_number || '').toLowerCase().includes(q) ||
          (c.contact_name || '').toLowerCase().includes(q) ||
          (c.call_type || '').toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
      );
  }, [phoneCalls, callSearchQuery, callFilterFrom, callFilterTo, callDeviceFilter]);

  const groupedCallsByDate = useMemo(() => {
    const todayKey = new Date().toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toDateString();
    const map = new Map<string, { key: string; label: string; calls: PhoneCallRow[] }>();
    for (const c of filteredCalls) {
      const dt = new Date(c.occurred_at);
      const key = dt.toDateString();
      if (!map.has(key)) {
        const label =
          key === todayKey ? 'Today' : key === yesterdayKey ? 'Yesterday' : dt.toLocaleDateString();
        map.set(key, {
          key,
          label,
          calls: [],
        });
      }
      map.get(key)!.calls.push(c);
    }
    return Array.from(map.values()).sort((a, b) => {
      const at = new Date(a.key).getTime();
      const bt = new Date(b.key).getTime();
      return bt - at;
    });
  }, [filteredCalls]);

  const viewTitle =
    currentView === 'sms'
      ? 'SMS (native)'
      : currentView === 'calls'
        ? 'Call log'
        : currentView;

  const selectedOrder = selectedOrderRef ? orders.find(o => o.order_ref === selectedOrderRef) || null : null;
  const selectedOrderMessages = selectedOrder
    ? messages
        .filter(m => (m.order_ref || null) === selectedOrder.order_ref)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : [];

  const contacts = Array.from(new Set(messages.map(m => m.sender_name))).map(name => {
    const contactMessages = messages.filter(m => m.sender_name === name);
    return {
      name,
      count: contactMessages.length,
      lastSeen: contactMessages[0].created_at,
      lastApp: contactMessages[0].app_source,
      notes: contactMessages.find(m => m.notes)?.notes || ''
    };
  }).sort((a,b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

  const unreadCount = messages.filter(m => !m.is_read && !m.archived).length;
  const onlineDevicesCount = devices.filter(d => (new Date().getTime() - new Date(d.last_seen).getTime()) < 300000).length;
  const openOrdersCount = orders.filter(o => {
    const st = (o.status || '').toLowerCase();
    return st !== 'paid' && st !== 'delivered' && st !== 'cancelled';
  }).length;

  const exportMessagesCsv = () => {
    downloadCsv(
      `messages-${new Date().toISOString().slice(0, 10)}.csv`,
      filteredMessages.map((m) => ({ ...m }) as Record<string, unknown>)
    );
  };

  const exportOrdersCsv = () => {
    downloadCsv(
      `orders-${new Date().toISOString().slice(0, 10)}.csv`,
      filteredOrders.map((o) => ({ ...o }) as Record<string, unknown>)
    );
  };

  const saveCurrentView = () => {
    const name = savedViewNameDraft.trim() || `View ${savedViews.length + 1}`;
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sv-${Date.now()}`;
    const v: SavedView = {
      id,
      name,
      currentView,
      activeTab,
      activeStatus,
      activeOrderStatus,
      searchQuery,
      orderSearchQuery,
    };
    const next = [...savedViews.filter((s) => s.name !== name), v];
    setSavedViews(next);
    persistSavedViews(next);
    setSavedViewNameDraft('');
  };

  const applySavedView = (v: SavedView) => {
    setCurrentView(v.currentView as typeof currentView);
    setActiveTab(v.activeTab);
    setActiveStatus(v.activeStatus as typeof activeStatus);
    setActiveOrderStatus(v.activeOrderStatus as typeof activeOrderStatus);
    setSearchQuery(v.searchQuery);
    setOrderSearchQuery(v.orderSearchQuery);
  };

  const tryUnlockPin = () => {
    if (pinInput === dashboardPin) {
      sessionStorage.setItem(PIN_SESSION_KEY, '1');
      setPinUnlocked(true);
      setPinInput('');
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      if (typeof window !== 'undefined') window.location.href = '/login';
    }
  };

  const saveProfileFromSettings = () => {
    try {
      saveProfile({ name: profileNameDraft, avatarDataUrl: profileAvatar });
      setProfileName(profileNameDraft.trim() || 'Admin');
      setProfileBanner('Profile updated.');
    } catch {
      setProfileBanner('Could not save profile on this browser.');
    }
  };

  const resetPassword = async () => {
    setUserMgmtBanner(null);
    setUserMgmtBusy(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentUsername,
          currentPassword,
          newUsername,
          newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUserMgmtBanner(data?.error || 'Password reset failed.');
        return;
      }
      setUserMgmtBanner('Credentials updated. Use them on next login.');
      setCurrentPassword('');
      setNewPassword('');
      setCurrentUsername(newUsername.trim());
    } catch {
      setUserMgmtBanner('Password reset failed.');
    } finally {
      setUserMgmtBusy(false);
    }
  };

  const saveSecuritySettings = async () => {
    setSecurityBanner(null);
    setSecurityBusy(true);
    try {
      const ips = allowedIpsDraft
        .split(/\s|,|;/)
        .map((v) => v.trim())
        .filter(Boolean);
      const res = await fetch('/api/security/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedIps: ips }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSecurityBanner(data?.error || 'Could not save security settings.');
        return;
      }
      setAllowedIpsDraft((Array.isArray(data?.allowedIps) ? data.allowedIps : ips).join('\n'));
      setSecurityBanner('Security settings saved. Changes apply within about 1 minute.');
    } catch {
      setSecurityBanner('Could not save security settings.');
    } finally {
      setSecurityBusy(false);
    }
  };

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050510] text-slate-500 text-sm">
        Loading dashboard…
      </div>
    );
  }

  if (dashboardPin && !pinUnlocked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#050510] p-6 text-slate-200">
        <Wallet className="mb-4 h-12 w-12 text-amber-400/80" />
        <h1 className="mb-2 text-xl font-semibold">Wallet Hub</h1>
        <p className="mb-6 max-w-sm text-center text-sm text-slate-500">
          Enter the dashboard PIN set in <code className="text-slate-400">NEXT_PUBLIC_DASHBOARD_PIN</code>.
        </p>
        <input
          type="password"
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && tryUnlockPin()}
          className="mb-4 w-full max-w-xs rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40"
          placeholder="PIN"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={tryUnlockPin}
          className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Unlock
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#050510] text-slate-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-20 lg:w-64 border-r border-slate-800 flex flex-col items-center lg:items-stretch bg-[#0A0A1F] z-20">
        <div className="p-6">
          <h1 className="text-xl font-bold hidden lg:block bg-gradient-to-r from-amber-200 via-amber-400 to-indigo-400 bg-clip-text text-transparent">Wallet Hub</h1>
          <div className="lg:hidden rounded-xl bg-gradient-to-br from-amber-500/30 to-indigo-600/40 p-2 ring-1 ring-amber-500/20">
            <Wallet size={24} className="text-amber-200" />
          </div>
        </div>
        
        <nav className="flex-1 mt-6 space-y-4 px-3">
          <div className="space-y-1">
            <button 
              onClick={() => { setCurrentView('inbox'); setActiveTab('all'); setActiveStatus('all'); setSelectedMessage(null); setSelectedOrderRef(null); setIsNoteEditing(false); }}
              className={`w-full flex items-center p-3 rounded-xl transition-all ${currentView === 'inbox' ? 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              <MessageSquare size={20} className="mr-3" />
              <span className="hidden lg:block flex-1 text-left">Messages</span>
              {unreadCount > 0 && <span className="hidden lg:block bg-indigo-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{unreadCount}</span>}
            </button>
            <button
              onClick={() => { setCurrentView('orders'); setActiveOrderStatus('all'); setSelectedOrderRef(null); setSelectedMessage(null); setIsNoteEditing(false); }}
              className={`w-full flex items-center p-3 rounded-xl transition-all ${currentView === 'orders' ? 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              <Archive size={20} className="mr-3" />
              <span className="hidden lg:block flex-1 text-left">Orders</span>
              {openOrdersCount > 0 && <span className="hidden lg:block bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{openOrdersCount}</span>}
            </button>
            <button 
              onClick={() => { setCurrentView('contacts'); setSelectedMessage(null); setSelectedOrderRef(null); setIsNoteEditing(false); }}
              className={`w-full flex items-center p-3 rounded-xl transition-all ${currentView === 'contacts' ? 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              <Users size={20} className="mr-3" />
              <span className="hidden lg:block">Contacts</span>
            </button>
            <button
              onClick={() => {
                setCurrentView('sms');
                setSelectedMessage(null);
                setSelectedOrderRef(null);
                setIsNoteEditing(false);
              }}
              className={`w-full flex items-center p-3 rounded-xl transition-all ${currentView === 'sms' ? 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              <Mail size={20} className="mr-3" />
              <span className="hidden lg:block">SMS</span>
            </button>
            <button
              onClick={() => {
                setCurrentView('calls');
                setSelectedMessage(null);
                setSelectedOrderRef(null);
                setIsNoteEditing(false);
              }}
              className={`w-full flex items-center p-3 rounded-xl transition-all ${currentView === 'calls' ? 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              <Phone size={20} className="mr-3" />
              <span className="hidden lg:block">Calls</span>
            </button>
            <button 
              onClick={() => { setCurrentView('devices'); setSelectedMessage(null); setSelectedOrderRef(null); setIsNoteEditing(false); }}
              className={`w-full flex items-center p-3 rounded-xl transition-all ${currentView === 'devices' ? 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              <Smartphone size={20} className="mr-3" />
              <span className="hidden lg:block flex-1 text-left">Devices</span>
              {onlineDevicesCount > 0 && <span className="hidden lg:block bg-green-500 w-2 h-2 rounded-full animate-pulse"></span>}
            </button>
            <button 
              onClick={() => { setCurrentView('settings'); setSelectedMessage(null); setSelectedOrderRef(null); setIsNoteEditing(false); }}
              className={`w-full flex items-center p-3 rounded-xl transition-all ${currentView === 'settings' ? 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              <Settings size={20} className="mr-3" />
              <span className="hidden lg:block">Settings</span>
            </button>
          </div>
        </nav>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-[#0A0A1F]/80 backdrop-blur-xl z-10">
          <div className="flex items-center space-x-6">
            <h2 className="text-lg font-semibold capitalize">{viewTitle}</h2>
            {currentView === 'inbox' && (
              <div className="flex bg-slate-800/50 p-1 rounded-lg flex-wrap gap-1">
                <button onClick={() => setActiveStatus('all')} className={`px-4 py-1 rounded-md text-xs font-medium transition-all ${activeStatus === 'all' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500'}`}>All</button>
                <button onClick={() => setActiveStatus('unread')} className={`px-4 py-1 rounded-md text-xs font-medium transition-all ${activeStatus === 'unread' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500'}`}>Unread</button>
                <button onClick={() => setActiveStatus('read')} className={`px-4 py-1 rounded-md text-xs font-medium transition-all ${activeStatus === 'read' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500'}`}>Read</button>
                <button onClick={() => setActiveStatus('archived')} className={`px-4 py-1 rounded-md text-xs font-medium transition-all ${activeStatus === 'archived' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500'}`}>Archived</button>
              </div>
            )}
            {currentView === 'orders' && (
              <div className="flex bg-slate-800/50 p-1 rounded-lg">
                <button onClick={() => setActiveOrderStatus('all')} className={`px-4 py-1 rounded-md text-xs font-medium transition-all ${activeOrderStatus === 'all' ? 'bg-amber-500 text-white shadow-lg' : 'text-slate-500'}`}>All</button>
                <button onClick={() => setActiveOrderStatus('processing')} className={`px-4 py-1 rounded-md text-xs font-medium transition-all ${activeOrderStatus === 'processing' ? 'bg-amber-500 text-white shadow-lg' : 'text-slate-500'}`}>Processing</button>
                <button onClick={() => setActiveOrderStatus('paid')} className={`px-4 py-1 rounded-md text-xs font-medium transition-all ${activeOrderStatus === 'paid' ? 'bg-amber-500 text-white shadow-lg' : 'text-slate-500'}`}>Paid</button>
                <button onClick={() => setActiveOrderStatus('failed')} className={`px-4 py-1 rounded-md text-xs font-medium transition-all ${activeOrderStatus === 'failed' ? 'bg-amber-500 text-white shadow-lg' : 'text-slate-500'}`}>Failed</button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
             <button
               type="button"
               onClick={() => loadDashboardData({ showRefreshing: true })}
               disabled={isRefreshing}
               title="Refresh data from Supabase"
               className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:border-slate-600 disabled:opacity-50"
             >
               <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
               <span className="hidden sm:inline">Refresh</span>
             </button>
             {lastSyncedAt && (
               <span className="hidden text-[10px] text-slate-500 md:inline" title="Last successful data fetch">
                 Updated {new Date(lastSyncedAt).toLocaleString()}
               </span>
             )}
             {realtimeStatus === 'live' ? (
               <div
                 className="hidden sm:flex items-center bg-emerald-500/10 border border-emerald-500/25 px-3 py-1.5 rounded-full"
                 title="Connected to Supabase Realtime; data also refreshes every 25s and when you return to this tab."
               >
                 <Activity size={14} className="text-emerald-400 mr-2" />
                 <span className="text-[10px] font-bold text-emerald-400/90 uppercase tracking-widest">Live sync</span>
               </div>
             ) : realtimeStatus === 'error' ? (
               <button
                 type="button"
                 onClick={() => typeof window !== 'undefined' && window.location.reload()}
                 className="hidden sm:flex items-center bg-amber-500/10 border border-amber-500/25 px-3 py-1.5 rounded-full hover:bg-amber-500/20"
                 title="Realtime connection issue; click to reload the page and reconnect. Polling still runs every 25s."
               >
                 <Wifi size={14} className="text-amber-400 mr-2" />
                 <span className="text-[10px] font-bold text-amber-300 uppercase tracking-widest">Sync limited — retry</span>
               </button>
             ) : (
               <div className="hidden sm:flex items-center bg-slate-800/50 border border-slate-700/50 px-3 py-1.5 rounded-full">
                 <Activity size={14} className="text-slate-500 mr-2 animate-pulse" />
                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Connecting…</span>
               </div>
             )}
             {onlineDevicesCount > 0 ? (
               <div className="flex items-center bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-full">
                 <Radio size={14} className="text-green-500 mr-2 animate-pulse" />
                 <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest">{onlineDevicesCount} Devices Live</span>
               </div>
             ) : (
               <div className="flex items-center bg-slate-800/50 border border-slate-700/50 px-3 py-1.5 rounded-full">
                 <Wifi size={14} className="text-slate-500 mr-2" />
                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">No Devices Connected</span>
               </div>
             )}
             <Link
               href="/profile"
               title="Profile settings"
               className="flex max-w-[200px] items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800/80 py-1 pl-1 pr-3 transition hover:border-indigo-500/40 hover:bg-slate-800"
             >
               {profileAvatar ? (
                 <img
                   src={profileAvatar}
                   alt=""
                   className="h-9 w-9 shrink-0 rounded-lg object-cover"
                 />
               ) : (
                 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/25 text-[11px] font-bold text-indigo-200">
                   {profileInitials(profileName)}
                 </div>
               )}
               <span className="hidden truncate text-xs font-bold text-slate-200 sm:inline">
                 {profileName}
               </span>
             </Link>
             <button
               type="button"
               onClick={logout}
               className="rounded-lg border border-slate-700 bg-slate-900/70 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:border-slate-600"
               title="Sign out"
             >
               Logout
             </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 custom-scrollbar relative">
          {fetchError && (
            <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              <p className="font-semibold text-rose-200">Could not load data from Supabase</p>
              <p className="mt-1 text-rose-100/90 break-words">{fetchError}</p>
              <p className="mt-2 text-xs text-rose-200/70">
                Check <code className="rounded bg-black/30 px-1">web-dashboard/.env.local</code>, then restart <code className="rounded bg-black/30 px-1">npm run dev</code>.
              </p>
            </div>
          )}
          {fetchWarnings.length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <p className="font-semibold text-amber-200">Supabase / sync notices</p>
              <p className="mt-1 text-xs text-amber-200/75">
                Not every item means a table is missing — includes RLS, API keys, and transient server errors.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-100/90">
                {fetchWarnings.map((w, i) => (
                  <li key={`${i}-${w.slice(0, 24)}`} className="break-words">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AnimatePresence mode="wait">
            {currentView === 'inbox' && (
              <motion.div key="inbox" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <div className="mb-3 rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
                  This inbox is for <span className="text-slate-300">social and messenger apps</span> (WhatsApp, Telegram, Facebook / Marketplace, Snapchat, etc.) via notification capture on your phone — not native SMS. Each message is <span className="text-slate-300">tagged by app</span> so you can filter and handle orders by channel.
                </div>
                {inboxAppFilters.length > 0 && (
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">App</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('all')}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-all ${
                        activeTab === 'all'
                          ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/30'
                          : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      All
                    </button>
                    {inboxAppFilters.map(([pkg, label]) => {
                      const meta = getAppSourceMeta(pkg);
                      const active = activeTab === pkg;
                      return (
                        <button
                          key={pkg}
                          type="button"
                          title={pkg}
                          onClick={() => setActiveTab(pkg)}
                          className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-all ${
                            active
                              ? `${meta.chipClass} ring-1 ring-white/20`
                              : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600'
                          } ${!active ? 'opacity-90' : ''}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mb-4 flex flex-col gap-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="relative max-w-md flex-1 group">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                      <input
                        type="text"
                        placeholder="Search sender, message, or app (e.g. Telegram)..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={messageDeviceFilter}
                        onChange={(e) => setMessageDeviceFilter(e.target.value)}
                        className="rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-2 text-xs font-bold text-slate-300"
                        title="Filter messages by device"
                      >
                        <option value="all">All devices</option>
                        {deviceFilterOptions.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={exportMessagesCsv}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-bold text-slate-300 hover:border-slate-600"
                      >
                        <Download size={14} /> Export CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => setMessageFetchLimit((n) => n + 100)}
                        className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs font-bold text-slate-400 hover:border-slate-600"
                      >
                        Load more ({messageFetchLimit} from server)
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-900/30 px-3 py-2">
                    <Filter size={14} className="shrink-0 text-slate-500" />
                    <select
                      className="max-w-[180px] rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300"
                      value={savedViewPicker}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSavedViewPicker('');
                        const v = savedViews.find((s) => s.id === id);
                        if (v) applySavedView(v);
                      }}
                    >
                      <option value="">
                        Saved views…
                      </option>
                      {savedViews.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={savedViewNameDraft}
                      onChange={(e) => setSavedViewNameDraft(e.target.value)}
                      placeholder="Name for current filters"
                      className="min-w-[120px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300"
                    />
                    <button
                      type="button"
                      onClick={saveCurrentView}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      Save view
                    </button>
                  </div>
                </div>

                {filteredMessages.length === 0 ? (
                  <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-3 px-4 py-12 text-center text-slate-500">
                    {messages.length > 0 ? (
                      <>
                        <p className="text-sm font-semibold text-slate-300 not-italic">
                          No messages match your filters
                        </p>
                        <p className="text-xs leading-relaxed not-italic">
                          Try <span className="text-slate-400">All</span> app chip,{' '}
                          <span className="text-slate-400">All devices</span>, clear search, and set status to{' '}
                          <span className="text-slate-400">Active</span> (non-archived).
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-slate-300 not-italic">
                          No social messages loaded yet
                        </p>
                        {healthSnapshot?.supabaseAdminConfigured &&
                        healthSnapshot.tableCounts &&
                        healthSnapshot.tableCounts.messages != null &&
                        healthSnapshot.tableCounts.messages > 0 ? (
                          <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100 not-italic">
                            Server-side count: <span className="font-mono">{healthSnapshot.tableCounts.messages}</span>{' '}
                            row(s) in <span className="font-mono">public.messages</span>, but this browser loaded none.
                            SMS and calls use other tables, so they can still show. Fix: enable a SELECT policy for the{' '}
                            <span className="font-mono">anon</span> role on <span className="font-mono">messages</span>{' '}
                            — run <span className="font-mono">supabase/rls_anon_policies.sql</span> (or the RLS section
                            of <span className="font-mono">schema.sql</span>) in Supabase SQL.
                          </p>
                        ) : null}
                        {healthSnapshot?.supabaseAdminConfigured &&
                        healthSnapshot.tableCounts &&
                        healthSnapshot.tableCounts.messages === 0 ? (
                          <p className="rounded-xl border border-slate-600/80 bg-slate-800/40 px-3 py-2 text-xs leading-relaxed text-slate-300 not-italic">
                            Server-side count: <span className="font-mono">0</span> rows in{' '}
                            <span className="font-mono">public.messages</span> (SMS/calls are synced separately). On the
                            phone: grant notification access, disable per-app blocklist in this app if you use it, and
                            trigger a new chat notification — or open the in-app capture log to see upload errors.
                          </p>
                        ) : null}
                        {!healthSnapshot?.supabaseAdminConfigured ? (
                          <p className="text-[11px] leading-relaxed text-slate-500 not-italic">
                            Tip: set <span className="font-mono text-slate-400">SUPABASE_SERVICE_ROLE_KEY</span> in{' '}
                            <span className="font-mono text-slate-400">.env.local</span> so this dashboard can compare
                            server row counts with what the browser loads (spots RLS vs empty table).
                          </p>
                        ) : null}
                        <p className="text-xs leading-relaxed not-italic">
                          On the phone: grant notification access to this app, open the main screen once, and ensure
                          WhatsApp/Telegram/etc. show message text in notifications (not “silent” or hide content).
                        </p>
                        <p className="text-xs leading-relaxed not-italic">
                          In Supabase: open <span className="font-mono text-slate-400">public.messages</span> in Table
                          Editor. If rows exist there but nothing appears here, Row Level Security is usually blocking the
                          anon key — run <span className="font-mono text-slate-400">supabase/rls_anon_policies.sql</span>{' '}
                          in the SQL editor (same project as{' '}
                          <span className="font-mono text-slate-400">NEXT_PUBLIC_SUPABASE_*</span>).
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {filteredMessages.map((msg) => {
                      const appMeta = getAppSourceMeta(msg.app_source);
                      return (
                      <div
                        key={msg.id}
                        onClick={() => {
                          setSelectedMessage(msg);
                          setSelectedOrderRef(null);
                          setIsNoteEditing(false);
                          setNoteText(msg.notes || '');
                        }}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col space-y-3 ${selectedMessage?.id === msg.id ? 'bg-indigo-500/10 border-indigo-500/50' : 'bg-[#0E0E25] border-slate-800/50 hover:border-slate-700'}`}
                      >
                        <div className="flex justify-between items-start gap-3">
                           <div className="flex items-center space-x-3 min-w-0">
                              <div className="w-10 h-10 shrink-0 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">{msg.sender_name?.[0]}</div>
                              <div className="min-w-0">
                                 <h3 className="font-bold text-slate-100 truncate">{msg.sender_name} {!msg.is_read && <span className="inline-block w-2 h-2 bg-indigo-500 rounded-full ml-1"></span>}</h3>
                                 <div className="mt-1 flex flex-wrap items-center gap-2">
                                   <span className={appSourcePillClass(appMeta)} title={msg.app_source}>
                                     {appMeta.label}
                                   </span>
                                   <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                     {new Date(msg.created_at).toLocaleTimeString()}
                                   </span>
                                 </div>
                                 {msg.order_ref && (
                                   <div className="mt-2">
                                     <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
                                       {msg.order_ref}
                                     </span>
                                   </div>
                                 )}
                              </div>
                           </div>
                        </div>
                        <p className="text-sm text-slate-300 line-clamp-2">{msg.message_text}</p>
                        <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-widest pt-2 border-t border-slate-800/30">
                           <div className="flex space-x-4">
                              <button onClick={(e) => { e.stopPropagation(); handleAction(msg.id, { is_read: !msg.is_read }); }}>{msg.is_read ? 'Unattend' : 'Mark Attend'}</button>
                              <button onClick={(e) => { e.stopPropagation(); handleAction(msg.id, { archived: !msg.archived }); }}>{msg.archived ? 'Restore' : 'Archive'}</button>
                           </div>
                           {msg.notes && <span className="text-amber-500 flex items-center"><StickyNote size={10} className="mr-1" /> Has Note</span>}
                        </div>
                      </div>
                    );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {currentView === 'orders' && (
              <motion.div
                key="orders"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative max-w-md flex-1 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                    <input
                      type="text"
                      placeholder="Search order ref or last message..."
                      value={orderSearchQuery}
                      onChange={(e) => setOrderSearchQuery(e.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-amber-500/50"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setGroupOrdersByApp((v) => !v)}
                      className={`rounded-lg border px-3 py-2 text-xs font-bold ${
                        groupOrdersByApp
                          ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                          : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      Group by app
                    </button>
                    <button
                      type="button"
                      onClick={exportOrdersCsv}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-bold text-slate-300 hover:border-slate-600"
                    >
                      <Download size={14} /> Export CSV
                    </button>
                  </div>
                </div>

                {filteredOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-600 italic">
                    No orders found here
                  </div>
                ) : groupOrdersByApp ? (
                  <div className="space-y-8">
                    {ordersGroupedByApp.map(([appKey, rows]) => (
                      <div key={appKey} className="space-y-3">
                        <div className="flex items-baseline gap-2 border-b border-slate-800/80 pb-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-amber-500/90">
                            {rows[0].appLabel}
                          </span>
                          {appKey !== '__unknown__' && (
                            <span className="font-mono text-[10px] text-slate-600" title="App package">
                              {appKey}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          {rows.map(({ order }) => {
                            const linkedCount = messages.filter(
                              (m) => (m.order_ref || null) === order.order_ref
                            ).length;
                            const lastAt = order.last_message_at || order.updated_at || '';
                            return (
                              <div
                                key={order.order_ref}
                                onClick={() => {
                                  setSelectedOrderRef(order.order_ref);
                                  setSelectedMessage(null);
                                  setIsNoteEditing(false);
                                  setReplyText('');
                                  setCopyFeedback(false);
                                }}
                                className={`flex cursor-pointer flex-col space-y-3 rounded-2xl border p-4 transition-all ${
                                  selectedOrderRef === order.order_ref
                                    ? 'border-amber-500/40 bg-amber-500/10'
                                    : 'border-slate-800/50 bg-[#0E0E25] hover:border-slate-700'
                                }`}
                              >
                                <div className="flex items-start justify-between">
                                  <div>
                                    <h3 className="font-bold text-slate-100">{order.order_ref}</h3>
                                    <div className="mt-2 flex items-center space-x-2">
                                      {renderOrderStatusPill(order.status)}
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                        {linkedCount} msg
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                      {lastAt ? new Date(lastAt).toLocaleString() : '—'}
                                    </p>
                                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                      {order.amount && order.currency ? `${order.amount} ${order.currency}` : ''}
                                    </p>
                                  </div>
                                </div>
                                {order.last_message_text && (
                                  <p className="line-clamp-2 text-sm text-slate-300">{order.last_message_text}</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {filteredOrders.map((order) => {
                      const linkedCount = messages.filter(
                        (m) => (m.order_ref || null) === order.order_ref
                      ).length;
                      const lastAt = order.last_message_at || order.updated_at || '';
                      return (
                        <div
                          key={order.order_ref}
                          onClick={() => {
                            setSelectedOrderRef(order.order_ref);
                            setSelectedMessage(null);
                            setIsNoteEditing(false);
                            setReplyText('');
                            setCopyFeedback(false);
                          }}
                          className={`flex cursor-pointer flex-col space-y-3 rounded-2xl border p-4 transition-all ${
                            selectedOrderRef === order.order_ref
                              ? 'border-amber-500/40 bg-amber-500/10'
                              : 'border-slate-800/50 bg-[#0E0E25] hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-bold text-slate-100">{order.order_ref}</h3>
                              <div className="mt-2 flex items-center space-x-2">
                                {renderOrderStatusPill(order.status)}
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                  {linkedCount} msg
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                {lastAt ? new Date(lastAt).toLocaleString() : '—'}
                              </p>
                              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                {order.amount && order.currency ? `${order.amount} ${order.currency}` : ''}
                              </p>
                            </div>
                          </div>
                          {order.last_message_text && (
                            <p className="line-clamp-2 text-sm text-slate-300">{order.last_message_text}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {currentView === 'contacts' && (
              <motion.div key="contacts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {contacts.map(contact => (
                  <div key={contact.name} className="bg-[#0E0E25] border border-slate-800 p-5 rounded-2xl hover:border-indigo-500/50 transition-all group">
                    <div className="flex items-center space-x-4 mb-4">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-xl font-bold text-indigo-400">{contact.name[0]}</div>
                      <div>
                        <h4 className="font-bold">{contact.name}</h4>
                        <p className="text-[10px] text-slate-500 uppercase font-bold">{contact.count} Total Messages</p>
                      </div>
                    </div>
                    <div className="space-y-2 mb-4">
                       <div className="flex items-center text-xs text-slate-400"><Clock size={12} className="mr-2" /> Last seen: {new Date(contact.lastSeen).toLocaleDateString()}</div>
                       <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                         <Smartphone size={12} className="shrink-0" />
                         <span>Source:</span>
                         <span className={appSourcePillClass(getAppSourceMeta(contact.lastApp))} title={contact.lastApp}>
                           {getAppSourceMeta(contact.lastApp).label}
                         </span>
                       </div>
                    </div>
                    {contact.notes && <div className="text-[10px] text-amber-300/60 bg-amber-500/10 p-2 rounded-lg mb-4 italic line-clamp-2">"{contact.notes}"</div>}
                    <button
                      onClick={() => {
                        setSearchQuery(contact.name);
                        setCurrentView('inbox');
                        setActiveStatus('all');
                        setSelectedMessage(null);
                        setSelectedOrderRef(null);
                        setIsNoteEditing(false);
                      }}
                      className="w-full py-2 bg-slate-800 group-hover:bg-indigo-600 rounded-xl text-xs font-bold transition-all"
                    >
                      View History
                    </button>
                  </div>
                ))}
              </motion.div>
            )}

            {currentView === 'sms' && (
              <motion.div
                key="sms"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="mb-4 rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
                  Full native SMS text from the phone (Telephony provider). Third‑party apps such as WhatsApp or Telegram are not included — use the Messages inbox for notification captures from those apps. Saved names match the phone when the app can read contacts (same idea as the call log).
                </div>
                <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-6">
                  <div className="relative max-w-md flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                    <input
                      type="text"
                      placeholder="Search number or message body..."
                      value={smsSearchQuery}
                      onChange={(e) => setSmsSearchQuery(e.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Device
                      </label>
                      <select
                        value={smsDeviceFilter}
                        onChange={(e) => setSmsDeviceFilter(e.target.value)}
                        className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/50"
                      >
                        <option value="all">All devices</option>
                        {deviceFilterOptions.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        From
                      </label>
                      <input
                        type="datetime-local"
                        value={smsFilterFrom}
                        onChange={(e) => setSmsFilterFrom(e.target.value)}
                        className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        To
                      </label>
                      <input
                        type="datetime-local"
                        value={smsFilterTo}
                        onChange={(e) => setSmsFilterTo(e.target.value)}
                        className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                    {(smsFilterFrom || smsFilterTo || smsDeviceFilter !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSmsFilterFrom('');
                          setSmsFilterTo('');
                          setSmsDeviceFilter('all');
                        }}
                        className="rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </div>
                <p className="mb-4 text-[11px] text-slate-500">
                  Newest messages appear first. Use Device and From / To to narrow the results.
                </p>
                {filteredSms.length === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center italic text-slate-600">
                    {smsMessages.length > 0
                      ? 'No SMS match your search or date range. Adjust filters or clear the range.'
                      : 'No SMS synced yet. On the phone: open the app → allow SMS and call log → sync.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {filteredSms.map((s) => (
                      <div
                        key={s.id}
                        className="flex flex-col space-y-3 rounded-2xl border border-slate-800/50 bg-[#0E0E25] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="font-bold text-slate-100">
                              {s.contact_name || s.address}
                            </h3>
                            {s.contact_name && (
                              <p className="font-mono text-xs text-slate-500">{s.address}</p>
                            )}
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              {deviceNameById(s.device_id)} · {s.sms_box}
                              {s.read_flag ? '' : ' · unread'}
                            </p>
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            {new Date(s.occurred_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-800/80 bg-slate-900/50 p-3 text-sm leading-relaxed text-slate-200">
                          {s.body}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {currentView === 'calls' && (
              <motion.div
                key="calls"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="mb-4 rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
                  Native Android call history. Sync requires READ_CALL_LOG on the device.
                </div>
                <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-6">
                  <div className="relative max-w-md flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                    <input
                      type="text"
                      placeholder="Search number, name, or type..."
                      value={callSearchQuery}
                      onChange={(e) => setCallSearchQuery(e.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Device
                      </label>
                      <select
                        value={callDeviceFilter}
                        onChange={(e) => setCallDeviceFilter(e.target.value)}
                        className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/50"
                      >
                        <option value="all">All devices</option>
                        {deviceFilterOptions.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        From
                      </label>
                      <input
                        type="datetime-local"
                        value={callFilterFrom}
                        onChange={(e) => setCallFilterFrom(e.target.value)}
                        className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        To
                      </label>
                      <input
                        type="datetime-local"
                        value={callFilterTo}
                        onChange={(e) => setCallFilterTo(e.target.value)}
                        className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                    {(callFilterFrom || callFilterTo || callDeviceFilter !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setCallFilterFrom('');
                          setCallFilterTo('');
                          setCallDeviceFilter('all');
                        }}
                        className="rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </div>
                <p className="mb-4 text-[11px] text-slate-500">
                  Newest calls appear first. Use Device and From / To to narrow the results.
                </p>
                {filteredCalls.length === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center italic text-slate-600">
                    {phoneCalls.length > 0
                      ? 'No calls match your search or date range. Adjust filters or clear the range.'
                      : 'No calls synced yet. On the phone: open the app → allow SMS and call log → sync.'}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {groupedCallsByDate.map((group) => {
                      const collapsed = !!collapsedCallDateSections[group.key];
                      return (
                      <section key={group.key} className="space-y-3">
                        <div className="sticky top-[-1rem] z-10 -mx-4 border-b border-slate-700 bg-[#050510] px-5 py-3 backdrop-blur-md shadow-[0_6px_16px_rgba(0,0,0,0.45)] lg:top-[-1.5rem] lg:-mx-6 lg:px-7">
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsedCallDateSections((prev) => ({
                                ...prev,
                                [group.key]: !prev[group.key],
                              }))
                            }
                            className="flex min-h-[28px] w-full items-center justify-between text-left"
                          >
                            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                              {group.label}
                            </h4>
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                              {collapsed ? 'Show' : 'Hide'} ({group.calls.length})
                            </span>
                          </button>
                        </div>
                        {!collapsed && <div className="space-y-3">
                          {group.calls.map((c) => {
                      const dur = c.duration_seconds;
                      const durLabel =
                        dur < 60 ? `${dur}s` : `${Math.floor(dur / 60)}m ${dur % 60}s`;
                      const typeColor =
                        c.call_type === 'missed'
                          ? 'text-rose-400'
                          : c.call_type === 'incoming'
                            ? 'text-emerald-400'
                            : c.call_type === 'outgoing'
                              ? 'text-sky-400'
                              : 'text-slate-400';
                            return (
                              <div
                                key={c.id}
                                className="rounded-2xl border border-slate-800/50 bg-[#0E0E25] p-4"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <h3 className="font-bold text-slate-100">
                                      {c.contact_name || c.phone_number}
                                    </h3>
                                    {c.contact_name && (
                                      <p className="font-mono text-xs text-slate-500">{c.phone_number}</p>
                                    )}
                                    <p className="mt-1 text-[10px] text-slate-500">
                                      {deviceNameById(c.device_id)}
                                    </p>
                                  </div>
                                  <span className={`text-[10px] font-bold uppercase ${typeColor}`}>
                                    {c.call_type}
                                  </span>
                                </div>
                                <div className="mt-3 flex items-center justify-between border-t border-slate-800/50 pt-3 text-xs text-slate-400">
                                  <span>{new Date(c.occurred_at).toLocaleString()}</span>
                                  <span className="font-mono text-slate-300">{durLabel}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>}
                      </section>
                    )})}
                  </div>
                )}
              </motion.div>
            )}

            {currentView === 'devices' && (
              <motion.div key="devices" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                   {devices.map(device => {
                     const isLive = (new Date().getTime() - new Date(device.last_seen).getTime()) < 300000;
                     const label = device.device_name || 'Device';
                     const sep = label.indexOf(' · ');
                     const friendlyTitle = sep >= 0 ? label.slice(0, sep) : label;
                     const hardwareSubtitle = sep >= 0 ? label.slice(sep + 3) : null;
                     return (
                       <div key={device.id} className="bg-[#0E0E25] border border-slate-800 p-6 rounded-3xl relative overflow-hidden group">
                         {isLive && <div className="absolute top-0 right-0 p-3"><span className="flex h-3 w-3 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]"></span></div>}
                         <div className="flex items-center space-x-5 mb-6">
                           <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-colors ${isLive ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-slate-800/50 border-slate-700/50 text-slate-500'}`}>
                             <Smartphone size={28} />
                           </div>
                           <div className="min-w-0 flex-1">
                              <h4 className="font-bold text-lg leading-snug break-words">{friendlyTitle}</h4>
                              {hardwareSubtitle && (
                                <p className="mt-1 text-xs text-slate-500 leading-snug break-words">{hardwareSubtitle}</p>
                              )}
                              <p className={`mt-1 text-[10px] font-bold uppercase tracking-widest ${isLive ? 'text-green-500' : 'text-slate-500'}`}>{isLive ? 'Connected' : 'Offline'}</p>
                           </div>
                         </div>
                         <div className="space-y-3 pt-4 border-t border-slate-800/50">
                            <div className="flex justify-between items-center text-xs">
                               <span className="text-slate-500">Status</span>
                               <span className={isLive ? 'text-green-400 font-medium' : 'text-slate-400'}>{isLive ? 'Active Sync' : 'Last seen ' + new Date(device.last_seen).toLocaleDateString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                               <span className="text-slate-500">Device ID</span>
                               <span className="font-mono text-slate-400">{device.id.slice(0, 8)}...</span>
                            </div>
                         </div>
                       </div>
                     )
                   })}
                </div>

                {devices.length === 0 && (
                  <div className="bg-indigo-500/5 border border-dashed border-indigo-500/20 p-12 rounded-3xl text-center space-y-4">
                    <Smartphone size={48} className="mx-auto text-slate-700 mb-4" />
                    <h3 className="text-xl font-bold">No Devices Listed</h3>
                    <p className="text-slate-500 max-w-sm mx-auto">Install the Android APK on your phone and open it to see it appear here instantly.</p>
                    <button onClick={() => setCurrentView('settings')} className="text-indigo-400 font-bold border-b border-indigo-400/30 pb-1">View Setup Guide</button>
                  </div>
                )}
              </motion.div>
            )}

            {currentView === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-2xl space-y-8">
                <section className="bg-[#0E0E25] border border-slate-800 p-8 rounded-3xl space-y-6">
                  <div className="flex items-center space-x-3 text-indigo-400"><Database size={24} /> <h3 className="text-xl font-bold text-white">Supabase Connection</h3></div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                       <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Project URL</p>
                       <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                         <code className="text-xs text-indigo-300 break-all">{supabaseUrl || 'Not configured'}</code>
                       </div>
                    </div>
                    <div className="space-y-2">
                       <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">API Key (Anon)</p>
                       <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                         <code className="text-xs text-indigo-300">••••••••••••••••••••••••••••••</code>
                         <ShieldCheck className="text-green-500" size={16} />
                       </div>
                    </div>
                  </div>
                </section>

                <section className="bg-[#0E0E25] border border-slate-800 p-8 rounded-3xl space-y-6">
                  <div className="flex items-center space-x-3 text-indigo-400">
                    <User size={24} />
                    <h3 className="text-xl font-bold text-white">User management</h3>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Profile</p>
                    <p className="text-sm text-slate-400">
                      Update your display name shown in the dashboard header.
                    </p>
                    <input
                      value={profileNameDraft}
                      onChange={(e) => setProfileNameDraft(e.target.value)}
                      placeholder="Display name"
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/40"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={saveProfileFromSettings}
                        className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                      >
                        Save profile
                      </button>
                      <Link
                        href="/profile"
                        className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800"
                      >
                        Edit photo
                      </Link>
                    </div>
                    {profileBanner && <p className="text-xs text-emerald-300">{profileBanner}</p>}
                  </div>

                  <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Password reset</p>
                    <p className="text-sm text-slate-400">
                      Change login username/password. You must confirm current credentials.
                    </p>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <input
                        value={currentUsername}
                        onChange={(e) => setCurrentUsername(e.target.value)}
                        placeholder="Current username"
                        className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/40"
                      />
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Current password"
                        className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/40"
                      />
                      <input
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        placeholder="New username"
                        className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/40"
                      />
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password (min 12 chars)"
                        className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/40"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={userMgmtBusy}
                      onClick={resetPassword}
                      className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-60"
                    >
                      {userMgmtBusy ? 'Updating...' : 'Update login credentials'}
                    </button>
                    {userMgmtBanner && <p className="text-xs text-amber-200">{userMgmtBanner}</p>}
                  </div>
                </section>

                <section className="bg-[#0E0E25] border border-slate-800 p-8 rounded-3xl space-y-4">
                  <div className="flex items-center space-x-3 text-indigo-400">
                    <ShieldCheck size={24} />
                    <h3 className="text-xl font-bold text-white">Security controls</h3>
                  </div>
                  <p className="text-sm text-slate-400">
                    Manage allowed source IPs without code changes. Leave empty to allow all IPs.
                    One IP per line or comma-separated.
                  </p>
                  <textarea
                    value={allowedIpsDraft}
                    onChange={(e) => setAllowedIpsDraft(e.target.value)}
                    rows={5}
                    placeholder={`203.0.113.10\n198.51.100.22`}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={saveSecuritySettings}
                      disabled={securityBusy}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                    >
                      {securityBusy ? 'Saving...' : 'Save allowlist'}
                    </button>
                  </div>
                  {securityBanner && <p className="text-xs text-indigo-200">{securityBanner}</p>}
                </section>

                <section className="bg-indigo-500/5 border border-indigo-500/20 p-8 rounded-3xl space-y-4">
                   <div className="flex items-center space-x-3 text-indigo-400"><Info size={24} /> <h3 className="text-lg font-bold text-white">Setup Guide</h3></div>
                   <p className="text-sm text-slate-400 leading-relaxed italic">"Keep your business inbox synced by following these steps on every new device."</p>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                     <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800">
                        <div className="font-bold text-xs mb-2 text-indigo-400 underline">1. Android App</div>
                        <p className="text-[10px] text-slate-500">Deploy the Kotlin service from the `android-app` folder. Grant "Notification Access" after installation. The phone will appear in the "Devices" tab immediately.</p>
                     </div>
                     <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800">
                        <div className="font-bold text-xs mb-2 text-indigo-400 underline">2. Database Update</div>
                        <p className="text-[10px] text-slate-500">Run the included `supabase/schema.sql` to create `devices`, `messages` (with `message_fingerprint`), and `orders` tables.</p>
                     </div>
                   </div>
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Detail Sidebar */}
      <AnimatePresence>
        {selectedOrder && (
          <motion.aside
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            key="order-detail"
            className="w-80 lg:w-96 border-l border-slate-800 bg-[#0A0A1F] shadow-[-20px_0_40px_rgba(0,0,0,0.5)] z-30 flex flex-col"
          >
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-lg">Order Detail</h3>
              <button
                onClick={() => setSelectedOrderRef(null)}
                className="p-2 hover:bg-slate-800 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                      Order Ref
                    </div>
                    <h4 className="text-xl font-bold">{selectedOrder.order_ref}</h4>
                    <div className="mt-2">{renderOrderStatusPill(selectedOrder.status)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                      Amount
                    </div>
                    <div className="text-sm font-bold text-slate-100">
                      {selectedOrder.amount && selectedOrder.currency
                        ? `${selectedOrder.amount} ${selectedOrder.currency}`
                        : '—'}
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                  <p className="text-[10px] font-bold text-amber-300 uppercase tracking-widest mb-2">
                    Latest Message
                  </p>
                  <p className="text-sm text-slate-200 leading-relaxed">
                    {selectedOrder.last_message_text || 'No messages yet...'}
                  </p>
                  {selectedOrder.last_message_at && (
                    <p className="text-[10px] text-slate-500 mt-2 text-right italic">
                      {new Date(selectedOrder.last_message_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-bold text-amber-300 uppercase tracking-widest pl-1">
                  Update Status
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleOrderUpdate(selectedOrder.order_ref, { status: 'processing' })}
                    className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20"
                  >
                    Processing
                  </button>
                  <button
                    onClick={() => handleOrderUpdate(selectedOrder.order_ref, { status: 'paid' })}
                    className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 hover:bg-green-500/20"
                  >
                    Paid
                  </button>
                  <button
                    onClick={() => handleOrderUpdate(selectedOrder.order_ref, { status: 'delivered' })}
                    className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20 hover:bg-teal-500/20"
                  >
                    Delivered
                  </button>
                  <button
                    onClick={() => handleOrderUpdate(selectedOrder.order_ref, { status: 'failed' })}
                    className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20"
                  >
                    Failed
                  </button>
                  <button
                    onClick={() => handleOrderUpdate(selectedOrder.order_ref, { status: 'refunded' })}
                    className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20"
                  >
                    Refunded
                  </button>
                  <button
                    onClick={() => handleOrderUpdate(selectedOrder.order_ref, { status: 'cancelled' })}
                    className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-slate-500/10 border border-slate-500/20 hover:bg-slate-500/20"
                  >
                    Cancelled
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">
                  Linked Messages ({selectedOrderMessages.length})
                </p>

                {selectedOrderMessages.length === 0 ? (
                  <div className="text-slate-600 italic">No linked messages yet.</div>
                ) : (
                  <div className="space-y-3">
                    {selectedOrderMessages.slice(0, 12).map((m) => (
                      <div
                        key={m.id}
                        onClick={() => {
                          setSelectedMessage(m);
                          setSelectedOrderRef(null);
                          setIsNoteEditing(false);
                          setNoteText(m.notes || '');
                        }}
                        className="p-3 rounded-2xl border border-slate-800 bg-[#0E0E25] hover:border-amber-500/30 cursor-pointer"
                      >
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest truncate">
                              {m.sender_name}
                            </div>
                            <span className={`${appSourcePillClass(getAppSourceMeta(m.app_source))} mt-1`} title={m.app_source}>
                              {getAppSourceMeta(m.app_source).label}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest shrink-0">
                            {new Date(m.created_at).toLocaleTimeString()}
                          </div>
                        </div>
                        <p className="text-sm text-slate-200 line-clamp-2">{m.message_text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.aside>
        )}

        {selectedMessage && (
          <motion.aside
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            key="message-detail"
            className="w-80 lg:w-96 border-l border-slate-800 bg-[#0A0A1F] shadow-[-20px_0_40px_rgba(0,0,0,0.5)] z-30 flex flex-col"
          >
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-lg">Message Detail</h3>
              <button onClick={() => setSelectedMessage(null)} className="p-2 hover:bg-slate-800 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
              <div className="text-center space-y-4">
                <div className="w-20 h-20 mx-auto rounded-3xl bg-indigo-500/10 flex items-center justify-center text-3xl font-bold text-indigo-400 border border-indigo-500/20">
                  {selectedMessage.sender_name?.[0]}
                </div>
                <div>
                  <h4 className="text-xl font-bold">{selectedMessage.sender_name}</h4>
                  <div className="mt-2 flex flex-col items-center gap-1">
                    <span
                      className={appSourcePillClass(getAppSourceMeta(selectedMessage.app_source))}
                      title={selectedMessage.app_source}
                    >
                      {getAppSourceMeta(selectedMessage.app_source).label}
                    </span>
                    <p className="text-[10px] font-mono text-slate-500 break-all max-w-full text-center leading-snug">
                      {selectedMessage.app_source}
                    </p>
                  </div>
                </div>
              </div>

              {selectedMessage.order_ref && (
                <div className="flex justify-center">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Order</span>
                    <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-1 rounded-lg">
                      {selectedMessage.order_ref}
                    </span>
                  </div>
                </div>
              )}

              {(selectedMessage.order_status_hint || selectedMessage.amount || selectedMessage.currency) && (
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  {selectedMessage.order_status_hint && renderOrderStatusPill(selectedMessage.order_status_hint)}
                  {selectedMessage.amount && selectedMessage.currency && (
                    <span className="text-[11px] font-bold text-slate-200 bg-slate-900/50 border border-slate-800 px-3 py-1 rounded-full">
                      {selectedMessage.amount} {selectedMessage.currency}
                    </span>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Message Context</p>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                  <p className="text-sm leading-relaxed text-slate-300">{selectedMessage.message_text}</p>
                  <p className="text-[10px] text-slate-500 mt-2 text-right italic">
                    {new Date(selectedMessage.created_at).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Business Notes</p>
                  <button
                    onClick={() => setIsNoteEditing(!isNoteEditing)}
                    className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider"
                  >
                    {selectedMessage.notes ? 'Edit' : 'Add Note'}
                  </button>
                </div>
                {isNoteEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add business context..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm min-h-[100px] outline-none"
                    />
                    <div className="flex justify-end space-x-2">
                      <button onClick={() => setIsNoteEditing(false)} className="text-xs text-slate-500 font-bold px-3">
                        Cancel
                      </button>
                      <button onClick={saveNote} className="bg-indigo-600 text-[10px] font-bold px-4 py-1.5 rounded-lg">
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-500/5 border border-amber-500/10 p-4 rounded-xl text-xs text-amber-200/60 italic leading-loose">
                    "{selectedMessage.notes || 'No internal notes yet...'}"
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-900/30 space-y-4">
              <div>
                <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2 flex items-center">
                  <MessageCircle size={10} className="mr-1" /> Quick Draft Reply
                </p>
                <div className="bg-slate-900 rounded-2xl p-3 border border-slate-800">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type your response here..."
                    className="w-full bg-transparent text-sm resize-none outline-none h-20"
                  />
                  <button
                    onClick={handleCopyAndAttend}
                    disabled={!replyText}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center ${
                      copyFeedback ? 'bg-green-600' : 'bg-indigo-600 hover:bg-indigo-500'
                    }`}
                  >
                    {copyFeedback ? (
                      <>
                        <ClipboardCheck size={16} className="mr-2" /> Copied!
                      </>
                    ) : (
                      <>
                        <Send size={16} className="mr-2" /> Copy & Mark Attend
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e1e3f; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #2e2e5f; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
