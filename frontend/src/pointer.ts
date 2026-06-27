// Wallet addresses are stored and sent to the API as https URLs
// (e.g. https://ilp.interledger-test.dev/alice), but people know them as
// payment pointers ($ilp.interledger-test.dev/alice). Use this whenever a
// wallet address is shown to the user; the backend's normaliseWalletAddress
// converts the $-form back to https on input.
export function toPointer(walletAddress: string): string {
  if (walletAddress.startsWith('$')) return walletAddress;
  return walletAddress.replace(/^https?:\/\//, '$');
}
