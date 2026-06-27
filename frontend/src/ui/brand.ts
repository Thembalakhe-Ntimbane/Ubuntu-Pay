const SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

/** Canonical Ubuntu “Circle of Friends” mark (orange + three figures). */
export const UBUNTU_LOGO_SVG = `
  <svg class="ubuntu-logo-svg" viewBox="0 0 118 118" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="59" cy="59" r="59" fill="#E95420"/>
    <path fill="#FFFFFF" d="M59.001 25.888c-6.945 0-12.579 5.634-12.579 12.578 0 6.946 5.634 12.58 12.579 12.58 6.946 0 12.58-5.634 12.58-12.58 0-6.944-5.634-12.578-12.58-12.578zm-23.783 13.96c-3.944 6.822-1.601 15.561 5.221 19.505 6.823 3.944 15.562 1.601 19.506-5.22 3.944-6.823 1.601-15.562-5.221-19.506-6.823-3.943-15.562-1.6-19.506 5.221zm47.565 0c-3.943 6.822-12.682 9.165-19.505 5.221-6.823-3.944-9.166-12.683-5.222-19.506 3.944-6.823 12.683-9.166 19.506-5.221 6.822 3.944 9.165 12.683 5.221 19.506zm-23.782 25.012c-6.945 0-12.579 5.634-12.579 12.578 0 6.946 5.634 12.58 12.579 12.58 6.946 0 12.58-5.634 12.58-12.58 0-6.944-5.634-12.578-12.58-12.578z"/>
  </svg>
`;

export function ubuntuLogoHtml(size: 'sm' | 'md' | 'lg' | 'xl' = 'sm'): string {
  return `<span class="ubuntu-logo ubuntu-logo--${size}">${UBUNTU_LOGO_SVG}</span>`;
}

export function wordmarkHtml(compact = false): string {
  if (compact) {
    return `
      <span class="logo-wordmark logo-wordmark--compact">
        <span class="logo-ubuntu">Ubuntu</span><span class="logo-pay">Pay</span>
      </span>
    `;
  }
  return `
    <span class="logo-wordmark">
      <span class="logo-ubuntu">Ubuntu</span><span class="logo-pay">Pay</span>
    </span>
  `;
}

export function headerLogoHtml(): string {
  return `
    <a href="#/" class="logo">
      ${ubuntuLogoHtml('sm')}
      ${wordmarkHtml(true)}
    </a>
  `;
}

export function heroLockupHtml(): string {
  return `
    <div class="hero-lockup">
      ${ubuntuLogoHtml('xl')}
      ${wordmarkHtml()}
      <p class="hero-lockup-tagline">I am because we are.</p>
    </div>
  `;
}

export function authBrandHtml(): string {
  return `
    <div class="auth-brand">
      ${ubuntuLogoHtml('lg')}
      ${wordmarkHtml()}
      <p class="auth-brand-tag">Social grants, collected locally</p>
    </div>
  `;
}

export function flowStepsHtml(): string {
  return `
    <div class="flow-steps">
      <div class="flow-step">
        <span class="flow-step-icon flow-step-icon--gov">
          <svg ${SVG}><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>
        </span>
        <span class="flow-step-label">Step 1</span>
        <span class="flow-step-name">Government</span>
      </div>
      <span class="flow-arrow" aria-hidden="true">→</span>
      <div class="flow-step">
        <span class="flow-step-icon flow-step-icon--escrow">
          <svg ${SVG}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </span>
        <span class="flow-step-label">Step 2</span>
        <span class="flow-step-name">Escrow</span>
      </div>
      <span class="flow-arrow" aria-hidden="true">→</span>
      <div class="flow-step">
        <span class="flow-step-icon flow-step-icon--agent">
          <svg ${SVG}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        </span>
        <span class="flow-step-label">Step 3</span>
        <span class="flow-step-name">Spaza Agent</span>
      </div>
    </div>
  `;
}

export function phaseBadgeHtml(step: 1 | 2, label: string): string {
  return `
    <span class="phase-badge">
      <span class="phase-badge-num">${step}</span>
      ${label}
    </span>
  `;
}
