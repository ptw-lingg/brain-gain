# BrainGain — Installation Manual (Ubuntu Server on Azure)

Audience: system administrators deploying BrainGain on a **Ubuntu Server 24.04 LTS or 26.04 LTS**
virtual machine in **Microsoft Azure**. It covers the Azure resources, the operating-system
preparation, the application install, the service definition, the post-install configuration
(TLS certificate, Entra ID SSO, SMTP), backups, upgrades and troubleshooting.

Everything in this manual was validated against the application source in this repository. Commands
are given for `bash` on the VM and `az` (Azure CLI) on your workstation; the portal equivalents are
noted where they differ.

---

## 1. What you are deploying

BrainGain is a **single Node.js process**. It terminates TLS itself, serves both the REST API and the
compiled single-page application from the same HTTPS origin, and persists everything to **plain JSON
files on disk**. There is no database server, no cache, no message broker and no external runtime
dependency.

| Component | Detail |
|---|---|
| Runtime | Node.js (LTS), one process |
| Listeners | HTTPS (application) + HTTP (308 redirect to HTTPS only) |
| Delivery | API under `/api/*`, SPA for every other path, same origin |
| Storage | JSON files, uploaded material files and backup archives under one data directory |
| TLS | Terminated in-process; certificate managed from the admin UI, hot-swapped without restart |
| Identity | Local email/password (bcrypt) and, optionally, Microsoft Entra ID SSO |
| Outbound | SMTP (reminder mail) and, with SSO enabled, `login.microsoftonline.com` for token signing keys |

Because the application owns its own certificate and enforces HSTS, the intended topology is to
expose the VM **directly** on 443. A reverse proxy is not required and is not part of the supported
path; if organisational policy mandates one, run it in TLS pass-through mode so the in-app
certificate management continues to work.

---

## 2. Prerequisites

Before starting, have the following ready.

**Azure**
- A subscription and permission to create a resource group, virtual network, network security group,
  public IP address and virtual machine.
- Azure CLI installed and signed in (`az login`), or portal access.

**Networking and DNS**
- A DNS name that will point at the VM's public IP (for example `braingain.example.com`). Users reach
  the application by this name, the TLS certificate must match it, and — with SSO — it is registered
  as the Entra redirect URI.

**Optional, depending on which features you enable**
- *Entra ID SSO*: permission to create an app registration in your tenant (Application Administrator
  or higher), and the tenant ID.
- *Email reminders*: an SMTP relay reachable from the VM — host, port, credentials and a From
  address. Note that Azure blocks outbound port 25 on most subscriptions; use a submission port
  (587 with STARTTLS, or 465 implicit TLS) on a relay that accepts it.

**Recommended VM sizing**

| Users | Size | vCPU / RAM | OS disk |
|---|---|---|---|
| up to ~200 | `Standard_B2s` | 2 / 4 GB | 32 GB Premium SSD |
| up to ~1000 | `Standard_B2ms` or `Standard_D2s_v5` | 2 / 8 GB | 64 GB Premium SSD |

Uploads are buffered in memory before being written to disk (learning material up to 100 MB per
file, backup archives up to 200 MB), so **do not size below 4 GB of RAM**. Disk demand is driven
almost entirely by uploaded material and retained backup archives, not by the JSON stores.

---

## 3. Create the Azure infrastructure

Set your variables once; the rest of this section pastes cleanly.

```bash
RG=rg-braingain-prod
LOC=westeurope
VM=vm-braingain-01
DNSLABEL=braingain-prod          # becomes braingain-prod.westeurope.cloudapp.azure.com
ADMINUSER=azureadmin
IMAGE=Canonical:ubuntu-24_04-lts:server:latest   # 26.04: Canonical:ubuntu-26_04-lts:server:latest
```

Confirm the exact image URN for your region before creating the VM:

```bash
az vm image list --publisher Canonical --all --output table | grep -i "24_04\|26_04"
```

### 3.1 Resource group, VM and static public IP

```bash
az group create --name "$RG" --location "$LOC"

az vm create \
  --resource-group "$RG" \
  --name "$VM" \
  --image "$IMAGE" \
  --size Standard_B2ms \
  --admin-username "$ADMINUSER" \
  --generate-ssh-keys \
  --public-ip-sku Standard \
  --public-ip-address-dns-name "$DNSLABEL" \
  --os-disk-size-gb 64 \
  --storage-sku Premium_LRS \
  --nsg-rule SSH
```

A `Standard` SKU public IP is static by default, which matters: the DNS record and the TLS
certificate are both bound to that address.

### 3.2 Network security group rules

Open only what the application needs. Restrict SSH to your administrative network — never leave 22
open to the internet.

```bash
NSG=$(az network nsg list -g "$RG" --query "[0].name" -o tsv)

# HTTPS — the application
az network nsg rule create -g "$RG" --nsg-name "$NSG" --name Allow-HTTPS \
  --priority 200 --access Allow --protocol Tcp --direction Inbound \
  --source-address-prefixes Internet --destination-port-ranges 443

# HTTP — only ever answers with a 308 redirect to HTTPS
az network nsg rule create -g "$RG" --nsg-name "$NSG" --name Allow-HTTP \
  --priority 210 --access Allow --protocol Tcp --direction Inbound \
  --source-address-prefixes Internet --destination-port-ranges 80

# SSH — tighten to your admin range
az network nsg rule update -g "$RG" --nsg-name "$NSG" --name default-allow-ssh \
  --source-address-prefixes 203.0.113.0/24
```

Port 80 is needed only for the redirect and for HTTP-01 certificate validation (§8.2). If you will
upload certificates manually and accept that users typing `http://` get a connection error, you may
leave 80 closed.

### 3.3 DNS

Point your organisational DNS name at the VM's public IP with an A record:

```bash
az network public-ip show -g "$RG" -n "${VM}PublicIP" --query ipAddress -o tsv
```

Create `braingain.example.com  A  <that address>`. Verify resolution from a client before requesting
a certificate. If you use the Azure-provided
`<label>.<region>.cloudapp.azure.com` name instead, no record is needed.

---

## 4. Prepare the operating system

SSH in as the admin user and apply the baseline.

```bash
ssh azureadmin@braingain.example.com

sudo apt-get update && sudo apt-get -y upgrade
sudo timedatectl set-timezone Europe/Berlin        # adjust; affects log timestamps and backup names
```

Correct time is not cosmetic: Entra ID token validation allows only five minutes of clock skew.
Azure VMs sync time by default — confirm with `timedatectl` that `System clock synchronized: yes`.

### 4.1 Unattended security updates

```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 4.2 Host firewall

The NSG is the primary control; `ufw` is defence in depth.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### 4.3 Install Node.js

Do not use the distribution's `nodejs` package — the version it carries varies by release and may be
past end-of-life. Install a pinned LTS from NodeSource, which works identically on 24.04 and 26.04:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v    # expect v22.x
npm -v
```

Node 20 LTS or newer is required. No compiler toolchain is needed — every dependency is pure
JavaScript, so `build-essential` and `node-gyp` are not involved.

### 4.4 Create the service account and directories

BrainGain runs as an unprivileged system user that owns the data but not the application code.

```bash
sudo useradd --system --home /var/lib/braingain --shell /usr/sbin/nologin braingain

sudo mkdir -p /opt/braingain          # application code (read-only to the service)
sudo mkdir -p /var/lib/braingain      # data directory (read-write to the service)
sudo mkdir -p /etc/braingain          # configuration secrets

sudo chown -R braingain:braingain /var/lib/braingain
sudo chmod 750 /var/lib/braingain
sudo chmod 750 /etc/braingain
```

---

## 5. Install the application

### 5.1 Get the source onto the VM

Either clone the repository or copy a release archive. **Keep the `backend/` and `frontend/`
directories as siblings** — the server resolves the compiled SPA relative to its own location, so
moving one without the other breaks the deployment.

```bash
sudo apt-get install -y git
sudo git clone <your-repository-url> /opt/braingain/app
cd /opt/braingain/app
sudo git checkout <release-tag>
```

Alternatively, from your workstation:

```bash
tar --exclude=node_modules --exclude=.git -czf braingain.tgz -C /path/to/brain-gain .
scp braingain.tgz azureadmin@braingain.example.com:/tmp/
ssh azureadmin@braingain.example.com \
  'sudo mkdir -p /opt/braingain/app && sudo tar -xzf /tmp/braingain.tgz -C /opt/braingain/app'
```

### 5.2 Install dependencies and build

Both installs use `npm ci`, which honours the committed lock files and gives a reproducible tree.

```bash
cd /opt/braingain/app

sudo npm --prefix backend ci
sudo npm --prefix backend run build       # TypeScript -> backend/dist

sudo npm --prefix frontend ci
sudo npm --prefix frontend run build      # type-check + Vite -> frontend/dist
```

The frontend build takes a few minutes and needs roughly 2 GB of free memory. It requires no
build-time configuration: the SPA calls the API at the relative path `/api`, so the same build works
for every hostname.

Once built, the backend's build-only dependencies can be dropped:

```bash
sudo npm --prefix backend prune --omit=dev
```

Finally, hand ownership of the code to root and leave the service user with read access only:

```bash
sudo chown -R root:root /opt/braingain/app
sudo chmod -R go-w /opt/braingain/app
```

---

## 6. Configure the service

### 6.1 Environment variables

The application is configured by exactly four environment variables. Everything else — pass
threshold, company name, SSO, SMTP, TLS, automatic backups — is configured by an administrator
inside the application after first start.

| Variable | Default | Production guidance |
|---|---|---|
| `DATA_DIR` | `<install>/backend/dist/data` | **Set it.** Point at `/var/lib/braingain` so data lives outside the code tree and survives upgrades. |
| `JWT_SECRET` | `braingain-secret` | **Set it.** The built-in default is public knowledge; anyone who knows it can forge a session token for any account, including an administrator. Use ≥32 random bytes. |
| `HTTPS_PORT` (or `PORT`) | `3011` | `443` for direct exposure. `HTTPS_PORT` wins if both are set. |
| `HTTP_PORT` | `3010` | `80`. This listener serves no content — it only issues a 308 redirect to the HTTPS port. |

`ENTRA_AUTHORITY_BASE` also exists, but it is a test hook that redirects Entra token validation to a
stub identity provider. **Never set it in production**; leaving it unset uses
`https://login.microsoftonline.com`.

Leaving `DATA_DIR` unset is the single most common deployment mistake. The default resolves *inside
the compiled output*, so the next `npm run build` — or any `rm -rf dist` — silently discards every
user, training record and certificate.

Generate the secret and write the environment file, readable only by root:

```bash
sudo tee /etc/braingain/braingain.env > /dev/null <<EOF
DATA_DIR=/var/lib/braingain
JWT_SECRET=$(openssl rand -base64 48)
HTTPS_PORT=443
HTTP_PORT=80
NODE_ENV=production
EOF

sudo chmod 600 /etc/braingain/braingain.env
sudo chown root:root /etc/braingain/braingain.env
```

Rotating `JWT_SECRET` later is safe but invalidates every active session — all users must sign in
again.

### 6.2 systemd unit

Ports 80 and 443 are privileged. Rather than running as root, the unit grants the single capability
required to bind them.

```bash
sudo tee /etc/systemd/system/braingain.service > /dev/null <<'EOF'
[Unit]
Description=BrainGain training management
Documentation=https://github.com/your-org/brain-gain
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=braingain
Group=braingain
WorkingDirectory=/opt/braingain/app/backend
EnvironmentFile=/etc/braingain/braingain.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

# Bind 80/443 without running as root
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6
RestrictNamespaces=true
LockPersonality=true
ReadWritePaths=/var/lib/braingain

StandardOutput=journal
StandardError=journal
SyslogIdentifier=braingain

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now braingain
```

`ProtectSystem=strict` makes the whole filesystem read-only except the paths named in
`ReadWritePaths` — which is why `DATA_DIR` must be `/var/lib/braingain` and nothing else. If you
choose a different data location, update both.

### 6.3 Verify the first start

```bash
sudo systemctl status braingain
sudo journalctl -u braingain -n 50 --no-pager
```

A healthy first start logs the seeded demo credentials, then both listeners:

```
🌱 Seeded demo data:
   admin@braingain.app / admin123
   ...
🔒 BrainGain served over HTTPS at https://localhost:443
↪  HTTP 80 redirects (308) to HTTPS
```

Smoke-test both listeners from the VM. `-k` is expected at this stage — the auto-generated bootstrap
certificate is self-signed and issued for `localhost`.

```bash
curl -sk https://localhost/api/health          # {"ok":true}
curl -sI http://localhost/ | head -1           # HTTP/1.1 308 Permanent Redirect
```

Then confirm the SPA is served from the same origin:

```bash
curl -sk https://localhost/ | head -3          # <!doctype html> ...
```

If this returns JSON or a 404 instead of HTML, `frontend/dist` is missing — re-run the frontend
build (§5.2). The server only mounts the SPA if that directory exists at start-up, so **restart the
service after building the frontend**.

---

## 7. Secure the first login

On an empty data directory the application seeds a demo dataset with **published default passwords**.
Close this hole before the VM is reachable by anyone else.

1. Browse to `https://braingain.example.com` and accept the browser warning (the bootstrap
   certificate is self-signed until §8 is complete).
2. Sign in as `admin@braingain.app` / `admin123`.
3. Create your real administrator account, sign out, and sign back in as that account.
4. Delete — or at minimum change the password of — all three seeded accounts:
   `admin@braingain.app`, `trainer@braingain.app`, `user@braingain.app`.
5. Delete the two demo trainings and the demo job role if you do not want them in your catalogue.

The seed runs **only when the user store is empty**, so it never reappears on later restarts.

---

## 8. Install a trusted TLS certificate

The bootstrap certificate is self-signed with the common name `localhost`, so every browser warns.
Replace it with a certificate that matches your DNS name.

### 8.1 What lives where

| Path | Content |
|---|---|
| `/var/lib/braingain/tls/key.pem` | Private key (never leaves the server, never appears in any API response or backup) |
| `/var/lib/braingain/tls/cert.pem` | Server certificate |
| `/var/lib/braingain/tls/chain.pem` | Intermediate chain, if supplied |
| `/var/lib/braingain/tls/source` | `self-signed` or `uploaded` |

### 8.2 Option A — upload through the admin UI (recommended)

Under **Settings → TLS certificate**, paste the PEM-encoded certificate, private key and (if your CA
issues one) the intermediate chain. The application validates that the PEM parses and that the key
matches the certificate, rejecting the upload with a clear error otherwise, then **hot-swaps the
running server's secure context**. New connections use the new certificate immediately; no restart
and no downtime.

The certificate's subject must match the DNS name users type. Supported input is standard PEM, so a
certificate from any commercial or internal CA works, as does one from Azure Key Vault after export.

### 8.3 Option B — Let's Encrypt with automatic renewal

Because the application binds 443 itself, use the standalone certbot authenticator on port 80 and
copy the result into the data directory. Port 80 must be open in the NSG for this to validate.

```bash
sudo apt-get install -y certbot
sudo systemctl stop braingain
sudo certbot certonly --standalone -d braingain.example.com --agree-tos -m admin@example.com
sudo systemctl start braingain
```

Install a deploy hook so each renewal lands in the data directory and is picked up:

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/braingain.sh > /dev/null <<'EOF'
#!/bin/bash
set -e
D=/etc/letsencrypt/live/braingain.example.com
T=/var/lib/braingain/tls
install -o braingain -g braingain -m 600 "$D/privkey.pem" "$T/key.pem"
install -o braingain -g braingain -m 644 "$D/cert.pem"    "$T/cert.pem"
install -o braingain -g braingain -m 644 "$D/chain.pem"   "$T/chain.pem"
echo uploaded > "$T/source"
chown braingain:braingain "$T/source"
systemctl restart braingain
EOF

sudo chmod 700 /etc/letsencrypt/renewal-hooks/deploy/braingain.sh
```

Certbot's renewal timer also needs port 80 free at renewal time; add pre/post hooks that stop and
start the service, or switch to a DNS-01 authenticator to avoid the brief interruption entirely.

Files copied in this way are read at **start-up**, which is why the hook restarts the service —
only the admin UI upload path performs a live hot-swap.

### 8.4 A warning about HSTS

Every response carries `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Once a
browser has loaded the site, it will refuse plain HTTP to that hostname **and all its subdomains**
for a year. Use a hostname you control fully and intend to keep on HTTPS; do not test against a
shared parent domain.

---

## 9. Optional — Microsoft Entra ID single sign-on

BrainGain verifies Entra **ID tokens** issued to a browser-side MSAL client. There is no client
secret and no server-side callback route to configure.

### 9.1 Register the application in Entra ID

In the Azure portal, **Microsoft Entra ID → App registrations → New registration**:

- **Name**: BrainGain
- **Supported account types**: *Accounts in this organizational directory only* (single tenant) —
  the server rejects tokens from any other tenant.
- **Redirect URI**: platform **Single-page application (SPA)**, value
  `https://braingain.example.com` — the origin only, no path. The sign-in uses a popup, so no
  dedicated callback route exists.

From the registration's **Overview** page, note the **Application (client) ID** and the
**Directory (tenant) ID**.

Under **Token configuration**, ensure the `email` claim is present in the ID token (the server needs
`email` or `preferred_username`, plus `oid` and `name`). Delegated permissions `openid`, `profile`
and `email` are sufficient; no admin consent for Graph is required.

### 9.2 Enable it in BrainGain

Sign in as an administrator, open **Settings → Single sign-on**, and set:

- **Tenant ID** and **Client ID** from the registration.
- **Allowed domains** — the email domains that may be provisioned through SSO. Restricting this is
  what prevents guest or personal accounts in your tenant from creating BrainGain accounts.
- Enable the toggle and save.

The sign-in page then offers *Sign in with Microsoft*. Local email/password sign-in continues to work
alongside it.

### 9.3 Verification and network requirements

The server fetches Microsoft's signing keys from
`https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys` and caches them for 24 hours, so
**outbound HTTPS to `login.microsoftonline.com` must be permitted**. Tokens are pinned to RS256 and
checked against the configured audience, issuer and tenant, with five minutes of clock tolerance.

If sign-in fails, `journalctl -u braingain` distinguishes the causes: a token problem returns 401,
whereas an unreachable JWKS endpoint surfaces as a 500 — the latter is a firewall or DNS issue on the
VM, not a configuration error.

---

## 10. Optional — SMTP for reminder email

Configure this under **Settings → Email (SMTP)**: host, port, implicit-TLS toggle, username,
password, From name and From address. Credentials are stored in the data directory; the password is
never returned by the API, and the UI only reports whether one is set.

Practical notes for Azure:

- **Outbound port 25 is blocked** on most Azure subscriptions and will not be unblocked. Use 587
  with STARTTLS (leave the implicit-TLS toggle off) or 465 (toggle on).
- Reminder mail places all recipients in **BCC**, so learners never see each other's addresses.
- The connection and greeting time out after 10 seconds, so a wrong host fails fast rather than
  hanging the request.
- If you relay through Microsoft 365, note that SMTP AUTH is disabled by default per mailbox and
  basic authentication is being retired — prefer a dedicated relay (for example Azure Communication
  Services Email or your corporate MTA) over a user mailbox.

Use the **Send test email** action in the settings page to confirm before relying on reminders.

---

## 11. Backups and disaster recovery

Protect the deployment at two levels: the application's own backups (fast, granular, restorable from
the UI) and Azure's infrastructure backups (protects against loss of the VM itself).

### 11.1 In-application backups

Under **Settings → Backups**, enable automatic backups and set the interval in days and how many to
keep. The scheduler checks hourly and catches up at start-up, so a backup the server slept through is
taken at the next boot rather than being skipped.

A backup is a ZIP containing all JSON stores and every uploaded material file. Two things are
deliberately **excluded**: the `tls/` directory (the private key must never leave the server) and the
`backups/` directory itself (no recursion). Retention prunes **automatic** backups only — manual,
uploaded and pre-restore archives are never aged out.

Restoring validates the archive first, then takes an automatic *pre-restore* snapshot, stages every
file and swaps it into place. A corrupt or foreign archive is rejected before anything is written,
and a failure after the snapshot names the snapshot to recover from. The running certificate is never
touched by a restore.

### 11.2 Infrastructure backups

Enable Azure Backup for the VM so the OS disk and data are recoverable if the VM is lost:

```bash
az backup vault create -g "$RG" -n rsv-braingain -l "$LOC"
az backup protection enable-for-vm -g "$RG" -v rsv-braingain \
  --vm "$VM" --policy-name DefaultPolicy
```

For an off-box copy of application data only, sync the data directory to Azure Storage on a schedule:

```bash
sudo tar -czf /tmp/braingain-data-$(date +%F).tgz -C /var/lib braingain
az storage blob upload --account-name <storageaccount> --container-name braingain-backups \
  --file /tmp/braingain-data-$(date +%F).tgz --auth-mode login
```

Treat these archives as sensitive: they contain bcrypt password hashes, SMTP credentials and, if you
copy the whole directory, the TLS private key.

### 11.3 What to back up

| Path | Why |
|---|---|
| `/var/lib/braingain/` | All application data, uploaded material, certificate and backup archives |
| `/etc/braingain/braingain.env` | `JWT_SECRET` — restoring data with a different secret is fine, but keeping it avoids signing everyone out |
| `/etc/systemd/system/braingain.service` | Service definition |

The application code needs no backup; it is rebuilt from the repository.

---

## 12. Upgrading

Data migrations run automatically at boot, so an upgrade is: snapshot, fetch, rebuild, restart.

```bash
# 1. Take a backup from the admin UI (Settings -> Backups -> Create backup), or snapshot the disk.

# 2. Fetch the new release
cd /opt/braingain/app
sudo git fetch --all --tags
sudo git checkout <new-release-tag>

# 3. Rebuild both halves
sudo npm --prefix backend ci && sudo npm --prefix backend run build
sudo npm --prefix frontend ci && sudo npm --prefix frontend run build
sudo npm --prefix backend prune --omit=dev

# 4. Restart and verify
sudo systemctl restart braingain
sudo journalctl -u braingain -n 30 --no-pager
curl -sk https://localhost/api/health
```

Because `DATA_DIR` points outside the code tree, rebuilding never touches user data. Expect a few
seconds of downtime at the restart. Roll back by checking out the previous tag, rebuilding and
restarting; if a migration changed data in a way you need to undo, restore the backup from step 1.

---

## 13. Operations

### 13.1 Routine commands

```bash
sudo systemctl status braingain           # state
sudo systemctl restart braingain          # restart
sudo journalctl -u braingain -f           # live logs
sudo journalctl -u braingain --since "1 hour ago"
sudo ss -tlnp | grep node                 # confirm both listeners
du -sh /var/lib/braingain/*               # data growth by area
```

### 13.2 Health monitoring

`GET /api/health` is unauthenticated and returns `{"ok":true}`. Use it for Azure Load Balancer health
probes, Application Insights availability tests, or any external monitor. Monitor certificate expiry
too — the admin UI shows the active certificate's validity window, subject, issuer and fingerprint.

### 13.3 Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| Service fails at start, `EACCES` on 443 | Missing capability to bind a privileged port | Confirm `AmbientCapabilities=CAP_NET_BIND_SERVICE` is in the unit, then `daemon-reload` and restart |
| `EADDRINUSE` in the log | Another process holds 80 or 443 | Identify it with `sudo ss -tlnp` — commonly certbot standalone or a leftover process |
| API answers but the browser shows a 404 | `frontend/dist` absent at start-up | Build the frontend, then **restart** the service |
| Everything works locally, nothing from outside | NSG or `ufw` | Check both: `az network nsg rule list` and `sudo ufw status` |
| Certificate warning persists after upload | Name mismatch, or missing intermediate chain | Certificate subject must match the DNS name; supply `chain.pem` when the CA issues intermediates |
| Users signed out unexpectedly | `JWT_SECRET` changed | Expected — tokens signed with the old secret no longer verify |
| SSO returns 401 | Wrong tenant/client ID, expired token, or clock skew over 5 minutes | Verify the IDs against the app registration; check `timedatectl` |
| SSO returns 500 | Signing keys unreachable | Allow outbound HTTPS to `login.microsoftonline.com`; check DNS on the VM |
| Test email fails | Blocked port 25, wrong TLS mode, or bad credentials | Use 587/STARTTLS or 465/implicit TLS; `nc -vz <host> 587` from the VM |
| Material upload rejected | File over 100 MB | Hard limit in the API; split the material or host it as a link instead |
| Data vanished after a rebuild | `DATA_DIR` unset, so data lived in `backend/dist/data` | Set `DATA_DIR`, restore from backup, restart |

### 13.4 Data directory layout

```
/var/lib/braingain/
├── users.json          Accounts, bcrypt hashes, role and org-unit assignments
├── roles.json          Job roles and their required trainings
├── trainings.json      Trainings, materials, quiz questions, recurrence
├── sessions.json       Completed training sessions (results)
├── orgUnits.json       Organisational unit hierarchy
├── settings.json       Pass threshold, company name, SSO, SMTP, backup policy
├── materials/          Uploaded material files plus their .meta.json sidecars
├── backups/            Server-side backup archives plus sidecars
└── tls/                key.pem, cert.pem, chain.pem, source
```

---

## 14. Security checklist

Work through this before handing the system to users.

- [ ] `JWT_SECRET` set to a strong random value; `/etc/braingain/braingain.env` is `0600` root-owned
- [ ] `DATA_DIR` set to `/var/lib/braingain`, owned by the `braingain` user, mode `750`
- [ ] All three seeded demo accounts deleted or given new passwords
- [ ] A CA-issued certificate matching the DNS name is installed; no browser warning remains
- [ ] NSG allows only 443, 80 and SSH; SSH is restricted to an administrative source range
- [ ] SSH uses key authentication; password authentication disabled
- [ ] `ufw` enabled with the same three services
- [ ] Automatic backups enabled, and at least one restore rehearsed on a test VM
- [ ] Azure Backup protecting the VM
- [ ] `unattended-upgrades` active for OS security patches
- [ ] Entra allowed-domains list restricted to your own domains (if SSO is enabled)
- [ ] Log review or alerting in place (`journalctl`, or forward to Azure Monitor)

Two application-level notes worth recording in your risk assessment. First, the API sends permissive
CORS headers, so cross-origin requests are not blocked at that layer; requests still require a valid
bearer token, which the SPA holds in `localStorage` rather than a cookie, so this is not a
cross-site-request-forgery path — but do not place other applications on the same hostname. Second,
sessions are 7-day JWTs with no server-side revocation list: disabling an account prevents new
sign-ins, and rotating `JWT_SECRET` is the mechanism for invalidating tokens already issued.

---

## Appendix A — Environment variable reference

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `<install>/backend/dist/data` | Root of all persisted data. Set explicitly in production. |
| `JWT_SECRET` | `braingain-secret` | Signs and verifies 7-day session tokens. Must be overridden. |
| `HTTPS_PORT` | `3011` | Application HTTPS listener. Takes precedence over `PORT`. |
| `PORT` | — | Alternative name for the HTTPS port; used only if `HTTPS_PORT` is unset. |
| `HTTP_PORT` | `3010` | Redirect-only HTTP listener. |
| `ENTRA_AUTHORITY_BASE` | `https://login.microsoftonline.com` | Test hook for a stub identity provider. Never set in production. |

## Appendix B — Ports

| Port | Direction | Purpose |
|---|---|---|
| 443/tcp | Inbound | Application (API + SPA) over TLS |
| 80/tcp | Inbound | 308 redirect to HTTPS; HTTP-01 certificate validation |
| 22/tcp | Inbound | SSH administration — restrict by source |
| 443/tcp | Outbound | Entra signing keys (`login.microsoftonline.com`), package installs |
| 587 or 465/tcp | Outbound | SMTP relay for reminder email |

## Appendix C — Complete install, condensed

For a rebuild on a fresh VM, once §3 has created the infrastructure:

```bash
# OS
sudo apt-get update && sudo apt-get -y upgrade
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs git
sudo useradd --system --home /var/lib/braingain --shell /usr/sbin/nologin braingain
sudo mkdir -p /opt/braingain /var/lib/braingain /etc/braingain
sudo chown -R braingain:braingain /var/lib/braingain && sudo chmod 750 /var/lib/braingain

# Application
sudo git clone <repository-url> /opt/braingain/app
cd /opt/braingain/app
sudo npm --prefix backend ci  && sudo npm --prefix backend run build
sudo npm --prefix frontend ci && sudo npm --prefix frontend run build
sudo npm --prefix backend prune --omit=dev
sudo chown -R root:root /opt/braingain/app

# Configuration + service (see §6 for the full files)
sudo tee /etc/braingain/braingain.env > /dev/null <<EOF
DATA_DIR=/var/lib/braingain
JWT_SECRET=$(openssl rand -base64 48)
HTTPS_PORT=443
HTTP_PORT=80
NODE_ENV=production
EOF
sudo chmod 600 /etc/braingain/braingain.env
# ... install braingain.service from §6.2 ...
sudo systemctl daemon-reload && sudo systemctl enable --now braingain

# Verify
curl -sk https://localhost/api/health
```

Then complete §7 (replace the demo accounts) and §8 (install a real certificate) before announcing
the service.
