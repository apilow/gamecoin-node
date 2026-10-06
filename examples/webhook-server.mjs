// GameCoin webhook receiver: verifies the signature of every call, then reacts to the event.
//
//   npm install @apilow/gamecoin express
//   GAMECOIN_WEBHOOK_SECRET=whsec_gc_... node webhook-server.mjs
//
// Declare http://localhost:3000/gamecoin/webhook as an endpoint in the dashboard (the test environment accepts
// `http` towards localhost), copy its signing secret into GAMECOIN_WEBHOOK_SECRET, then send a `webhook.test` event.
// From a clone of this repository, run `npm run build` first; `express` must be installed where the script can find it.
import express from "express";
import { WebhookEventType, WebhookSignatureError, isKnownWebhookEvent, webhooks } from "@apilow/gamecoin";

const secret = process.env.GAMECOIN_WEBHOOK_SECRET;
if (!secret) {
  console.error("Set GAMECOIN_WEBHOOK_SECRET to the signing secret (whsec_gc_...) of your endpoint.");
  process.exit(1);
}

const app = express();
const processed = new Set(); // use your database: GameCoin can send the same event more than once

// express.raw keeps the body exactly as received, which is what the signature covers. Never use express.json() here.
app.post("/gamecoin/webhook", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = webhooks.constructEvent(req.body, req.get("GameCoin-Signature"), secret);
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      console.warn(`Refused a webhook call: ${error.reason}`);
      return res.sendStatus(400);
    }
    throw error;
  }

  if (processed.has(event.id)) return res.sendStatus(200); // a repeated event: nothing to do
  processed.add(event.id);

  if (isKnownWebhookEvent(event)) {
    switch (event.type) {
      case WebhookEventType.ORDER_FULFILLED:
        console.log(`Order ${event.data.id} delivered to player ${event.data.playerId} (${event.data.pack.sku})`);
        break;
      case WebhookEventType.ORDER_REFUNDED:
      case WebhookEventType.ORDER_CHARGEBACK:
        console.log(`Order ${event.data.id} is ${event.data.status}: its coins and items were taken back`);
        break;
      case WebhookEventType.WALLET_CREDITED:
        console.log(`Player ${event.data.playerId} received ${JSON.stringify(event.data.credits)}`);
        break;
      case WebhookEventType.WEBHOOK_TEST:
        console.log(`Test event: ${event.data.message}`);
        break;
    }
  }
  res.sendStatus(200); // answer within 10 seconds; do the heavy work afterwards
});

app.listen(3000, () => console.log("Listening on http://localhost:3000/gamecoin/webhook"));
