import { escapeHtml } from './escape';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

// Round avatar image, or an initials placeholder when the user has none.
// `sizeClass` controls the dimensions via CSS (e.g. "search-result-avatar");
// the placeholder also gets "<sizeClass>-placeholder".
export function avatarHtml(
  user: { displayName: string; avatar: string | null },
  sizeClass: string
): string {
  return user.avatar
    ? `<img class="${sizeClass}" src="${escapeHtml(user.avatar)}" alt="${escapeHtml(user.displayName)}" />`
    : `<div class="${sizeClass} ${sizeClass}-placeholder">${escapeHtml(initials(user.displayName))}</div>`;
}
