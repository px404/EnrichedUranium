# AgentMarket — Start All Agent Wallets
# Run each block in a separate PowerShell terminal.
# Platform wallet (port 3456) should already be running.
#
# After all daemons are up, fund PM wallet:
#   npx @moneydevkit/agent-wallet@latest receive 500
#   (pay that invoice from your Lexe wallet)

# ─── TERMINAL 2 — PM Agent Wallet (port 3457) ───────────────────────────────
$env:MDK_WALLET_MNEMONIC = "oak warfare front chapter pumpkin raccoon toddler detail steak degree spray doll"
$env:MDK_WALLET_PORT = "3457"
$env:HOME = "$env:USERPROFILE\.mdk-pm"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.mdk-pm\.mdk-wallet" | Out-Null
npx @moneydevkit/agent-wallet@latest start

# ─── TERMINAL 3 — Market Researcher Wallet (port 3458) ──────────────────────
$env:MDK_WALLET_MNEMONIC = "nothing famous small body radio banana peasant urban lawn cloud chef often"
$env:MDK_WALLET_PORT = "3458"
$env:HOME = "$env:USERPROFILE\.mdk-researcher"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.mdk-researcher\.mdk-wallet" | Out-Null
npx @moneydevkit/agent-wallet@latest start

# ─── TERMINAL 4 — Copywriter Wallet (port 3459) ─────────────────────────────
$env:MDK_WALLET_MNEMONIC = "skate crush strike vacant student sponsor merry icon dawn reunion review make"
$env:MDK_WALLET_PORT = "3459"
$env:HOME = "$env:USERPROFILE\.mdk-copywriter"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.mdk-copywriter\.mdk-wallet" | Out-Null
npx @moneydevkit/agent-wallet@latest start

# ─── TERMINAL 5 — Social Strategist Wallet (port 3460) ──────────────────────
$env:MDK_WALLET_MNEMONIC = "jealous coconut uncover south miss pistol insect barely wedding else wall claim"
$env:MDK_WALLET_PORT = "3460"
$env:HOME = "$env:USERPROFILE\.mdk-strategist"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.mdk-strategist\.mdk-wallet" | Out-Null
npx @moneydevkit/agent-wallet@latest start

# ─── VERIFY all wallets (run in any terminal after all daemons are up) ───────
# curl http://localhost:3456/balance   # platform
# curl http://localhost:3457/balance   # pm
# curl http://localhost:3458/balance   # researcher
# curl http://localhost:3459/balance   # copywriter
# curl http://localhost:3460/balance   # strategist
