# Test server (D33) - Oracle Cloud Always Free + Cloudflare Tunnel

A free server that runs the same Hub in **test mode** (seed data only, never real pharmacy data), reached through a Cloudflare quick tunnel (no open port). Every merge to `main` deploys to it (`deploy-test.yml`). The deploy key can only hand a new build to `receive.sh`.

## One-time setup (owner, from the phone, about 15 minutes)
1. **Create the server** (Oracle console): Compute -> Instances -> Create instance.
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **Ampere (VM.Standard.A1.Flex) 1 OCPU, 6 GB** (inside the Always Free limit). If Ampere says "out of capacity", choose **VM.Standard.E2.1.Micro** (also free).
   - SSH keys: "Paste public key" with the public key of a Termius key (Termius -> Keychain -> Generate key -> copy public key).
   - Create. Note the **public IP**.
2. **Termius**: new host = the public IP, user `ubuntu`, the same key. Connect.
3. Run these two commands:
   - `curl -fsSL -o setup.sh https://raw.githubusercontent.com/ahmed84997/O-pharmacy-/main/deploy/test-server/setup.sh` (if the repository is private this fails: then paste the file content from GitHub into `nano setup.sh`)
   - `bash setup.sh`
   It asks once for the **test staff password** (not shown, never paste it in the chat). At the end it prints a private key between two lines and a `TEST_TARGET` value.
4. **GitHub** -> repository O-pharmacy- -> Settings -> Secrets and variables -> Actions: add `TEST_SSH_KEY` (the private key, all lines) and `TEST_TARGET` (the printed value). Then in Termius: `rm ~/o-pharmacy/deploy_key`.
5. **GitHub** -> Actions -> "Deploy to the test server" -> Run workflow.
6. The address: `journalctl --user -u o-pharmacy-tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1`. Open it, set up the owner, then "حمّل البيانات التجريبية" on the home page.

## Notes
- The quick-tunnel address changes when the tunnel restarts; a fixed address needs a domain on Cloudflare (never the YK domain). Until then, read it again with the command in step 6.
- Oracle may reclaim an Always Free server that stays idle for a long time; the merges keep it busy. If it disappears, repeat the setup: nothing real is stored there.
- To stop publishing: delete the line ending in `o-pharmacy-deploy` from `~/.ssh/authorized_keys`.
