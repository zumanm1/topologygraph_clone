import hashlib
import hmac
import ipaddress
import os
import secrets
from datetime import datetime, timedelta, timezone

import pymongo
import requests
from bson import ObjectId
from flask import Response, abort, jsonify, make_response, redirect, render_template, request, session
from flask_login import current_user
from werkzeug.security import generate_password_hash

import routes

app = routes.app
MONGO_HOST = os.getenv('MONGODB_HOSTNAME', 'mongodb')
MONGO_PORT = int(os.getenv('MONGODB_PORT_INTERNAL', '27017'))
MONGO_DB = os.getenv('MONGODB_DATABASE', 'admin')
MONGO_USER = os.getenv('MONGODB_USERNAME', 'admin')
MONGO_PASS = os.getenv('MONGODB_PASSWORD', 'myadminpassword')
DEFAULT_LOGIN = os.getenv('TOPOLOGRAPH_WEB_API_USERNAME_EMAIL', '')
DEFAULT_PASSWORD = os.getenv('TOPOLOGRAPH_WEB_API_PASSWORD', '')
DEFAULT_NETS = os.getenv('TOPOLOGRAPH_WEB_API_AUTHORISED_NETWORKS', '127.0.0.1/32')
TOKEN_SECRET = os.getenv('TOKEN_HASH_SECRET') or os.getenv('TOPOLOGRAPH_BOOTSTRAP_SECRET') or DEFAULT_PASSWORD or MONGO_PASS
BOOTSTRAP_SECRET = os.getenv('TOPOLOGRAPH_BOOTSTRAP_SECRET') or DEFAULT_PASSWORD
TOKEN_EXPIRY_DAYS = int(os.getenv('TOKEN_EXPIRY_DAYS', '365'))
TOKENS = os.getenv('SECURE_TOKEN_COLLECTION', 'user_tokens_secure')
HEADERS_ON = os.getenv('ENABLE_SECURITY_HEADERS', 'true').lower() == 'true'

app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')
app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'false').lower() == 'true'
app.config['REMEMBER_COOKIE_HTTPONLY'] = True
app.config['REMEMBER_COOKIE_SAMESITE'] = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')
app.config['REMEMBER_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'false').lower() == 'true'

_db = pymongo.MongoClient(host=MONGO_HOST, port=MONGO_PORT, username=MONGO_USER, password=MONGO_PASS, authSource=MONGO_DB)[MONGO_DB]
_users = _db.users
_tokens = _db[TOKENS]
_tokens.create_index('token_hash', unique=True)
_tokens.create_index([('owner_login', 1), ('created_at', -1)])

_old_add = app.view_functions.get('add_auth_source_api_net')
_old_del = app.view_functions.get('delete_auth_source_ip_net')


def _now():
    return datetime.now(timezone.utc)


def _hash(v):
    return hmac.new(TOKEN_SECRET.encode(), v.encode(), hashlib.sha256).hexdigest()


def _csrf():
    t = session.get('_security_csrf_token')
    if not t:
        t = secrets.token_urlsafe(32)
        session['_security_csrf_token'] = t
    return t


def _check_csrf():
    want = session.get('_security_csrf_token') or ''
    got = request.form.get('csrf_token') or request.headers.get('X-CSRF-Token') or ''
    if not want or not got or not hmac.compare_digest(want, got):
        abort(400)


def _login():
    if not getattr(current_user, 'is_authenticated', False):
        return ''
    login = getattr(current_user, 'login', None)
    if login:
        return str(login)
    getter = getattr(current_user, 'get_id', None)
    return str(getter()) if callable(getter) and getter() else ''


def _nets(v):
    out = []
    for item in (v or '').split(','):
        item = item.strip()
        if not item:
            continue
        try:
            net = str(ipaddress.ip_network(item, strict=False))
        except ValueError:
            continue
        if net not in out:
            out.append(net)
    return out or ['127.0.0.1/32']


def _client_ip():
    forwarded = (request.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
    candidate = forwarded or request.headers.get('X-Real-IP') or request.remote_addr or '127.0.0.1'
    try:
        return ipaddress.ip_address(candidate)
    except ValueError:
        return ipaddress.ip_address('127.0.0.1')


def _allowed_for_user(login):
    doc = _users.find_one({'login': login}, {'auth_source_api_net': 1}) or {}
    nets = doc.get('auth_source_api_net') or []
    if not nets:
        return False
    client_ip = _client_ip()
    for net in nets:
        try:
            if client_ip in ipaddress.ip_network(net, strict=False):
                return True
        except ValueError:
            continue
    return False


def security_csrf_token():
    return _csrf()


app.jinja_env.globals['security_csrf_token'] = security_csrf_token


@app.after_request
def _secure(resp):
    proxied = bool(request.headers.get('X-Forwarded-For'))
    if HEADERS_ON and not proxied:
        resp.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
        resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
        resp.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
        resp.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if request.path.startswith('/token_management/') or request.path == '/admin_dashboard':
        resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        resp.headers['Pragma'] = 'no-cache'
        resp.headers['Expires'] = '0'
    return resp


@app.route('/__security/api-auth', methods=['GET'])
def security_api_auth():
    h = request.headers.get('Authorization', '')
    r = Response(status=204)
    if not h:
        login = _login()
        if not login:
            return Response(status=401)
        r.headers['X-Security-Auth-Scheme'] = 'session'
        r.headers['X-Authenticated-User'] = login
        return r
    if h.startswith('Basic '):
        r.headers['X-Security-Auth-Scheme'] = 'basic'
        return r
    if not h.startswith('Bearer '):
        return Response(status=401)
    tok = h.split(' ', 1)[1].strip()
    doc = _tokens.find_one({'token_hash': _hash(tok), 'is_active': True})
    if not doc:
        return Response(status=401)
    exp = doc.get('expires_at')
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp <= _now():
        _tokens.update_one({'_id': doc['_id']}, {'$set': {'is_active': False}})
        return Response(status=401)
    if not _allowed_for_user(doc.get('owner_login', '')):
        return Response(status=401)
    _tokens.update_one({'_id': doc['_id']}, {'$set': {'last_used_at': _now()}})
    r.headers['X-Security-Auth-Scheme'] = 'bearer'
    r.headers['X-Authenticated-User'] = doc.get('owner_login', '')
    return r


@app.route('/__security/mcp-auth', methods=['GET'])
def security_mcp_auth():
    h = request.headers.get('Authorization', '')
    if not h or not h.startswith('Bearer '):
        return Response(status=401)
    return security_api_auth()


@app.route('/__security/session-auth', methods=['GET'])
def security_session_auth():
    login = _login()
    if not login:
        return Response(status=401)
    r = Response(status=204)
    r.headers['X-Authenticated-User'] = login
    return r


@app.route('/__security/session-diagram/<path:graph_time>/nodes', methods=['GET'])
def security_session_diagram_nodes(graph_time):
    login = _login()
    if not login:
        return jsonify({'detail': 'No session provided', 'status': 401, 'title': 'Unauthorized', 'type': 'about:blank'}), 401
    try:
        upstream = requests.get(
            f'http://127.0.0.1:5000/api/diagram/{graph_time}/nodes',
            auth=(DEFAULT_LOGIN, DEFAULT_PASSWORD),
            timeout=20,
        )
    except requests.RequestException as exc:
        return jsonify({'detail': f'Upstream diagram lookup failed: {exc}', 'status': 502, 'title': 'Bad Gateway', 'type': 'about:blank'}), 502
    return Response(
        upstream.content,
        status=upstream.status_code,
        content_type=upstream.headers.get('Content-Type', 'application/json'),
    )


def _token_rows(login):
    return list(_tokens.find({'owner_login': login}).sort('created_at', -1))


def _token_payload(doc):
    exp = doc.get('expires_at')
    return {
        'id': str(doc['_id']),
        'name': doc.get('name', ''),
        'description': doc.get('description', ''),
        'masked': 'sk-••••••••••••' + doc.get('token_last4', ''),
        'is_active': bool(doc.get('is_active', False)),
        'created_at': doc.get('created_at'),
        'expires_at': exp,
        'last_used_at': doc.get('last_used_at'),
        'is_expired': bool(exp and ((exp.replace(tzinfo=timezone.utc) if exp.tzinfo is None else exp) <= _now())),
    }


def _issue_token():
    return 'sk-' + secrets.token_urlsafe(48)


def _bootstrap_allowed():
    if request.method != 'POST':
        return False
    header = request.headers.get('X-Topolograph-Bootstrap-Secret', '')
    if BOOTSTRAP_SECRET and hmac.compare_digest(header, BOOTSTRAP_SECRET):
        return True
    if request.headers.get('X-Forwarded-For'):
        return False
    try:
        ip = ipaddress.ip_address(request.remote_addr or '127.0.0.1')
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback


def _ensure_default_user():
    login = DEFAULT_LOGIN
    if not login:
        return {'status': 'error', 'msg': 'missing default login'}, 500
    password_hash = generate_password_hash(DEFAULT_PASSWORD, method='sha256')
    auth_nets = _nets(DEFAULT_NETS)
    docs = list(_users.find({'login': login}).sort('_id', -1))
    keep = docs[0] if docs else None
    if keep:
        _users.update_one(
            {'_id': keep['_id']},
            {'$set': {'password': password_hash, 'auth_source_api_net': auth_nets}, '$setOnInsert': {'backup_plots_full_path': [], 'roles': [], 'creation_date': _now()}},
        )
        if len(docs) > 1:
            _users.delete_many({'_id': {'$in': [doc['_id'] for doc in docs[1:]]}})
    else:
        _users.insert_one({'login': login, 'password': password_hash, 'auth_source_api_net': auth_nets, 'backup_plots_full_path': [], 'roles': [], 'creation_date': _now()})
    return {'status': 'ok', 'login': login, 'auth_source_api_net': auth_nets}


@app.route('/token_management/create_token', methods=['GET', 'POST'], endpoint='security_create_token')
def security_create_token_page():
    login = _login()
    if not login:
        return redirect('/login')
    if request.method == 'GET':
        return render_template('security-token-create.html', csrf_token=_csrf(), generated_token=None, token_name='')
    _check_csrf()
    token_name = (request.form.get('token_name') or '').strip()
    description = (request.form.get('description') or '').strip()
    if not token_name:
        return make_response(render_template('security-token-create.html', csrf_token=_csrf(), generated_token=None, token_name=token_name, error='Token name is required'), 400)
    token_value = _issue_token()
    _tokens.insert_one({'name': token_name, 'description': description, 'owner_login': login, 'token_hash': _hash(token_value), 'token_last4': token_value[-4:], 'created_at': _now(), 'expires_at': _now() + timedelta(days=TOKEN_EXPIRY_DAYS), 'is_active': True, 'last_used_at': None})
    return render_template('security-token-create.html', csrf_token=_csrf(), generated_token=token_value, token_name=token_name, success='Token created. Copy it now; it will not be shown again.')


@app.route('/token_management/my_tokens', methods=['GET'], endpoint='security_my_tokens')
def security_my_tokens_page():
    login = _login()
    if not login:
        return redirect('/login')
    return render_template('security-token-list.html', csrf_token=_csrf(), tokens=[_token_payload(doc) for doc in _token_rows(login)])


@app.route('/token_management/delete_token/<token_id>', methods=['POST'], endpoint='security_delete_token_post')
def security_delete_token_post(token_id):
    login = _login()
    if not login:
        return redirect('/login')
    _check_csrf()
    try:
        oid = ObjectId(token_id)
    except Exception:
        abort(404)
    _tokens.delete_one({'_id': oid, 'owner_login': login})
    return redirect('/token_management/my_tokens')


@app.route('/token_management/revoke_token/<token_id>', methods=['POST'], endpoint='security_revoke_token_post')
def security_revoke_token_post(token_id):
    login = _login()
    if not login:
        return redirect('/login')
    _check_csrf()
    try:
        oid = ObjectId(token_id)
    except Exception:
        abort(404)
    _tokens.update_one({'_id': oid, 'owner_login': login}, {'$set': {'is_active': False}})
    return redirect('/token_management/my_tokens')


def _reject_token_get(*args, **kwargs):
    abort(405)


def _wrap_old_add():
    login = _login()
    if not login:
        abort(401)
    _check_csrf()
    return _old_add()


def _wrap_old_del():
    login = _login()
    if not login:
        abort(401)
    _check_csrf()
    return _old_del()


def _default_registration():
    if not _bootstrap_allowed():
        abort(403)
    payload = _ensure_default_user()
    return jsonify(payload)


app.view_functions['create_token'] = security_create_token_page
app.view_functions['my_tokens'] = security_my_tokens_page
app.view_functions['delete_token'] = _reject_token_get
app.view_functions['revoke_token'] = _reject_token_get
app.view_functions['do_default_registration'] = _default_registration
if _old_add:
    app.view_functions['add_auth_source_api_net'] = _wrap_old_add
if _old_del:
    app.view_functions['delete_auth_source_ip_net'] = _wrap_old_del


@app.route('/country-overrides/save', methods=['POST'], endpoint='security_countries_save')
def security_countries_save():
    login = _login() or 'anonymous'
    
    data = request.json or {}
    graph_time = data.get('graph_time')
    overrides = data.get('overrides')
    
    if not graph_time or not isinstance(overrides, dict):
        return jsonify({'error': 'Missing graph_time or overrides dict'}), 400

    col = _db['custom_country_mappings']
    doc = col.find_one({'graph_time': graph_time})
    if not doc:
        col.insert_one({'graph_time': graph_time, 'overrides': overrides, 'updated_by': login, 'updated_at': _now()})
    else:
        current_overrides = doc.get('overrides', {})
        current_overrides.update(overrides)
        col.update_one({'_id': doc['_id']}, {'$set': {'overrides': current_overrides, 'updated_by': login, 'updated_at': _now()}})

    return jsonify({'status': 'ok', 'saved': len(overrides)})

@app.route('/country-overrides/<path:graph_time>', methods=['GET'], endpoint='security_countries_get')
def security_countries_get(graph_time):
    col = _db['custom_country_mappings']
    doc = col.find_one({'graph_time': graph_time})
    return jsonify({'overrides': doc.get('overrides', {}) if doc else {}})


# ── PRD-13: Path Analysis Suite routes ────────────────────────────

@app.route('/path-explorer', methods=['GET'], endpoint='path_explorer_page')
def path_explorer_page():
    return render_template('path-explorer.html', csrf_token=_csrf())


@app.route('/change-planner', methods=['GET'], endpoint='change_planner_page')
def change_planner_page():
    return render_template('change-planner.html', csrf_token=_csrf())


@app.route('/impact-lab', methods=['GET'], endpoint='impact_lab_page')
def impact_lab_page():
    return render_template('impact-lab.html', csrf_token=_csrf())


@app.route('/topo-diff', methods=['GET'], endpoint='topo_diff_page')
def topo_diff_page():
    return render_template('topo-diff.html', csrf_token=_csrf())


@app.route('/cost-matrix', methods=['GET'], endpoint='cost_matrix_page')
def cost_matrix_page():
    return render_template('cost-matrix.html', csrf_token=_csrf())


@app.route('/what-if', methods=['GET'], endpoint='what_if_page')
def what_if_page():
    return render_template('what-if-analysis.html', csrf_token=_csrf())


@app.route('/api/graph-times', methods=['GET'], endpoint='api_graph_times')
def api_graph_times():
    """Return the list of uploaded OSPF graph timestamps for the logged-in user.

    Queries MongoDB directly (same source as the main Upload LSDB page) so the
    returned list is always identical to the dropdown on the main page.
    """
    login = _login()
    if not login:
        return jsonify({'error': 'Not logged in', 'graph_time_list': []}), 401

    # ── Primary: MongoDB direct query (user-scoped, same as main-page dropdown) ──
    try:
        user_doc = _users.find_one({'login': login}, {'_id': 1})
        if user_doc:
            uid = user_doc['_id']
            gt_list = sorted(
                _db.graphs.distinct('graph_time', {'owner_id': uid})
            )
            if gt_list:
                return jsonify({'graph_time_list': gt_list})
    except Exception:
        pass

    # ── Fallback: all distinct graph_times (no user filter) ─────────────────────
    try:
        gt_list = sorted(_db.graphs.distinct('graph_time'))
        if gt_list:
            return jsonify({'graph_time_list': gt_list})
    except Exception:
        pass

    # ── Last resort: empty list — JS will use URL param / localStorage ───────────
    return jsonify({'graph_time_list': []})

