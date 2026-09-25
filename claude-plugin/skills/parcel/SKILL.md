---
name: parcel
description: Your Parcel vault from Claude Code. /parcel shows your balance and positions, /parcel products lists what you can trade, and /parcel followed by a trade (e.g. "iron condor on NVDA, half a share") quotes it and places it once you confirm.
argument-hint: "[products | <a trade to place>]"
---

The user ran `/parcel $ARGUMENTS`. Use the Parcel MCP tools (get_vault, get_market, list_products, get_options_chain, quote_option, trade_option and the rest). If they are not available, tell the user to run /mcp, choose the Parcel server, and click Allow on the Parcel page that opens.

Decide what they want from the arguments:

- **Nothing, or balance, vault, portfolio, positions:** call get_vault and get_market. Give the total value, cash, each share balance with its dollar value, free collateral, and a short table of open positions (options, loans, shorts, borrows) saying what each is. Keep it brief.
- **products, types, what can I trade (optionally with a ticker):** call list_products and present the contracts grouped by family, one line each on what it does. Mention that any size works, down to fractions of a share.
- **Anything else is a trade to place.** Build the terms with list_products or get_options_chain, then call quote_option. Show the premium (negative means the user receives it), the most they can lose, what this trade reserves (the quote's thisTrade), and the expiry, and ask them to confirm. Only after they confirm, call trade_option with maxPremium just above the quoted premium, and report the result. Never place a trade they have not confirmed.
