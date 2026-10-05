// GameCoin quickstart: grant gems to a player, spend some, and sell a pack.
//
//   npm install @apilow/gamecoin
//   GAMECOIN_SECRET_KEY=gc_sk_test_... node quickstart.mjs
//
// Optional: GAMECOIN_BASE_URL (defaults to https://gamecoin.apilow.com).
// From a clone of this repository, run `npm run build` first, then `node examples/quickstart.mjs`.
import { GameCoin, GameCoinError, ErrorCode, ext } from "@apilow/gamecoin";

if (!process.env.GAMECOIN_SECRET_KEY) {
  console.error("Set GAMECOIN_SECRET_KEY to a secret key (gc_sk_test_...) of your game.");
  process.exit(1);
}

const gamecoin = new GameCoin(process.env.GAMECOIN_SECRET_KEY, { baseUrl: process.env.GAMECOIN_BASE_URL });
console.log(`Environment: ${gamecoin.environment}`);

// Your own id for the player, turned into a GameCoin player reference. An unknown player is created by the first write.
const player = ext("quickstart-player");

// 1. Grant: the idempotency key is generated for you and reused by every retry.
const grant = await gamecoin.wallet.grant(player, { currency: "gems", amount: 100, reason: "welcome" });
console.log(`Granted 100 gems, balance is now ${grant.balance.total} ${grant.balance.currency}`);

// 2. Spend.
try {
  const spend = await gamecoin.wallet.spend(player, { currency: "gems", amount: 30, reason: "revive" });
  console.log(`Spent 30 gems, balance is now ${spend.balance.total}`);
} catch (error) {
  // A refused spend is an ordinary answer of the API, not a crash.
  if (error instanceof GameCoinError && error.code === ErrorCode.INSUFFICIENT_FUNDS) {
    console.log(`Not enough gems: needs ${error.details.required}, has ${error.details.available}`);
  } else {
    throw error;
  }
}

// 3. Sell a pack: send the player to the hosted payment page.
const { order, checkoutUrl } = await gamecoin.checkouts.create(player, { packSku: "gems-500" });
console.log(`Order ${order.id} is ${order.status}: ${order.amountCents / 100} EUR, pay at ${checkoutUrl}`);

// 4. The newest ledger entries.
let shown = 0;
for await (const entry of gamecoin.ledger.iterate(player, { currency: "gems" })) {
  console.log(`  ${entry.createdAt.toISOString()} ${entry.type} ${entry.paidDelta + entry.bonusDelta}`);
  if (++shown === 3) break;
}
