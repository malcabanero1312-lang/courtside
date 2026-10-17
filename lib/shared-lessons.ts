export interface Shareable {
  id: string;
  share_group?: string | null;
  starts_at: string;
  ends_at: string;
}

export function groupShared<T extends Shareable>(list: T[]): T[][] {
  const groups: T[][] = [];
  const index = new Map<string, T[]>();
  for (const item of list) {
    if (!item.share_group) {
      groups.push([item]);
      continue;
    }
    const key = `${item.share_group}|${item.starts_at}|${item.ends_at}`;
    const existing = index.get(key);
    if (existing) {
      existing.push(item);
    } else {
      const group = [item];
      index.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}

export function splitSharedNames(raw: string): string[] {
  return raw
    .split(/\s*(?:\/|&|\+|\band\b)\s*/i)
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
