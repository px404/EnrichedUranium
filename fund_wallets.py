#!/usr/bin/env python3
"""
fund_wallets.py -- Generate Lightning invoices to fund the agent wallets
                   from your Wallet of Satoshi (or any Lightning wallet).

Usage:
    python fund_wallets.py            # interactive: walks you through it
    python fund_wallets.py pm 1000    # one-shot: 1000 sats invoice for the PM wallet
    python fund_wallets.py platform 200

Wallets you can fund:
    platform   -> port 3456  (escrow, needs >= 50 sats)
    pm         -> port 3457  (project manager, needs >= 300 sats for one demo run)
    researcher -> port 3458  (earns, doesn't need funding)
    copywriter -> port 3459  (earns, doesn't need funding)
    strategist -> port 3460  (earns, doesn't need funding)

Before running this: make sure the stack is up with `python start.py`
"""

import json
import sys
import urllib.request
import urllib.error

WALLETS = {
    "platform":   {"port": 3456, "min": 300,  "note": "Escrow"},
    "pm":         {"port": 3457, "min": 300, "note": "PM agent — funds the demo run"},
    "researcher": {"port": 3458, "min": 60,   "note": "Earns only"},
    "copywriter": {"port": 3459, "min": 60,   "note": "Earns only"},
    "strategist": {"port": 3460, "min": 60,   "note": "Earns only"},
}

def request_invoice(port: int, sats: int, description: str = "top-up") -> str:
    body = json.dumps({"amount_sats": sats, "description": description}).encode()
    req = urllib.request.Request(
        f"http://localhost:{port}/receive",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.URLError as e:
        raise SystemExit(
            f"\nCouldn't reach the wallet daemon on port {port}.\n"
            f"Is the stack running? Try:  python start.py\n"
            f"Underlying error: {e}\n"
        )
    # MDK responses vary slightly by version — pull the invoice out of common keys
    for key in ("invoice", "bolt11", "payment_request", "pr"):
        if key in data and data[key]:
            return data[key]
    raise SystemExit(f"Unexpected response from wallet: {data}")

def get_balance(port: int) -> str:
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/balance", timeout=5) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return "(daemon not reachable)"

def show(name: str, sats: int):
    info = WALLETS[name]
    print(f"\n=== {name.upper()} wallet — {sats} sats ===")
    print(f"Port: {info['port']}    {info['note']}")
    invoice = request_invoice(info["port"], sats, f"{name} top-up")
    print("\nPaste this into Wallet of Satoshi (Send -> paste invoice):\n")
    print(invoice)
    print()

def interactive():
    print("\nFund agent wallets from your Wallet of Satoshi.")
    print("Recommended for a demo run:  pm = 1000 sats, platform = 200 sats.\n")
    plans = []
    for name in ("pm", "platform"):
        default = 1000 if name == "pm" else 200
        raw = input(f"How many sats for the {name} wallet? [{default}, blank to skip]: ").strip()
        if raw == "":
            continue
        try:
            sats = int(raw)
        except ValueError:
            print("  not a number, skipping.")
            continue
        if sats < WALLETS[name]["min"]:
            print(f"  warning: min recommended is {WALLETS[name]['min']} — using anyway.")
        plans.append((name, sats))

    if not plans:
        print("Nothing to do.")
        return

    for name, sats in plans:
        show(name, sats)

    print("=" * 60)
    print("Open Wallet of Satoshi on your phone. For each invoice above:")
    print("  1. Tap Send")
    print("  2. Paste the invoice (or scan if you put it in a QR generator)")
    print("  3. Confirm")
    print("\nAfter paying, check balances with:")
    for name, _ in plans:
        print(f"  curl http://localhost:{WALLETS[name]['port']}/balance")
    print()

def main():
    if len(sys.argv) == 1:
        interactive()
        return
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    name, sats_raw = sys.argv[1].lower(), sys.argv[2]
    if name not in WALLETS:
        print(f"Unknown wallet '{name}'. Choose from: {', '.join(WALLETS)}")
        sys.exit(1)
    try:
        sats = int(sats_raw)
    except ValueError:
        print(f"'{sats_raw}' is not a number")
        sys.exit(1)
    show(name, sats)

if __name__ == "__main__":
    main()
