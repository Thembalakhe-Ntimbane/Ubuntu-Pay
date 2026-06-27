import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { posts } from '../db/schema';

// Seeds a handful of demo articles by a fictional journalist the first time the
// app boots against an empty `posts` table. Idempotent: if any post already
// exists it does nothing, so it's safe to call on every startup (and a re-seed
// is as simple as clearing the table). Prices are in MAJOR units — the unlock
// route converts them to the receiver wallet's currency at pay time.

const JOURNALIST = 'Amara Okafor';

// Set `streaming: true` (with a `streamLimit` cap, in MAJOR units) on exactly one
// post to make it the special live-streaming, free-to-read article. The flag lives
// in the data so editing a title can't silently break it.
const SEED_POSTS: ReadonlyArray<{
  title:        string;
  category:     string;
  price:        string;
  excerpt:      string;
  body:         string;
  streaming?:   boolean;
  streamLimit?: string;
}> = [
  {
    title:    'Inside the Rails: How Interledger Moves Value Like Packets',
    category: 'Explainer',
    price:    '0.05',
    excerpt:
      'Money has never moved the way information does — until now. A quiet protocol borrows the ' +
      'internet\'s oldest idea and applies it to payments: break the value into packets, route each ' +
      'one over whatever path is cheapest, and reassemble it on the far side.',
    body:
      'For decades, sending money abroad meant trusting a chain of correspondent banks, each taking a ' +
      'cut and a day. Interledger flips that model on its head. Instead of one ledger talking to another, ' +
      'it treats a payment the way the internet treats a file: as a stream of small packets, each routed ' +
      'independently across a mesh of connectors.\n\n' +
      'The genius is in the settlement. No single connector ever holds your whole payment — they pass ' +
      'tiny increments forward, and a cryptographic "fulfillment" only releases once the money has ' +
      'provably arrived. If a path fails midway, the packets simply stop; nothing is lost.\n\n' +
      'What this unlocks is striking: payments that are too small to be worth a card swipe, sent ' +
      'continuously, across currencies, with no shared account between sender and receiver. That is the ' +
      'foundation the whole Web Monetization idea is built on — and the reason this very article could ' +
      'charge you a few cents to read it.',
  },
  {
    title:    'The Cent That Pays for Itself: Web Monetization and the End of the Ad',
    category: 'Opinion',
    price:    '0.10',
    excerpt:
      'We were promised a web funded by attention. We got one funded by surveillance. There is a third ' +
      'option hiding in a humble HTML tag — and it asks for cents, not your data.',
    body:
      'Every "free" article you read is paid for, just not by you. It is paid for by the slow trade of ' +
      'your attention and your behavioural data to whoever bids highest. Web Monetization proposes ' +
      'something almost nostalgically simple: you pay the writer directly, a fraction of a cent at a time, ' +
      'and nobody has to watch you do it.\n\n' +
      'A single line — a link element with rel="monetization" pointing at a payment pointer — turns any ' +
      'page into a place that can receive money. The browser, with the reader\'s chosen provider, opens a ' +
      'payment session and streams value while the page is open. No login walls. No cookie banners pleading ' +
      'for consent to track you.\n\n' +
      'Is it a panacea? No. Wallets and provider support are still early. But the shape of the thing is ' +
      'right: it aligns the reader, the writer, and the browser around the same incentive — good work, ' +
      'fairly paid, privately. The advertisement spent twenty years optimising against you. This optimises ' +
      'for you.',
  },
  {
    title:    'Remittances Without the Middleman\'s Cut',
    category: 'Feature',
    price:    '0.08',
    excerpt:
      'A nurse in Cape Town sends money home each month and loses a tenth of it to fees along the way. ' +
      'Open Payments wants to give that tenth back — and the early numbers from testnet are hard to argue with.',
    body:
      'The global average cost of sending a remittance still hovers near seven percent. For the corridors ' +
      'that need it most — small amounts, sent often, to places banks ignore — it is frequently worse. ' +
      'Open Payments, the API layer that sits on top of Interledger, is trying to make that cost a rounding ' +
      'error.\n\n' +
      'The flow is deliberately boring, which is the point: resolve the receiver\'s wallet address, create ' +
      'an incoming payment, quote it from the sender\'s wallet, get the sender\'s consent once, and execute. ' +
      'Each step is a standard HTTP call signed with the sender\'s key. No proprietary SDK lock-in, no ' +
      'bilateral banking relationship required.\n\n' +
      'The same primitives that let this newsroom charge you a few cents to read are what let that nurse ' +
      'send a month\'s support across a border in seconds. Micropayments and remittances turn out to be the ' +
      'same problem at two different scales — and one protocol now answers both.',
  },
  {
    title:       'Streaming Money: What Happens When Payment Is Continuous',
    category:    'Analysis',
    price:       '0.12',
    streaming:   true,
    streamLimit: '0.50', // session stops once this much has streamed
    excerpt:
      'One-off payments are a snapshot. A payment session is a film. When value can flow by the second, the ' +
      'business models we built around the checkout button start to look quaint.',
    body:
      'The Payment Request API gave the web a checkout. Web Monetization gives it a tap that can be left ' +
      'running. The distinction matters more than it sounds: a payment session is not a single transaction ' +
      'but an open channel along which many payments flow for as long as the reader stays.\n\n' +
      'Think of what that enables. A podcast that earns per minute actually listened. A long read that the ' +
      'author is paid for in proportion to how far you get. Software that bills for the seconds of compute ' +
      'you use, not a flat monthly tier you forget to cancel.\n\n' +
      'There are hard questions — how providers expose spend controls, how receivers verify what truly ' +
      'arrived, how to keep any of it private. But the primitive is here, specified, and being implemented. ' +
      'The checkout button had a good run. The meter that simply runs while value is exchanged may be what ' +
      'comes next.',
  },
];

export async function seedNews(): Promise<void> {
  const existing = await db.select({ id: posts.id }).from(posts).limit(1);

  if (existing.length === 0) {
    const now = Date.now();
    await db.insert(posts).values(
      SEED_POSTS.map((p, i) => ({
        id:           crypto.randomUUID(),
        authorName:   JOURNALIST,
        authorAvatar: null,
        title:        p.title,
        excerpt:      p.excerpt,
        body:         p.body,
        category:     p.category,
        price:        p.price,
        streaming:    p.streaming ?? false,
        freeToRead:   p.streaming ?? false, // streaming articles are free to read
        streamLimit:  p.streamLimit ?? null,
        // Stagger timestamps so the newest seeded post sorts first.
        createdAt:    new Date(now - i * 60_000),
      })),
    );
    console.log(`[seed] Inserted ${SEED_POSTS.length} News posts by ${JOURNALIST}`);
  }

  // Re-apply the streaming flags every boot (idempotent) so a database seeded by
  // an earlier version picks them up. Keyed off the same SEED_POSTS data.
  for (const p of SEED_POSTS) {
    if (!p.streaming) continue;
    await db
      .update(posts)
      .set({ streaming: true, freeToRead: true, streamLimit: p.streamLimit ?? null })
      .where(eq(posts.title, p.title));
  }
}
