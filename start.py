#!/usr/bin/env python3
"""
start.py -- Launch the full EnrichedUranium stack from one terminal.

Services:
  [api]        Backend API      http://localhost:3001
  [researcher] Market Research  http://localhost:4001
  [copywriter] Copywriter       http://localhost:4002
  [strategist] Social Strategy  http://localhost:4003
  [pm]         Project Manager  http://localhost:4000  (Lightning stalled)
  [frontend]   Vite dev UI      http://localhost:5173

Usage:
  python start.py              # start everything
  python start.py --no-agents  # skip agent servers (API + frontend only)
  python start.py --skip-reg   # skip agent registration step

Env: reads .env from the project root automatically.
     DEEPSEEK_API_KEY (or DEEPSEEK_API) is required for agents.
"""

import os
import sys
import signal
import socket
import shutil
import subprocess
import threading
import time
import argparse

# -- Paths --------------------------------------------------------------------
ROOT         = os.path.dirname(os.path.abspath(__file__))
API_DIR      = os.path.join(ROOT, 'api')
AGENTS_DIR   = os.path.join(ROOT, 'agents')
FRONTEND_DIR = os.path.join(ROOT, 'frontend')

# -- Terminal colours (ANSI) --------------------------------------------------
C = {
    'api':        '\033[96m',
    'researcher': '\033[92m',
    'copywriter': '\033[93m',
    'strategist': '\033[95m',
    'pm':         '\033[94m',
    'frontend':   '\033[97m',
    'launcher':   '\033[1;33m',
    'ok':         '\033[1;32m',
    'warn':       '\033[1;31m',
    'reset':      '\033[0m',
}

# Windows: enable ANSI escape codes in cmd / PowerShell
if sys.platform == 'win32':
    import ctypes
    try:
        ctypes.windll.kernel32.SetConsoleMode(
            ctypes.windll.kernel32.GetStdHandle(-11), 7)
    except Exception:
        pass

# -- Resolve executables ------------------------------------------------------
# On Windows npm/node are .cmd files; shutil.which returns the full path with
# the extension, which is required when NOT using shell=True in subprocess.
_NODE = shutil.which('node') or 'node'
_NPM  = shutil.which('npm')  or 'npm'

processes = []
_shutdown_called = False


# -- Logging ------------------------------------------------------------------

def log(label, msg, colour_key=None):
    colour = C.get(colour_key or label, C['reset'])
    reset  = C['reset']
    print('{colour}[{label:<10}]{reset} {msg}'.format(
        colour=colour, label=label, reset=reset, msg=msg), flush=True)

def launcher(msg, ok=False):
    colour = C['ok'] if ok else C['launcher']
    print('{c}[launcher  ]{r} {m}'.format(c=colour, r=C['reset'], m=msg), flush=True)

def warn(msg):
    print('{c}[launcher  ]{r} WARNING: {m}'.format(
        c=C['warn'], r=C['reset'], m=msg), flush=True)


# -- Helpers ------------------------------------------------------------------

def load_env(path):
    """Parse a .env file and inject missing keys into os.environ."""
    if not os.path.exists(path):
        return
    with open(path) as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, val = line.partition('=')
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


def wait_for_port(port, timeout=20, label=''):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                return True
        except OSError:
            time.sleep(0.4)
    warn('{} did not open within {}s'.format(label or 'port {}'.format(port), timeout))
    return False


def npm_install(directory, label):
    nm = os.path.join(directory, 'node_modules')
    if os.path.isdir(nm):
        return
    log(label, 'node_modules missing -- running npm install...', 'launcher')
    result = subprocess.run(
        [_NPM, 'install', '--no-audit', '--no-fund'],
        cwd=directory, capture_output=True, text=True,
    )
    if result.returncode != 0:
        warn('npm install in {} failed:\n{}'.format(label, result.stderr))
        sys.exit(1)
    log(label, 'npm install done.', 'ok')


def stream(proc, label):
    """Forward process stdout+stderr to console with a coloured prefix."""
    try:
        for line in proc.stdout:
            log(label, line.rstrip())
    except ValueError:
        pass  # pipe closed on shutdown


def start_process(label, cmd, cwd, extra_env=None):
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    proc = subprocess.Popen(
        cmd, cwd=cwd, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )
    processes.append((label, proc))
    threading.Thread(target=stream, args=(proc, label), daemon=True).start()
    return proc


def register_agents():
    """Run agents/register.js -- idempotent, 409s are ignored."""
    launcher('Registering agents & schemas with the platform...')
    result = subprocess.run(
        [_NODE, 'register.js'],
        cwd=AGENTS_DIR, env=dict(os.environ),
        capture_output=True, text=True, timeout=40,
    )
    for line in result.stdout.splitlines():
        launcher(line)
    if result.returncode != 0:
        warn('register.js exited {}'.format(result.returncode))
        for line in result.stderr.splitlines():
            warn(line)
    else:
        launcher('Registration complete.', ok=True)


# -- Shutdown -----------------------------------------------------------------

def shutdown(signum=None, frame=None):
    global _shutdown_called
    if _shutdown_called:
        return
    _shutdown_called = True
    print()
    launcher('Ctrl+C -- stopping all services...')
    for _label, p in processes:
        try:
            p.terminate()
        except Exception:
            pass
    deadline = time.time() + 6
    for _label, p in processes:
        remaining = max(0.1, deadline - time.time())
        try:
            p.wait(timeout=remaining)
        except Exception:
            try:
                p.kill()
            except Exception:
                pass
    launcher('All services stopped.', ok=True)
    sys.exit(0)


# -- Entry point --------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='EnrichedUranium stack launcher')
    parser.add_argument('--no-agents', action='store_true',
                        help='Skip agent servers (API + frontend only)')
    parser.add_argument('--skip-reg', action='store_true',
                        help='Skip agent registration step')
    args = parser.parse_args()

    signal.signal(signal.SIGINT,  shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Load .env from project root
    load_env(os.path.join(ROOT, '.env'))

    # Allow DEEPSEEK_API as an alias for DEEPSEEK_API_KEY
    if 'DEEPSEEK_API' in os.environ and 'DEEPSEEK_API_KEY' not in os.environ:
        os.environ['DEEPSEEK_API_KEY'] = os.environ['DEEPSEEK_API']

    # Preflight checks
    if not shutil.which('node'):
        warn('node not found in PATH. Install Node.js 18+ first.')
        sys.exit(1)
    if not shutil.which('npm'):
        warn('npm not found in PATH.')
        sys.exit(1)

    # Banner
    print()
    launcher('╔══════════════════════════════════════════╗')
    launcher('║       EnrichedUranium  --  Launcher      ║')
    launcher('╚══════════════════════════════════════════╝')
    print()

    # ------------------------------------------------------------------
    # 1. Backend API
    # ------------------------------------------------------------------
    npm_install(API_DIR, 'api')
    launcher('Starting backend API on http://localhost:3001 ...')
    start_process('api', [_NODE, 'server.js'], API_DIR)

    if not wait_for_port(3001, timeout=20, label='backend API'):
        warn('Backend did not start. Check [api] logs above.')
        shutdown()
    launcher('Backend ready  ->  http://localhost:3001', ok=True)

    # ------------------------------------------------------------------
    # 2. Agent registration + agent servers
    # ------------------------------------------------------------------
    if not args.no_agents:
        npm_install(AGENTS_DIR, 'agents')

        if not args.skip_reg:
            register_agents()
        else:
            launcher('Skipping registration (--skip-reg)')

        launcher('Starting specialist agents...')
        start_process('researcher', [_NODE, 'index.js'],
                      os.path.join(AGENTS_DIR, 'market-researcher'))
        start_process('copywriter', [_NODE, 'index.js'],
                      os.path.join(AGENTS_DIR, 'copywriter'))
        start_process('strategist', [_NODE, 'index.js'],
                      os.path.join(AGENTS_DIR, 'social-strategist'))

        # PM starts fine -- POST /campaign orchestration needs Lightning (stalled)
        launcher('Starting PM agent on http://localhost:4000 (Lightning stalled)...')
        start_process('pm', [_NODE, 'index.js'], os.path.join(AGENTS_DIR, 'pm'))

        time.sleep(1.5)
        for port, label in [(4001, 'researcher'), (4002, 'copywriter'), (4003, 'strategist')]:
            if wait_for_port(port, timeout=10, label=label):
                launcher('{:<10} ready  ->  http://localhost:{}'.format(label, port), ok=True)
    else:
        launcher('Skipping agents (--no-agents)')

    # ------------------------------------------------------------------
    # 3. Frontend dev server
    # ------------------------------------------------------------------
    launcher('Starting frontend dev server...')
    npm_install(FRONTEND_DIR, 'frontend')
    start_process(
        'frontend',
        [_NPM, 'run', 'dev'],
        FRONTEND_DIR,
        extra_env={'VITE_API_URL': 'http://localhost:3001'},
    )

    # Summary
    print()
    launcher('=' * 44)
    launcher('  All services launched!')
    launcher('  Frontend  ->  http://localhost:5173')
    launcher('  API       ->  http://localhost:3001')
    if not args.no_agents:
        launcher('  Agents    ->  ports 4000-4003')
        launcher('  NOTE: POST /campaign needs Lightning (stalled)')
    launcher('  Press Ctrl+C to stop everything.')
    launcher('=' * 44)
    print()

    # Keep main thread alive; warn if any process crashes unexpectedly
    while True:
        time.sleep(2)
        for label, proc in list(processes):
            code = proc.poll()
            if code is not None and code != 0:
                warn('[{}] process exited with code {}'.format(label, code))
                processes.remove((label, proc))


if __name__ == '__main__':
    main()
