# AgentMarket — Start All Agent Wallets
# Run each block in a SEPARATE PowerShell terminal (one per wallet).
# Or just run:  python start.py   — it starts all daemons automatically.
#
# Fund the PM wallet after all daemons are up:
#   curl http://localhost:3457/receive -d '{"amount_sats":1000,"description":"top-up"}' -H 'Content-Type: application/json'
#   (pay the returned invoice from your Lexe/Phoenix wallet)
#
# Min sats needed:  PM >= 300 (covers one full campaign: 80+100+80)
#                   Platform >= 50 (for escrow invoices)
#                   Researcher/Copywriter/Strategist = 0 (they earn, not spend)

# ─── TERMINAL 1 — Platform Wallet (port 3456) ────────────────────────────────
$env:MDK_WALLET_MNEMONIC = "pride craft vault ocean drift solar ember lunar flash delta echo foil"
$env:MDK_WALLET_PORT = "3456"
$env:HOME = "$env:USERPROFILE\.mdk-platform"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.mdk-platform\.mdk-wallet" | Out-Null
npx @moneydevkit/agent-wallet@latest start

# ─── TERMINAL 2 — PM Agent Wallet (port 3457) ────────────────────────────────
$env:MDK_WALLET_MNEMONIC = "oak warfare front chapter pumpkin raccoon toddler detail steak degree spray doll"
$env:MDK_WALLET_PORT = "3457"
$env:HOME = "$env:USERPROFILE\.mdk-pm"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.mdk-pm\.mdk-wallet" | Out-Null
npx @moneydevkit/agent-wallet@latest start

# ─── TERMINAL 3 — Market Researcher Wallet (port 3458) ───────────────────────
$env:MDK_WALLET_MNEMONIC = "nothing famous small body radio banana peasant urban lawn cloud chef often"
$env:MDK_WALLET_PORT = "3458"
$env:HOME = "$env:USERPROFILE\.mdk-researcher"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.mdk-researcher\.mdk-wallet" | Out-Null
npx @moneydevkit/agent-wallet@latest start

# ─── TERMINAL 4 — Copywriter Wallet (port 3459) ──────────────────────────────
$env:MDK_WALLET_MNEMONIC = "skate crush strike vacant student sponsor merry icon dawn reunion review make"
$env:MDK_WALLET_PORT = "3459"
$env:HOME = "$env:USERPROFILE\.mdk-copywriter"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.mdk-copywriter\.mdk-wallet" | Out-Null
npx @moneydevkit/agent-wallet@latest start

# ─── TERMINAL 5 — Social Strategist Wallet (port 3460) ───────────────────────
$env:MDK_WALLET_MNEMONIC = "jealous coconut uncover south miss pistol insect barely wedding else wall claim"
$env:MDK_WALLET_PORT = "3460"
$env:HOME = "$env:USERPROFILE\.mdk-strategist"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.mdk-strategist\.mdk-wallet" | Out-Null
npx @moneydevkit/agent-wallet@latest start

# ─── TERMINAL 6 — User Wallet (port 3461) ────────────────────────────────────
# Represents the human end-user.  Used by the dev "Auto-pay" button so the
# user can settle parent invoices from inside the app — without an external
# Lightning wallet, and without making the PM pay for the user's own request.
$env:MDK_WALLET_MNEMONIC = "hair cross small purpose rally accident lend smooth keep shoe shadow round"
$env:MDK_WALLET_PORT = "3461"
$env:HOME = "$env:USERPROFILE\.mdk-user"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.mdk-user\.mdk-wallet" | Out-Null
npx @moneydevkit/agent-wallet@latest start

# ─── VERIFY all wallets (run in any terminal after all daemons are up) ────────
# curl http://localhost:3456/balance   # platform (escrow)
# curl http://localhost:3457/balance   # pm       (agent — earns from parent jobs)
# curl http://localhost:3458/balance   # researcher
# curl http://localhost:3459/balance   # copywriter
# curl http://localhost:3460/balance   # strategist
# curl http://localhost:3461/balance   # user     (the end-user — pays parent invoices)
