import { isLoggedIn } from '../auth';
import { flowStepsHtml, heroLockupHtml, ubuntuLogoHtml } from '../ui/brand';
import { AGENT_SHOP_NAME } from '../data/beneficiaries';

const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const icons = {
  bolt:   `<svg ${SVG_ATTRS}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  shield: `<svg ${SVG_ATTRS}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  users:  `<svg ${SVG_ATTRS}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  globe:  `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
};

export function renderHomeView(container: HTMLElement): void {
  if (isLoggedIn()) {
    renderDashboardHome(container);
  } else {
    renderPublicHome(container);
  }
}

function renderDashboardHome(container: HTMLElement): void {
  container.innerHTML = `
    <div class="home-logged-in">
      <div class="home-hero-band">
        <div class="home-hero-top">
          ${ubuntuLogoHtml('md')}
          <div class="home-hero-copy">
            <p class="home-hero-kicker">SASSA · Open Payments</p>
            <h1 class="home-hero-title">Social grants,</h1>
            <h1 class="home-hero-title home-hero-title-accent">collected at your spaza.</h1>
          </div>
        </div>
        <p class="home-hero-body">
          Disburse from government to escrow, then release at the nearest agent.
          No bank account. No smartphone.
        </p>
        <div class="home-hero-cta-row">
          <a href="#/remit" class="btn btn-africa-primary">Disburse grant →</a>
          <a href="#/agent" class="btn btn-secondary">Agent dashboard</a>
        </div>
      </div>

      ${flowStepsHtml()}

      <div class="home-pillars">
        <div class="home-pillar">
          <span class="home-pillar-icon home-pillar-icon--ubuntu">${icons.shield}</span>
          <div>
            <div class="home-pillar-label">Escrow-first</div>
            <div class="home-pillar-text">Funds sit in Ubuntu Pay escrow until the beneficiary collects in person.</div>
          </div>
        </div>
        <div class="home-pillar">
          <span class="home-pillar-icon">${icons.users}</span>
          <div>
            <div class="home-pillar-label">Spaza agents</div>
            <div class="home-pillar-text">Verify ID at ${AGENT_SHOP_NAME} and release the grant instantly.</div>
          </div>
        </div>
        <div class="home-pillar">
          <span class="home-pillar-icon">${icons.bolt}</span>
          <div>
            <div class="home-pillar-label">Instant settlement</div>
            <div class="home-pillar-text">Real-time transfers over the Interledger network.</div>
          </div>
        </div>
      </div>

      <div class="home-proverb-band">
        <p class="home-proverb">"Ubuntu — I am because we are."</p>
      </div>
    </div>
  `;
}

function renderPublicHome(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card hero">
      <div class="hero-africa-tag">${icons.globe} SASSA grant disbursement</div>
      ${heroLockupHtml()}
      <p class="hero-sub">
        Government grants, held in escrow, collected at your local spaza shop.
        Built on Interledger Open Payments — open, instant, and inclusive.
      </p>
      <div class="hero-actions">
        <a href="#/signup" class="btn btn-primary">Create account</a>
        <a href="#/login"  class="btn btn-secondary">Log in</a>
      </div>
      ${flowStepsHtml()}
      <div class="hero-features">
        <div class="feature">
          <span class="feature-icon">${icons.shield}</span>
          <span>Escrow protection</span>
        </div>
        <div class="feature">
          <span class="feature-icon">${icons.users}</span>
          <span>Agent collection</span>
        </div>
        <div class="feature">
          <span class="feature-icon">${icons.bolt}</span>
          <span>Instant payouts</span>
        </div>
      </div>
    </div>
  `;
}
