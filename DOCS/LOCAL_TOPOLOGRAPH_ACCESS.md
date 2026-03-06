# Topolograph local access and login

## Correct URL and login

- **App URL (and login):** **http://localhost:8081/**
- There is no separate “login page” URL. Open **http://localhost:8081/** and use the **Login** or **Local login** link/button on that same site.
- **Default credentials** (from `.env` in the repository root):
  - **Email:** `ospf@topolograph.com`
  - **Password:** `ospf`

When Topolograph is running correctly, the home page shows the Topolograph title and OSPF/IS-IS topology UI, not a generic “Welcome to nginx!” message.

---

## If you see “Welcome to nginx!” instead of Topolograph

That message is the **default Nginx welcome page**. It usually means one of these:

1. **Another Nginx (or other app) is using the app port**  
   Your browser is talking to that service, not the Topolograph Docker app.

2. **Topolograph Docker stack is not running**  
   So nothing from Topolograph is listening on 8081.

### Fix: free the app port for Topolograph

**Option A – Use Topolograph on a different port (e.g. 8081)**

1. Open `.env` in the repository root.
2. Set:
   ```bash
   TOPOLOGRAPH_PORT=8081
   ```
3. Restart the stack:
   ```bash
   docker compose down && docker compose up -d
   ```
4. Use **http://localhost:8081/** for the app and login.

**Option B – Stop whatever is using 8081**

1. See what is listening on 8081:
   ```bash
   lsof -i :8081
   ```
2. Stop that process (or disable that nginx/service) so that only Docker uses 8081.
3. Start Topolograph:
   ```bash
   docker compose up -d
   ```
4. Use **http://localhost:8081/** for the app and login.

### Check that Topolograph is running

```bash
docker compose ps
```

You should see containers such as `webserver`, `flask`, `mongodb`, `mcp-server`. If not, start the stack:

```bash
docker compose up -d
```

---

## Summary

| What you want        | URL / action |
|----------------------|--------------|
| Open Topolograph      | **http://localhost:8081/** |
| Log in                | Same URL → use **Login** / **Local login** on the page |
| Default login         | `ospf@topolograph.com` / `ospf` |
