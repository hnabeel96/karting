# Racing online: putting the server on the droplet

On the same wifi you only need `npm start` on a laptop. To race from different places, run the same server on the Bangalore droplet. These steps assume Ubuntu and a subdomain such as `kart.pineapp.win`.

## 1. DNS

Add an `A` record for `kart` pointing at the droplet's IP.

## 2. Node and the code

```bash
# on the droplet
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo mkdir -p /opt/karting && sudo chown $USER /opt/karting
git clone https://github.com/hnabeel96/karting /opt/karting
cd /opt/karting && npm test   # optional: proves it runs; there is nothing to install
```

## 3. Keep it running (systemd)

```bash
sudo cp /opt/karting/deploy/karting.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now karting
systemctl status karting        # should say active (running)
curl localhost:3000/health      # {"ok":true,...}
```

The service listens on `127.0.0.1:3000` only; the web server in front of it handles the outside world.

## 4. HTTPS in front

**If the droplet already runs Caddy**, add the block from `deploy/Caddyfile` to `/etc/caddy/Caddyfile` and run `sudo systemctl reload caddy`. Caddy gets the certificate and passes the game's WebSocket through on its own.

**If it runs nginx**, add a server block like this (then `sudo certbot --nginx -d kart.pineapp.win` for HTTPS):

```nginx
server {
    server_name kart.pineapp.win;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

The `Upgrade` lines matter: without them the page loads but "Race a friend" cannot connect.

## 5. Play

Both phones open `https://kart.pineapp.win`, tap **Race a friend**, and whoever is ready taps **Start race**.

## Updating

```bash
cd /opt/karting && git pull && sudo systemctl restart karting
```

## Settings

Set these in `karting.service` under `[Service]` as `Environment=NAME=value`:

| Name | Default | What it does |
|---|---|---|
| `PORT` | 3000 | port the server listens on |
| `HOST` | 0.0.0.0 | `127.0.0.1` keeps it private behind Caddy or nginx |
| `LAPS` | 3 | laps per race |
