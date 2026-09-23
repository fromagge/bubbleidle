#!/usr/bin/env bash
# bubbleidle installer — deps, config, and agent wiring (skill, subagents, MCP server).
#   ./install.sh            interactive
#   ./install.sh --yes      accept defaults, no prompts
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YES=${1:-}
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$*"; }
ask() { # ask <prompt> ; returns 0 for yes
  [ "$YES" = "--yes" ] && return 0
  read -r -p "  $1 [Y/n] " a </dev/tty || return 1
  [[ -z "$a" || "$a" =~ ^[Yy] ]]
}

say "1. Requirements"
command -v node >/dev/null || { echo "node not found — install Node 22+ (it runs the TypeScript directly)"; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || { echo "Node $NODE_MAJOR found; this needs Node 22+"; exit 1; }
ok "node $(node -v)"
command -v git >/dev/null && ok "git $(git --version | awk '{print $3}')" || { echo "git is required"; exit 1; }
BROWSER=""
for p in "${CHROMIUM_PATH:-}" /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome-stable \
         /usr/bin/google-chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  [ -n "$p" ] && [ -x "$p" ] && BROWSER="$p" && break
done
if [ -n "$BROWSER" ]; then ok "browser $BROWSER"; else
  warn "no Chrome/Chromium found — a browser is needed for login and screenshots"
  ask "install one via playwright now?" && npx --yes playwright install chromium || warn "set CHROMIUM_PATH later"
fi

say "2. Dependencies"
(cd "$REPO" && npm install --no-audit --no-fund >/dev/null) && ok "npm packages installed"

say "3. Config"
CFG="${XDG_CONFIG_HOME:-$HOME/.config}/bubbleidle"
if [ -f "$CFG/.env" ]; then ok "config exists at $CFG/.env"
elif [ -f "$REPO/.env" ]; then ok "config exists at $REPO/.env"
else
  mkdir -p "$CFG"; chmod 700 "$CFG"
  cp "$REPO/.env.example" "$CFG/.env"; chmod 600 "$CFG/.env"
  ok "created $CFG/.env from the template"
  warn "edit it: bot account email + password, then BUBBLE_APP_ID (run 'bubble apps' to list them)"
  warn "use a SEPARATE Bubble account (email+password, not Google SSO) invited as a collaborator"
fi

say "4. Agent wiring"
if ask "make 'bubble' available on your PATH (~/.local/bin)?"; then
  mkdir -p "$HOME/.local/bin"
  printf '#!/usr/bin/env bash\nexec node "%s/bin/bubble.ts" "$@"\n' "$REPO" > "$HOME/.local/bin/bubble"
  chmod +x "$HOME/.local/bin/bubble"
  ok "installed $HOME/.local/bin/bubble"
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) warn "add ~/.local/bin to your PATH";; esac
fi

if command -v claude >/dev/null; then
  if ask "register the MCP server with Claude Code?"; then
    claude mcp add bubble -- node "$REPO/src/mcp.ts" >/dev/null 2>&1 && ok "MCP server 'bubble' registered" \
      || warn "could not register automatically — run: claude mcp add bubble -- node $REPO/src/mcp.ts"
  fi
  if ask "install the Bubble skill + subagents into ~/.claude (so any project can use them)?"; then
    mkdir -p "$HOME/.claude/skills" "$HOME/.claude/agents"
    ln -sfn "$REPO/skills/bubble" "$HOME/.claude/skills/bubble" && ok "skill → ~/.claude/skills/bubble"
    for a in "$REPO"/.claude/agents/*.md; do ln -sfn "$a" "$HOME/.claude/agents/$(basename "$a")"; done
    ok "subagents → ~/.claude/agents/"
  fi
else
  warn "claude CLI not found — for other agents see mcp.example.json, or just call bin/bubble.ts"
fi

say "Done. Next:"
cat <<EOF
  1. edit ${CFG}/.env      (bot account credentials)
  2. node bin/bubble.ts login
  3. node bin/bubble.ts apps      → copy an app id into BUBBLE_APP_ID
  4. node bin/bubble.ts doctor    → should report can_edit
  5. node bin/bubble.ts snapshot  → the app is now in git

  Agents: point them at AGENTS.md (Claude Code reads CLAUDE.md automatically).
EOF
