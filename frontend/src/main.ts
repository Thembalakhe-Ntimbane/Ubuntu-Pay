import type { QuoteResponse } from './api';
import { api, User } from './api';
import { isLoggedIn } from './auth';
import type { PaymentFlow } from './paymentFlow';
import './styles.css';
import { headerLogoHtml } from './ui/brand';
import { renderAgentView } from './views/agentView';
import { renderConsentView } from './views/consentView';
import { renderHistoryView } from './views/historyView';
import { renderHomeView } from './views/homeView';
import { renderLoginView } from './views/loginView';
import { renderProfileView } from './views/profileView';
import { renderPublicProfileView } from './views/publicProfileView';
import { renderQuoteView } from './views/quoteView';
import { renderReceiveView } from './views/receiveView';
import { renderSignupView } from './views/signupView';
import { renderStatusView } from './views/statusView';

const view      = document.getElementById('view')!;
const siteLogo  = document.getElementById('site-logo')!;
const nav       = document.getElementById('main-nav')!;
const navLinks  = nav.querySelectorAll<HTMLAnchorElement>('.nav-link');

siteLogo.innerHTML = headerLogoHtml();

let pendingQuote: QuoteResponse | null = null;
let pendingFlow:  PaymentFlow         = 'remit';
let cachedUser:   User | null          = null;

function updateNav(route: string): void {
  nav.hidden = !isLoggedIn();
  navLinks.forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });
}

function showConsent(): void {
  if (!pendingQuote) {
    window.location.hash = pendingFlow === 'agent' ? '#/agent' : '#/remit';
    return;
  }
  renderConsentView(view, pendingQuote, () => {
    if (cachedUser) {
      if (pendingFlow === 'agent') void showAgent(cachedUser);
      else void showRemit(cachedUser);
    }
  });
}

function showStatus(id: string): void {
  renderStatusView(view, id);
}

async function showRemit(user: User): Promise<void> {
  pendingFlow = 'remit';
  renderQuoteView(view, user, (res: QuoteResponse) => {
    pendingQuote = res;
    showConsent();
  });
}

async function showAgent(user: User): Promise<void> {
  pendingFlow = 'agent';
  renderAgentView(view, user, (res: QuoteResponse) => {
    pendingQuote = res;
    showConsent();
  });
}

async function route(): Promise<void> {
  document.querySelectorAll('link[rel="monetization"]').forEach((l) => l.remove());

  const params   = new URLSearchParams(window.location.search);
  const returnId = params.get('id');
  if (returnId) {
    history.replaceState({}, '', window.location.pathname + '#/status');
    updateNav('');
    showStatus(returnId);
    return;
  }

  const hash = window.location.hash || '#/';
  const path = hash.slice(1);
  const segment = path.split('/')[1] ?? '';
  updateNav(segment);

  if (path === '/' || path === '') {
    renderHomeView(view);
    return;
  }
  if (path === '/login') {
    cachedUser = null;
    renderLoginView(view);
    return;
  }
  if (path === '/signup') {
    cachedUser = null;
    renderSignupView(view);
    return;
  }

  if (!isLoggedIn()) {
    cachedUser = null;
    window.location.hash = '#/login';
    return;
  }

  if (!cachedUser) {
    try {
      cachedUser = await api.auth.me();
    } catch {
      cachedUser = null;
      window.location.hash = '#/login';
      return;
    }
  }

  if (path === '/status') {
    window.location.hash = '#/';
    return;
  }
  if (path === '/remit') {
    pendingQuote = null;
    try {
      cachedUser = await api.auth.me();
    } catch {
      cachedUser = null;
      window.location.hash = '#/login';
      return;
    }
    await showRemit(cachedUser);
    return;
  }
  if (path === '/agent') {
    pendingQuote = null;
    try {
      cachedUser = await api.auth.me();
    } catch {
      cachedUser = null;
      window.location.hash = '#/login';
      return;
    }
    await showAgent(cachedUser);
    return;
  }
  if (path === '/profile') {
    await renderProfileView(view, () => { cachedUser = null; });
    return;
  }
  if (path === '/receive') {
    renderReceiveView(view, cachedUser);
    return;
  }
  if (path === '/history') {
    await renderHistoryView(view);
    return;
  }
  if (path.startsWith('/user/')) {
    const userId = path.slice('/user/'.length);
    await renderPublicProfileView(view, userId);
    return;
  }

  window.location.hash = '#/';
}

window.addEventListener('hashchange', () => route());

route();
