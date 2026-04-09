const KEY = 'wallet-hub-saved-views-v1';

export type SavedView = {
  id: string;
  name: string;
  currentView: string;
  activeTab: string;
  activeStatus: string;
  activeOrderStatus: string;
  searchQuery: string;
  orderSearchQuery: string;
};

export function loadSavedViews(): SavedView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? (p as SavedView[]) : [];
  } catch {
    return [];
  }
}

export function persistSavedViews(views: SavedView[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(views));
}
