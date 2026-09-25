# Running the demo

## 1. Start

From the repository folder:

```sh
npm run demo:devnet     # real Solana devnet transactions
npm run demo:sandbox    # no chain, nothing to fund
```

Each command stops whatever is already on port 3025, builds the desk and starts it. Leave the terminal open; Ctrl+C stops it. To switch, stop one and start the other.

`demo:devnet` needs `~/.parcel-devnet/state/devnet.env` (written when the program was deployed). If it is missing, the command says so and exits; use `demo:sandbox`. It also prints the operator's devnet SOL balance and warns if it is under 1 SOL.

## 2. Open the desk

1. Go to <http://localhost:3025> and click **Open the desk**.
2. Click **Connect Phantom**, approve the connection, then sign the message. Signing is not a transaction and costs nothing.

## 3. Connect Claude Code

1. In the desk's top bar, click **MCP**. It shows one line; run it in a terminal:
   ```sh
   curl -fsSL http://localhost:3025/claude/install | sh
   ```
2. In Claude Code, type `/mcp`, choose **parcel**, then **Authenticate**, and click **Allow** in the browser.
3. Type `/parcel`.

Sandbox and devnet each keep their own vault database, so after switching between them Claude Code needs one more **Authenticate → Allow**.

## 4. Suggested demo path

1. **Iron condor.** Trade → Structures → Volatility → Iron condor, switch to **Advanced**, and show the payoff chart and the value surface.
2. **Fixed-rate cash loan.** Lending → Borrow, pick a fixed rate.
3. **Claude Code.** Ask, one at a time:
   - "what's my balance"
   - "short NVIDIA"
   - "lend 2 shares"

   Each one appears in the Portfolio's Activity list tagged **Agent**. On devnet they run through the Parcel program on Solana devnet.

## 5. If something goes wrong

- **Operator SOL is low** (the start command warns under 1 SOL): from Phantom, set to devnet, send SOL to `7K12outW8HdaD7McqqGD2nTJW55nd7eYeqxMLVZZiQtS`. Each new onchain session holds about 0.33 SOL.
- **Desk doesn't load, or looks stuck:** Ctrl+C and run the same command again.
- **You want the sign-in screen but are already signed in:** open the wallet menu in the top bar and choose **Sign out**.
