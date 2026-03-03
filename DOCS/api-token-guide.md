# Topolograph API Token — Generation & Usage Guide

**Author:** Pipeline team
**Date:** 2026-03-03
**App version:** Topolograph 2.57.2

---

## 1. Background — Three Authentication Layers

Topolograph exposes **three independent authentication mechanisms**. Understanding
the distinction is essential before attempting to generate or use any token.

| # | Layer | Mechanism | Who uses it |
|---|-------|-----------|-------------|
| 1 | **REST API** | HTTP Basic Auth (`Authorization: Basic …`) | Pipeline scripts, `workflow.sh`, `push-to-ui.py` |
| 2 | **Web UI session** | Flask-Login session cookie | Browser, `/register` + `/login` form |
| 3 | **Bearer token** | `Authorization: Bearer sk-…` | Programmatic API calls that need a long-lived key |

> **Critical insight:** Layer 1 (Basic Auth) and Layer 3 (Bearer) are backed by
> *different* user records in MongoDB, even when the email address is identical.
> Mixing them up is the single most common cause of 401 errors.

---

## 2. How Each Layer Works Internally

### 2.1 REST API — Basic Auth

- Credentials are stored in the **`users` collection** of the `admin` MongoDB
  database.
- A new user record is created on every call to `POST /create-default-credentials`
  (called automatically by the `flask-create-creds-from-env` Docker service at
  startup).
- Password is hashed with **Werkzeug** `sha256$<salt>$<hash>`.
- The authorised source IP ranges are stored in `auth_source_api_net` within
  each user document.

**Default credentials (from `.env`):**
```
TOPOLOGRAPH_WEB_API_USERNAME_EMAIL=ospf@topolograph.com
TOPOLOGRAPH_WEB_API_PASSWORD=ospf
```

Verify with:
```bash
curl -u ospf@topolograph.com:ospf http://localhost:8081/api/graph/
# Expected: HTTP 200 with JSON list of graphs
```

### 2.2 Web UI Session — Flask-Login

- Uses the same **`users`** MongoDB collection but through a different code path.
- Login form fields: `name="login"` (email) and `name="password"`.
- **Important:** Every Docker restart calls `/create-default-credentials` which
  inserts *another* user record for `ospf@topolograph.com` with a freshly-salted
  hash. Over time this creates many duplicate records, which confused our
  programmatic login attempts (the form found the wrong record).
- Web user creation via `/register` stores the password with a different
  salt scheme than the REST API path.

### 2.3 Bearer Token — `sk-…` format

- Tokens are stored in a **separate `user_tokens` collection** in MongoDB
  (not inside the `users` document).
- Each token document has the schema:
  ```json
  {
    "_id":        ObjectId,
    "token":      "sk-<random-base64>",
    "name":       "pipeline-token",
    "description":"",
    "owner_id":   ObjectId  (→ references users._id),
    "created_at": ISODate,
    "expires_at": ISODate,   // 1 year from creation
    "is_active":  true
  }
  ```
- `schemas.bearer_auth()` (compiled Cython `.so`) validates the token against
  this collection.
- The owning user must have a non-empty `auth_source_api_net` array that covers
  the calling IP, or the call will be rejected with `401 Unauthorized`.

---

## 3. Step-by-Step: How We Generated the Bearer Token

### Why the obvious paths failed

1. **`POST /token_management/create_token` with basic auth** → `302 → /login`
   The endpoint requires a **web session** (Flask-Login), not basic auth.

2. **`POST /login` with `requests.Session`** → `200 /login` (no redirect)
   The login form uses `name="login"` (not `name="email"`). More importantly,
   because `wsgi.py` calls `/create-default-credentials` on every import inside
   a test client, a *new* user was inserted before the login lookup ran, causing
   the password check to match the wrong record.

3. **Generating a JWT manually with `authlib`** → `401 Invalid or expired token`
   The app does not use JWT; it uses opaque `sk-…` tokens stored in MongoDB.

4. **Playwright browser automation** → timeouts
   The login form's submit element is `input[type=submit][value=Login]`, not
   `button[type=submit]`. Register form uses `button.btn-primary`. The two
   pages have different submit elements.

### The approach that worked

Used the **Flask test client with a proper app context** inside the running
container to:

1. Register a fresh web user (avoids the duplicate-record problem).
2. Call `POST /token_management/create_token` within the same session.
3. Read the resulting `sk-…` token directly from the **`user_tokens`** MongoDB
   collection.

```python
# Run inside the flask container:
# docker exec flask python3 /tmp/mk_token.py

import sys
sys.path.insert(0, "/home/flask/flask")
from wsgi import app
import re, pymongo
from config import DB

EMAIL    = "pipelineuser@local.dev"
PASSWORD = "ospf1234"

with app.test_client() as c:
    # 1 — Get CSRF token from register page
    r0 = c.get("/register")
    csrf = re.search(rb'name="csrf_token"[^>]*value="([^"]+)"', r0.data)
    csrf_val = csrf.group(1).decode() if csrf else ""

    # 2 — Register new web user (one-time; skip if user already exists)
    c.post("/register", data={
        "validationEmail": EMAIL,
        "validationPassword": PASSWORD,
        "csrf_token": csrf_val,
    }, follow_redirects=True)

    # 3 — Create the token (session is preserved inside test_client context)
    r_tok = c.get("/token_management/create_token")
    csrf2 = re.search(rb'name="csrf_token"[^>]*value="([^"]+)"', r_tok.data)
    c.post("/token_management/create_token", data={
        "token_name": "pipeline-token",
        "csrf_token": csrf2.group(1).decode() if csrf2 else "",
    }, follow_redirects=True)

# 4 — Read the token from MongoDB (it is NOT returned in the HTTP response body
#     as plain text — it is only stored in the DB)
client = pymongo.MongoClient(
    host=DB.MONGO_HOST, port=DB.MONGO_PORT,
    username=DB.MONGO_USER, password=DB.MONGO_PASS,
    authSource=DB.MONGO_DB
)
db = client[DB.MONGO_DB]
tok_doc = db.user_tokens.find_one({"name": "pipeline-token"}, sort=[("_id", -1)])
print("TOKEN:", tok_doc["token"])
```

After the token was extracted, the owning user's `auth_source_api_net` was
empty (`[]`), which caused a `401` from real HTTP requests (the Cython auth
function returns `401` for untrackable IPs unless the array is populated).

**Fix — add IP ranges to the web user:**
```bash
docker exec mongodb mongo admin \
  -u admin -p myadminpassword --quiet \
  --eval 'db.users.updateOne(
    {login: "pipelineuser@local.dev"},
    {$set: {auth_source_api_net: [
      "127.0.0.1/32","10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"
    ]}}
  )'
```

---

## 4. Active Token

| Field | Value |
|-------|-------|
| Token | `sk-olsjudhwuswVKgflPLeHHCE5oOEB7o0pLx8pu7ekTz1pc9hwYYisFZTm0Dsns2pP` |
| Owner | `pipelineuser@local.dev` |
| Name | `pipeline-token` |
| Created | 2026-03-03 |
| Expires | 2027-03-03 |
| Stored in | `.api-token` (project root), `topolograph-docker/.env` → `API_TOKEN=…` |

> **Security note:** `.api-token` and `topolograph-docker/.env` are both listed
> in `.gitignore` and will **not** be committed to version control.

---

## 5. Using the Bearer Token

### curl
```bash
TOKEN=$(grep API_TOKEN .api-token | cut -d= -f2)

# List all graphs
curl -s http://localhost:8081/api/graph/ \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Get nodes for a specific graph
curl -s "http://localhost:8081/api/diagram/<graph_time>/nodes" \
  -H "Authorization: Bearer $TOKEN"
```

### Python (requests)
```python
import requests

TOKEN = "sk-olsjudhwuswVKgflPLeHHCE5oOEB7o0pLx8pu7ekTz1pc9hwYYisFZTm0Dsns2pP"
BASE  = "http://localhost:8081"

headers = {"Authorization": f"Bearer {TOKEN}"}
r = requests.get(f"{BASE}/api/graph/", headers=headers)
graphs = r.json()
print(f"{len(graphs)} graph(s) available")
```

### Shell script (load from .api-token)
```bash
source .api-token          # loads API_TOKEN into environment
export BEARER="$API_TOKEN"

curl -H "Authorization: Bearer $BEARER" http://localhost:8081/api/graph/
```

---

## 6. Regenerating the Token

When the token expires (annually) or is revoked, regenerate it by running
the Flask test-client script shown in §3 inside the running container, then
updating `.api-token` and `topolograph-docker/.env` with the new value.

Or via the **Topolograph Web UI** (manual steps):

1. Open `http://localhost:8081/register` in a browser.
2. Enter email `pipelineuser@local.dev` + password.
   *(If already registered, go to `/login` instead — use the `login` field, not `email`.)*
3. Navigate to **API → Token** in the top nav bar → `Admin dashboard`.
4. Click **Create token**, give it a name (e.g. `pipeline-token`).
5. Run the MongoDB read command below to retrieve the value:

```bash
docker exec mongodb mongo admin \
  -u admin -p myadminpassword --quiet \
  --eval 'db.user_tokens.find({name:"pipeline-token"}).sort({_id:-1}).limit(1).pretty()'
```

---

## 7. Quick Reference — MongoDB Collections

| Collection | Purpose |
|-----------|---------|
| `users` | REST API users + web login users (same collection, different records) |
| `user_tokens` | Bearer `sk-…` tokens (separate from `users`) |
| `graphs` | Uploaded OSPF topology graphs |
| `hosts` | Host-to-IP mappings (loaded from host file) |
| `groupsets` | Node grouping / country metadata |

---

## 8. Key Lessons Learned

| # | Lesson |
|---|--------|
| 1 | The token format is `sk-<random-base64>`, **not** a JWT and **not** a hex digest. |
| 2 | Tokens live in `user_tokens`, **not** inside the `users` document. |
| 3 | Every `docker compose up` creates a new `users` record via `create-default-credentials`. Over time this causes duplicate-record confusion for web login. |
| 4 | `auth_source_api_net: []` (empty) causes **all** bearer token calls to fail with 401, even with a valid token. Always populate this field after creating a web user. |
| 5 | The REST API (Basic Auth) and Bearer Token paths use **different user records** and cannot be used interchangeably. |
| 6 | The `schemas.py` and `routes.py` files are **Cython-compiled `.so` binaries** — source code is not readable; behaviour must be inferred by testing. |
