import { api, QuoteResponse, User } from '../api';
import { PENDING_GRANTS, WALLETS, AGENT_SHOP_NAME } from '../data/beneficiaries';
import { escapeHtml } from '../escape';
import { applyGrantBadges, trackPendingGrant } from '../grantQueue';
import { phaseBadgeHtml } from '../ui/brand';

export function renderAgentView(
  container: HTMLElement,
  user: User,
  onQuote: (res: QuoteResponse) => void
): void {
  const noWallet = !user.walletAddress;

  container.innerHTML = `
    <div class="card send-card">
      <div class="send-header">
        ${phaseBadgeHtml(2, 'Escrow → Agent')}
        <h2 class="send-title">Agent Dashboard</h2>
        <p class="send-subtitle">${AGENT_SHOP_NAME} — Verify beneficiary and release grant</p>
      </div>

      ${noWallet ? `
        <div class="warning-msg">
          You haven't set a wallet address yet.
          <a href="#/profile">Go to Profile</a> and set your spaza agent wallet before releasing payments.
        </div>
      ` : ''}

      <div class="wallet-field-group">
        <div class="field">
          <label>Agent Wallet</label>
          <input
            type="text"
            class="input"
            value="${escapeHtml(user.walletAddress ?? WALLETS.agent)}"
            readonly
            disabled
          />
          <span class="field-hint">Payments are released from escrow into this wallet.</span>
        </div>

        <div class="field">
          <label>Escrow Wallet</label>
          <input type="text" class="input" value="${WALLETS.escrow}" readonly disabled />
          <span class="field-hint">Backend must use matching escrow credentials for release.</span>
        </div>
      </div>

      <hr class="divider" />

      <div class="field">
        <label>Search Beneficiary by ID Number</label>
        <div class="search-row">
          <input
            id="id-search"
            type="text"
            class="input"
            placeholder="Enter ID number..."
            autocomplete="off"
            ${noWallet ? 'disabled' : ''}
          />
          <button type="button" class="btn btn-secondary" id="search-btn" ${noWallet ? 'disabled' : ''}>Search</button>
        </div>
        <div id="search-error" class="error-msg" hidden></div>
      </div>

      <div id="search-result" hidden>
        <div class="recipient-card">
          <div class="recipient-info">
            <span class="recipient-name" id="result-name"></span>
            <span class="recipient-wallet" id="result-id"></span>
          </div>
          <span class="currency-tag" id="result-amount"></span>
        </div>
        <div id="release-error" class="error-msg" hidden></div>
        <button class="btn btn-africa-primary" id="release-btn" ${noWallet ? 'disabled' : ''}>
          Release Payment
        </button>
      </div>

      <hr class="divider" />

      <div class="field">
        <label>Pending Collections Today</label>
        <ul class="beneficiary-list" id="pending-list">
          ${PENDING_GRANTS.map(g => `
            <li class="beneficiary-item" id="grant-${g.id}" data-id="${g.id}">
              <div class="beneficiary-info">
                <span class="beneficiary-name">${escapeHtml(g.name)}</span>
                <span class="beneficiary-id">ID: ${escapeHtml(g.idNumber)}</span>
              </div>
              <span class="grant-status pending" id="status-${g.id}">PENDING</span>
            </li>
          `).join('')}
        </ul>
      </div>
    </div>
  `;

  applyGrantBadges(container);

  const searchInput  = container.querySelector<HTMLInputElement>('#id-search')!;
  const searchBtn    = container.querySelector<HTMLButtonElement>('#search-btn')!;
  const searchError  = container.querySelector<HTMLDivElement>('#search-error')!;
  const searchResult = container.querySelector<HTMLDivElement>('#search-result')!;
  const resultName   = container.querySelector<HTMLSpanElement>('#result-name')!;
  const resultId     = container.querySelector<HTMLSpanElement>('#result-id')!;
  const resultAmount = container.querySelector<HTMLSpanElement>('#result-amount')!;
  const releaseBtn   = container.querySelector<HTMLButtonElement>('#release-btn')!;
  const releaseError = container.querySelector<HTMLDivElement>('#release-error')!;

  const agentWallet = user.walletAddress ?? WALLETS.agent;
  let selectedGrant: typeof PENDING_GRANTS[0] | null = null;

  function doSearch(): void {
    searchError.hidden = true;
    const query = searchInput.value.trim();
    const found = PENDING_GRANTS.find(
      g => g.idNumber === query || g.name.toLowerCase().includes(query.toLowerCase())
    );

    if (!found) {
      searchResult.hidden = true;
      searchError.textContent = 'No beneficiary found with that ID number.';
      searchError.hidden    = false;
      return;
    }

    selectedGrant = found;
    resultName.textContent   = found.name;
    resultId.textContent     = `ID: ${found.idNumber}`;
    resultAmount.textContent = `R${found.amount / 100}`;
    searchResult.hidden      = false;
  }

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  });

  releaseBtn.addEventListener('click', async () => {
    if (!selectedGrant || noWallet) return;

    releaseBtn.disabled    = true;
    releaseBtn.textContent = 'Processing...';
    releaseError.hidden    = true;

    try {
      const grant = selectedGrant;
      const result = await api.quote({
        senderWalletAddress:   WALLETS.escrow,
        receiverWalletAddress: agentWallet,
        amount:                grant.amount.toString(),
        paymentType:           'FIXED_SEND',
        beneficiaryName:       grant.name,
        beneficiaryPhone:      grant.phone,
        beneficiaryLanguage:   grant.language,
      });

      trackPendingGrant(result.transactionId, grant.id, 'COLLECTED');

      searchResult.hidden = true;
      searchInput.value   = '';
      selectedGrant       = null;

      onQuote(result);
    } catch (err: unknown) {
      releaseError.textContent = err instanceof Error ? err.message : String(err);
      releaseError.hidden      = false;
    } finally {
      releaseBtn.disabled    = false;
      releaseBtn.textContent = 'Release Payment';
    }
  });
}
