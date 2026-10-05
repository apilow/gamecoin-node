// Type-checked by scripts/check-package.mjs with module "node16": proves the `require` condition's declarations.
import gamecoinSdk = require("@apilow/gamecoin");

const { GameCoin, GameCoinError, ErrorCode, ext } = gamecoinSdk;
type Wallet = gamecoinSdk.Wallet;
type InventoryChange = gamecoinSdk.InventoryChange;

async function main(): Promise<void> {
  const gamecoin = new GameCoin("gc_sk_test_x");
  const wallet: Wallet = await gamecoin.wallet.get(ext("user-42"));
  const first: string | undefined = wallet.balances[0]?.currency;
  const potion: InventoryChange = await gamecoin.inventory.consume(ext("user-42"), { sku: "potion" });
  const left: number = potion.quantity;
  const replayed: boolean = potion.replayed;
  try {
    await gamecoin.orders.get("o1");
  } catch (error) {
    if (GameCoinError.isGameCoinError(error) && error.code === ErrorCode.NOT_FOUND) void error.status;
  }
  void [first, left, replayed];
}

void main;
