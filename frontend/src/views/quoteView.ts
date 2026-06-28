import { api, QuoteResponse, User, UserSearchResult } from '../api';
import { PENDING_GRANTS, WALLETS } from '../data/beneficiaries';
import { escapeHtml } from '../escape';
import { applyGrantBadges, trackPendingGrant } from '../grantQueue';
import { phaseBadgeHtml } from '../ui/brand';

/** Kept for profile links — disburse flow uses beneficiary ID search instead. */
export function presetRecipient(_user: UserSearchResult | null): void {}

export function renderQuoteView(
  container: HTMLElement,
  user: User,
  onQuote: (res: QuoteResponse) => void
): void {
  const noWallet = !user.walletAddress;

  container.innerHTML = `
    <div class="card send-card">
      <div class="send-header">
        ${phaseBadgeHtml(1, 'Government → Escrow')}
        <h2 class="send-title">Disburse Grant</h2>
        <p class="send-subtitle">SASSA — Send approved grant to Ubuntu Pay escrow</p>
      </div>

      ${noWallet ? `
        <div class="warning-msg">
          You haven't set a wallet address yet.
          <a href="#/profile">Go to Profile</a> and set your government wallet before disbursing.
        </div>
      ` : `
        <div class="field-hint gov-wallet-hint">
          Demo mode: set your profile wallet to <code>$ilp.interledger-test.dev/spaza-shop</code> (same wallet for all roles).
        </div>
      `}

      <div class="wallet-field-group">
        <div class="field">
          <label>Government Wallet</label>
          <input
            type="text"
            class="input"
            value="${escapeHtml(user.walletAddress ?? '')}"
            readonly
            disabled
          />
          <span class="field-hint">Funds leave this wallet. Backend must use matching SASSA credentials.</span>
        </div>

        <div class="field">
          <label>Escrow Wallet</label>
          <input type="text" class="input" value="${WALLETS.escrow}" readonly disabled />
          <span class="field-hint">Grant is held here until the beneficiary collects at a spaza agent.</span>
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
        <div id="disburse-error" class="error-msg" hidden></div>
        <button class="btn btn-africa-primary" id="disburse-btn">
          Disburse to Escrow
        </button>
      </div>

      <hr class="divider" />

      <div class="field">
        <label>Today's Queue</label>
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

  const searchInput   = container.querySelector<HTMLInputElement>('#id-search')!;
  const searchBtn     = container.querySelector<HTMLButtonElement>('#search-btn')!;
  const searchError   = container.querySelector<HTMLDivElement>('#search-error')!;
  const searchResult  = container.querySelector<HTMLDivElement>('#search-result')!;
  const resultName    = container.querySelector<HTMLSpanElement>('#result-name')!;
  const resultId      = container.querySelector<HTMLSpanElement>('#result-id')!;
  const resultAmount  = container.querySelector<HTMLSpanElement>('#result-amount')!;
  const disburseBtn   = container.querySelector<HTMLButtonElement>('#disburse-btn')!;
  const disburseError = container.querySelector<HTMLDivElement>('#disburse-error')!;

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

  disburseBtn.addEventListener('click', async () => {
    if (!selectedGrant || !user.walletAddress) return;

    disburseBtn.disabled    = true;
    disburseBtn.textContent = 'Processing...';
    disburseError.hidden    = true;

    try {
      const grant = selectedGrant;
      const result = await api.quote({
        senderWalletAddress:   user.walletAddress,
        receiverWalletAddress: WALLETS.escrow,
        amount:                grant.amount.toString(),
        paymentType:           'FIXED_RECEIVE',
        receiveAssetCode:      grant.assetCode,
        receiveAssetScale:     grant.assetScale,
        beneficiaryName:       grant.name,
        beneficiaryPhone:      grant.phone,
        beneficiaryLanguage:   grant.language,
      });

      trackPendingGrant(result.transactionId, grant.id, 'IN ESCROW');

      searchResult.hidden = true;
      searchInput.value   = '';
      selectedGrant       = null;

      onQuote(result);
    } catch (err: unknown) {
      disburseError.textContent = err instanceof Error ? err.message : String(err);
      disburseError.hidden      = false;
    } finally {
      disburseBtn.disabled    = false;
      disburseBtn.textContent = 'Disburse to Escrow';
    }
  });
}
