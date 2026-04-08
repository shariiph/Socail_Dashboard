/**
 * Maps Android package names (messages.app_source) to a short label + chip styles for the dashboard.
 */

export type AppSourceMeta = {
  label: string;
  /** Tailwind classes for the pill (border + text + bg) */
  chipClass: string;
};

const defaultMeta = (packageName: string): AppSourceMeta => {
  const parts = packageName.split('.').filter(Boolean);
  const last = parts[parts.length - 1] || packageName;
  const label =
    last.length <= 1
      ? packageName
      : last.charAt(0).toUpperCase() + last.slice(1).replace(/_/g, ' ');
  return {
    label,
    chipClass: 'bg-slate-800/80 text-slate-200 border-slate-600/60',
  };
};

export function getAppSourceMeta(packageName: string): AppSourceMeta {
  const p = packageName.toLowerCase();

  const rules: { test: (s: string) => boolean; meta: AppSourceMeta }[] = [
    { test: (s) => s.includes('whatsapp'), meta: { label: 'WhatsApp', chipClass: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/35' } },
    { test: (s) => s.includes('telegram'), meta: { label: 'Telegram', chipClass: 'bg-sky-500/15 text-sky-200 border-sky-500/35' } },
    { test: (s) => s.includes('facebook.orca') || s.includes('messenger'), meta: { label: 'Messenger', chipClass: 'bg-blue-500/15 text-blue-200 border-blue-500/35' } },
    { test: (s) => s.includes('facebook.katana') || (s.includes('facebook') && s.includes('lite')), meta: { label: 'Facebook', chipClass: 'bg-blue-600/15 text-blue-100 border-blue-500/35' } },
    { test: (s) => s.includes('facebook'), meta: { label: 'Facebook', chipClass: 'bg-blue-600/15 text-blue-100 border-blue-500/35' } },
    { test: (s) => s.includes('instagram'), meta: { label: 'Instagram', chipClass: 'bg-pink-500/15 text-pink-200 border-pink-500/35' } },
    { test: (s) => s.includes('snapchat'), meta: { label: 'Snapchat', chipClass: 'bg-yellow-500/10 text-yellow-200 border-yellow-500/30' } },
    { test: (s) => s.includes('viber'), meta: { label: 'Viber', chipClass: 'bg-violet-500/15 text-violet-200 border-violet-500/35' } },
    { test: (s) => s.includes('signal'), meta: { label: 'Signal', chipClass: 'bg-blue-400/10 text-blue-100 border-blue-400/30' } },
    { test: (s) => s.includes('twitter') || s.includes('.x.'), meta: { label: 'X / Twitter', chipClass: 'bg-slate-600/40 text-slate-100 border-slate-500/40' } },
    { test: (s) => s.includes('tiktok'), meta: { label: 'TikTok', chipClass: 'bg-rose-500/15 text-rose-200 border-rose-500/30' } },
    { test: (s) => s.includes('linkedin'), meta: { label: 'LinkedIn', chipClass: 'bg-sky-700/20 text-sky-100 border-sky-600/35' } },
    { test: (s) => s.includes('discord'), meta: { label: 'Discord', chipClass: 'bg-indigo-500/15 text-indigo-200 border-indigo-500/35' } },
    { test: (s) => s.includes('slack'), meta: { label: 'Slack', chipClass: 'bg-emerald-800/30 text-emerald-100 border-emerald-600/35' } },
    { test: (s) => s.includes('wechat'), meta: { label: 'WeChat', chipClass: 'bg-green-800/25 text-green-100 border-green-600/35' } },
    { test: (s) => s.includes('line.') || s.endsWith('.line'), meta: { label: 'LINE', chipClass: 'bg-green-500/15 text-green-200 border-green-500/35' } },
    { test: (s) => s.includes('reddit'), meta: { label: 'Reddit', chipClass: 'bg-orange-600/15 text-orange-200 border-orange-500/35' } },
  ];

  for (const { test, meta } of rules) {
    if (test(p)) return meta;
  }

  return defaultMeta(packageName);
}

export function appSourcePillClass(meta: AppSourceMeta): string {
  return `inline-flex items-center rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.chipClass}`;
}
