/** Shared formatting helpers, used by both app.js and views.js. */

export const number = new Intl.NumberFormat('en-US');

/** Escapes text for safe interpolation into an HTML template. */
export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/** 3607000000 → "$3.6B". */
export function formatUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${sign}$${Math.round(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function formatStaff(count) {
  if (!count) return '—';
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 10000) return `${Math.round(count / 1000)}k`;
  return number.format(count);
}

/** "3h ago", "2d ago" — wire copy, not exact timestamps. */
export function timeAgo(iso) {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const TIER_COLORS = {
  'human-spaceflight': 'var(--tier-5)',
  'deep-space': 'var(--tier-4)',
  'orbital-launch': 'var(--tier-3)',
  'satellite-operator': 'var(--tier-2)',
  emerging: 'var(--tier-1)',
};

/**
 * Display label for an organisation. Prefers the acronym, except where the
 * source acronym is less legible than the name — the Soviet programme is
 * recorded as "СССР", which is accurate but unreadable in a launch table.
 */
export function label(org) {
  const acronym = org.acronym;
  if (!acronym) return org.name;
  // Non-Latin acronyms are correct but not scannable for an English reader.
  if (!/^[\x20-\x7E]+$/.test(acronym)) return org.name;
  return acronym;
}

export function tierColor(tier) {
  return TIER_COLORS[tier] ?? 'var(--tier-1)';
}
