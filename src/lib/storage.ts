import { AppData, DEFAULT_APP_DATA } from './types';

const STORAGE_KEY = 'fitness-tracker-data';

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_DATA };
    return { ...DEFAULT_APP_DATA, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_APP_DATA };
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function updateData(updater: (data: AppData) => AppData): AppData {
  const data = loadData();
  const updated = updater(data);
  saveData(updated);
  return updated;
}
