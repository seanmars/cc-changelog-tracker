export const CATEGORIES = ['added', 'improved', 'changed', 'fixed', 'removed', 'other'] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  added: '✨ 新增',
  improved: '⚡ 改進',
  changed: '🔄 變更',
  fixed: '🐛 修正',
  removed: '🗑️ 移除',
  other: '📌 其他',
};

export interface ClassifiedRelease {
  version: string;
  summary: string;
  entries: { text: string; category: Category }[];
}
