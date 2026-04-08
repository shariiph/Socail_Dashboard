'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera, Save, Trash2, User } from 'lucide-react';
import {
  getProfile,
  saveProfile,
  profileInitials,
  fileToAvatarDataUrl,
} from '@/lib/profileStorage';

export default function ProfilePage() {
  const [name, setName] = useState('Admin');
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = getProfile();
    setName(p.name);
    setAvatarDataUrl(p.avatarDataUrl);
  }, []);

  const handlePickPhoto = () => fileRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBanner(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setAvatarDataUrl(dataUrl);
    } catch (err: unknown) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Could not use that image.' });
    }
  };

  const handleSave = () => {
    setBanner(null);
    try {
      saveProfile({ name, avatarDataUrl });
      setBanner({ type: 'ok', text: 'Profile saved. It will show in the dashboard header.' });
    } catch {
      setBanner({ type: 'err', text: 'Could not save (browser storage may be full or blocked).' });
    }
  };

  const handleRemovePhoto = () => {
    setAvatarDataUrl(null);
    setBanner(null);
  };

  const initials = profileInitials(name);

  return (
    <div className="min-h-screen bg-[#050510] text-slate-100">
      <div className="mx-auto max-w-lg px-4 py-8">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-indigo-400 hover:text-indigo-300"
        >
          <ArrowLeft size={18} />
          Back to dashboard
        </Link>

        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="mt-2 text-sm text-slate-400">
          Your name and photo appear in the top-right of the dashboard. Data is stored in this browser only.
        </p>

        <div className="mt-8 rounded-3xl border border-slate-800 bg-[#0E0E25] p-6 shadow-xl">
          <div className="flex flex-col items-center">
            <div className="relative">
              <button
                type="button"
                onClick={handlePickPhoto}
                className="group relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border-2 border-slate-700 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 transition hover:border-indigo-500/50"
              >
                {avatarDataUrl ? (
                  <img
                    src={avatarDataUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-3xl font-bold text-indigo-300">{initials}</span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
                  <Camera className="text-white" size={28} />
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
              />
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">
              Tap the photo to choose a new picture (JPEG, resized automatically)
            </p>
          </div>

          <label className="mt-8 block">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Display name
            </span>
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3 focus-within:ring-2 focus-within:ring-indigo-500/40">
              <User size={18} className="text-slate-500" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
                maxLength={80}
              />
            </div>
          </label>

          {banner && (
            <div
              className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                banner.type === 'ok'
                  ? 'border-green-500/30 bg-green-500/10 text-green-200'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-100'
              }`}
            >
              {banner.text}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={handleRemovePhoto}
              disabled={!avatarDataUrl}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={18} />
              Remove photo
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-indigo-500"
            >
              <Save size={18} />
              Save profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
