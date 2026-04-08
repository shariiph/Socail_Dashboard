export const PROFILE_NAME_KEY = 'social-inbox-profile-name';
export const PROFILE_AVATAR_KEY = 'social-inbox-profile-avatar';

export type StoredProfile = {
  name: string;
  avatarDataUrl: string | null;
};

const DEFAULT_NAME = 'Admin';

export function getProfile(): StoredProfile {
  if (typeof window === 'undefined') {
    return { name: DEFAULT_NAME, avatarDataUrl: null };
  }
  const name = localStorage.getItem(PROFILE_NAME_KEY)?.trim() || DEFAULT_NAME;
  const avatar = localStorage.getItem(PROFILE_AVATAR_KEY);
  return { name, avatarDataUrl: avatar || null };
}

export function saveProfile(profile: StoredProfile): void {
  const name = profile.name.trim() || DEFAULT_NAME;
  localStorage.setItem(PROFILE_NAME_KEY, name);
  if (profile.avatarDataUrl) {
    localStorage.setItem(PROFILE_AVATAR_KEY, profile.avatarDataUrl);
  } else {
    localStorage.removeItem(PROFILE_AVATAR_KEY);
  }
  window.dispatchEvent(new Event('social-inbox-profile-updated'));
}

export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function fileToAvatarDataUrl(
  file: File,
  maxEdge = 320,
  quality = 0.88
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(maxEdge / img.width, maxEdge / img.height, 1);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not process image.'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length > 1_200_000) {
        reject(new Error('Image is still too large after resizing. Try a smaller photo.'));
        return;
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read that image.'));
    };
    img.src = objectUrl;
  });
}
