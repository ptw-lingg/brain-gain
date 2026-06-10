// Shared client-side list filtering: a case-insensitive substring match of a search query against
// an entry's visible text fields. Used by every list page so the search box behaves identically.
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}
