# Demo hosting on Hostinger (auto-upload on merge)

Merging a change under `demo/` to `main` builds the demo and uploads it to a test subdomain (workflow `deploy-demo.yml`). It is static files only: no database, no Laravel, nothing shared with YK. Never put it inside a YK folder.

## One-time setup (owner, about 5 minutes)
1. hPanel: create a subdomain, for example `demo`. Note its folder name: `ls ~/domains` in Termius (the one that is not a YK folder). Call it NAME below.
2. Termius (host «YO pharmacy», port 65002), run these four commands, replacing NAME:
   - `ssh-keygen -t ed25519 -N "" -f ~/.ssh/demo_deploy -C demo-deploy`
   - `printf 'command="tar -xzf - -C $HOME/domains/NAME/public_html",restrict %s\n' "$(cat ~/.ssh/demo_deploy.pub)" >> ~/.ssh/authorized_keys`
   - `cat ~/.ssh/demo_deploy` and copy the whole output (private key) to the clipboard
   - after saving it in GitHub (step 3): `rm ~/.ssh/demo_deploy ~/.ssh/demo_deploy.pub`
3. GitHub, repository O-pharmacy-, Settings, Secrets and variables, Actions, add two secrets: `DEMO_SSH_KEY` (the private key you copied) and `DEMO_TARGET` (user@address of the server, the same value used for YK's `DEPLOY_TARGET`). Never paste either into the chat.
4. Actions tab, «Deploy demo to Hostinger», Run workflow. Open the subdomain.

## Safety
- The key can only extract an archive into the demo folder (forced command + `restrict`): no shell, no other folders, no YK access.
- Until both secrets exist the upload step is skipped with a notice, so CI stays green.
- The page has no real data. It is excluded from search engines (robots.txt, X-Robots-Tag). For a password, use hPanel «Password Protect Directory» on the folder.
- To stop publishing: delete the line ending with `demo-deploy` from `~/.ssh/authorized_keys`.
