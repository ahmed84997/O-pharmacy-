#!/usr/bin/env bash
# O Pharmacy test server (D33): Oracle Cloud Always Free, Ubuntu 24.04 (ARM or x86). Run ONCE as the default user:
#   bash setup.sh
# It installs Node and cloudflared in ~/o-pharmacy, creates two user services (the Hub in test mode, and a Cloudflare quick tunnel),
# and a deploy key that can only hand a new build to receive.sh. No inbound port is opened: the tunnel goes out.
set -euo pipefail
B="$HOME/o-pharmacy"; NODE_VER="v22.14.0"
case "$(uname -m)" in aarch64|arm64) NA=arm64; CA=arm64 ;; x86_64) NA=x64; CA=amd64 ;; *) echo "unsupported CPU $(uname -m)"; exit 1 ;; esac
mkdir -p "$B/releases" "$B/data" "$B/bin" "$HOME/.config/systemd/user" "$HOME/.ssh"

echo "1/5 Node $NODE_VER"
if [ ! -x "$B/node/bin/node" ]; then curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-$NA.tar.xz" | tar -xJ -C "$B" && mv "$B/node-$NODE_VER-linux-$NA" "$B/node"; fi
"$B/node/bin/node" -v

echo "2/5 cloudflared"
if [ ! -x "$B/bin/cloudflared" ]; then curl -fsSL -o "$B/bin/cloudflared" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CA" && chmod +x "$B/bin/cloudflared"; fi
"$B/bin/cloudflared" --version

echo "3/5 password for the test staff accounts (manager, pharmacist, cashier, storekeeper, accountant)"
if [ ! -f "$B/staff.env" ]; then read -r -s -p "type it (6+ characters, not shown): " S; echo; [ ${#S} -ge 6 ] || { echo "too short"; exit 1; }; umask 077; printf 'O_TEST_STAFF_SECRET=%s\n' "$S" > "$B/staff.env"; unset S; fi

echo "4/5 services"
cat > "$B/receive.sh" <<'R'
#!/usr/bin/env bash
# Called only through the deploy key: unpacks a build, switches to it, restarts the Hub. Keeps the last 5 builds.
set -euo pipefail
B="$HOME/o-pharmacy"; export XDG_RUNTIME_DIR="/run/user/$(id -u)"
R="$B/releases/$(date -u +%Y%m%d%H%M%S)"; mkdir -p "$R"; tar -xzf - -C "$R"; test -f "$R/hub.mjs"
ln -sfn "$R" "$B/current"; systemctl --user restart o-pharmacy-hub
ls -1dt "$B"/releases/* | tail -n +6 | xargs -r rm -rf
echo "deployed $(basename "$R")"
R
chmod +x "$B/receive.sh"
cat > "$HOME/.config/systemd/user/o-pharmacy-hub.service" <<U
[Unit]
Description=O Pharmacy Hub (test mode)
After=network-online.target
[Service]
WorkingDirectory=$B
Environment=O_DATA_DIR=$B/data O_WEB_DIR=$B/current/web O_TEST_MODE=1 O_HOST=127.0.0.1 O_PORT=4870
EnvironmentFile=$B/staff.env
ExecStart=$B/node/bin/node $B/current/hub.mjs
Restart=always
RestartSec=3
[Install]
WantedBy=default.target
U
cat > "$HOME/.config/systemd/user/o-pharmacy-tunnel.service" <<U
[Unit]
Description=O Pharmacy test address (Cloudflare quick tunnel)
After=network-online.target
[Service]
ExecStart=$B/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4870
Restart=always
RestartSec=5
[Install]
WantedBy=default.target
U
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable o-pharmacy-hub o-pharmacy-tunnel
systemctl --user start o-pharmacy-tunnel

echo "5/5 deploy key (GitHub Actions can only run receive.sh with it)"
if ! grep -q 'o-pharmacy-deploy' "$HOME/.ssh/authorized_keys" 2>/dev/null; then
  ssh-keygen -t ed25519 -N "" -f "$B/deploy_key" -C o-pharmacy-deploy >/dev/null
  printf 'command="%s/receive.sh",restrict %s\n' "$B" "$(cat "$B/deploy_key.pub")" >> "$HOME/.ssh/authorized_keys"
  echo; echo "=== copy everything between the lines into the GitHub secret TEST_SSH_KEY, then run: rm $B/deploy_key ==="
  cat "$B/deploy_key"; echo "=== end ==="
fi
echo; echo "TEST_TARGET secret value: $USER@$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
echo "The test address appears in about 20 seconds with:  journalctl --user -u o-pharmacy-tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1"
