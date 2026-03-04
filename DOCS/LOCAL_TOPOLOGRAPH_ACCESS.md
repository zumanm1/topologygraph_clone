# Topolograph local access and login

## Correct URL and login

- **App URL (and login):** **http://localhost:8080/**
- There is no separate “login page” URL. Open **http://localhost:8080/** and use the **Login** or **Local login** link/button on that same site.
- **Default credentials** (from `topolograph-docker/.env`):
  - **Email:** `ospf@topolograph.com`
  - **Password:** `ospf`

When Topolograph is running correctly, the home page shows the Topolograph title and OSPF/IS-IS topology UI, not a generic “Welcome to nginx!” message.

---

## If you see “Welcome to nginx!” instead of Topolograph

That message is the **default Nginx welcome page**. It usually means one of these:

1. **Another Nginx (or other app) is using port 8080**  
   Your browser is talking to that service, not the Topolograph Docker app.

2. **Topolograph Docker stack is not running**  
   So nothing from Topolograph is listening on 8080.

### Fix: free port 8080 for Topolograph

**Option A – Use Topolograph on a different port (e.g. 8081)**

1. Open `topolograph-docker/.env`.
2. Set:
   ```bash
   TOPOLOGRAPH_PORT=8081
   ```
3. Restart the stack:
   ```bash
   cd topolograph-docker && docker compose down && docker compose up -d
   ```
4. Use **http://localhost:8081/** for the app and login.

**Option B – Stop whatever is using 8080**

1. See what is listening on 8080:
   ```bash
   lsof -i :8080
   ```
2. Stop that process (or disable that nginx/service) so that only Docker uses 8080.
3. Start Topolograph:
   ```bash
   ./start_topolograph.sh
   ```
4. Use **http://localhost:8080/** for the app and login.

### Check that Topolograph is running

```bash
docker ps
```

You should see containers such as `webserver`, `flask`, `mongodb`, `mcp-server`. If not, start the stack:

```bash
./start_topolograph.sh
```

---

## Summary

| What you want        | URL / action |
|----------------------|--------------|
| Open Topolograph      | **http://localhost:8080/** (or **http://localhost:8081/** if you changed the port) |
| Log in                | Same URL → use **Login** / **Local login** on the page |
| Default login         | `ospf@topolograph.com` / `ospf` |
