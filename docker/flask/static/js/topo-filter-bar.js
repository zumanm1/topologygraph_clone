/* ================================================================
 * TopoFilterBar — shared topology filter toolbar
 * Used by: K-Path Explorer, Change Planner, Impact Lab, Topo Diff
 *
 * Provides:
 *   🌍 Country filter   — show/hide nodes by A-type country code
 *   abc Net Type filter — A / B / C / UNK node classification
 *   📦 A-Groups panel   — collapsible country → node tree
 *   ⚠ UNK filter        — show only unclassified (non-A) nodes
 *   View mode           — AS-IS | GATEWAY | ENRICHED | COLLAPSING
 *
 * Usage:
 *   var bar = new TopoFilterBar({
 *     containerId:       'myDivId',
 *     vNodes:            myVNodes,          // vis.DataSet (writable)
 *     vEdges:            myVEdges,          // vis.DataSet (writable)
 *     rawNodes:          _myNodes,          // source Array (read)
 *     rawEdges:          _myEdges,          // source Array (read)
 *     network:           _myNetwork,        // vis.Network (optional)
 *     secondaryVNodes:   null,              // topo-diff: 2nd DataSet
 *     secondaryVEdges:   null,
 *     secondaryRawNodes: null,
 *   });
 *
 *   // After topology reload:
 *   bar.refresh(newRawNodes, newRawEdges, newVNodes, newVEdges);
 *
 *   // After vis overlay updates (colour/width changes, blast radius, etc.)
 *   // to re-assert hidden flags on top of overlays:
 *   bar.apply();
 *
 *   // Teardown:
 *   bar.destroy();
 * ================================================================ */

function TopoFilterBar(cfg) {
  var self = this;

  // ── Config ───────────────────────────────────────────────────────
  var _containerId = cfg.containerId || '';
  var _vNodes      = cfg.vNodes            || null;
  var _vEdges      = cfg.vEdges            || null;
  var _rawNodes    = cfg.rawNodes          || [];
  var _rawEdges    = cfg.rawEdges          || [];
  var _network     = cfg.network           || null;
  var _secVNodes   = cfg.secondaryVNodes   || null;
  var _secVEdges   = cfg.secondaryVEdges   || null;
  var _secRaw      = cfg.secondaryRawNodes || [];

  // Unique instance ID (for element IDs — allows multiple bars on same page)
  var _uid = 'tfb-' + Math.random().toString(36).slice(2, 7);

  // ── Filter state ──────────────────────────────────────────────────
  var _state = {
    viewMode:        'asis',  // 'asis'|'gateway'|'enriched'|'collapsing'
    // Country filter — set of country codes to HIDE (empty = show all)
    hiddenCountries: new Set(),
    // Type filter
    activeTypes:     new Set(['A','B','C','UNK']),  // empty = all shown
    // UNK Only
    unkOnly:         false,
    // A-Groups (per-country visibility)
    groupsHidden:    new Set(),   // country codes to hide
  };

  // Active open panel (only one at a time)
  var _openPanel = null;

  // ── Country colour palette (consistent with main topolograph.js) ──
  var COUNTRY_COLORS = {
    AUS:'#22c55e', BRA:'#f59e0b', CAN:'#3b82f6', DEU:'#a78bfa',
    FRA:'#f97316', GBR:'#ec4899', IND:'#14b8a6', JPN:'#fb923c',
    USA:'#60a5fa', DEFAULT:'#9ca3af'
  };
  function _countryColor(cc) {
    return COUNTRY_COLORS[cc.toUpperCase()] || COUNTRY_COLORS.DEFAULT;
  }

  // ── Node classification ───────────────────────────────────────────
  function _classify(node) {
    var lbl = node.label || String(node.id);
    if (typeof KSP_parseAtype === 'function' && KSP_parseAtype(lbl)) return 'A';
    if (/[a-zA-Z]/.test(lbl) && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lbl)) return 'B';
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lbl)) return 'C';
    return 'UNK';
  }

  function _countryOf(node) {
    var lbl = node.label || String(node.id);
    if (typeof KSP_parseAtype !== 'function') return null;
    var p = KSP_parseAtype(lbl);
    return p ? p.country.toUpperCase() : null;
  }

  // ── Compute available countries from raw nodes ────────────────────
  function _getCountries(rawNodes) {
    var seen = {};
    (rawNodes || []).forEach(function (n) {
      var c = _countryOf(n);
      if (c) {
        if (!seen[c]) seen[c] = 0;
        seen[c]++;
      }
    });
    return Object.keys(seen).sort().map(function (c) {
      return { code: c, count: seen[c] };
    });
  }

  // ── Apply filters to vis.DataSets ─────────────────────────────────
  function _applyFilters() {
    _applyToDataset(_rawNodes, _vNodes);
    if (_secVNodes && _secRaw && _secRaw.length) {
      _applyToDataset(_secRaw, _secVNodes);
    }
    _updateStats();
  }

  function _applyToDataset(rawNodes, vNodes) {
    if (!vNodes || !rawNodes) return;
    var updates = rawNodes.map(function (n) {
      return { id: n.id, hidden: _shouldHide(n) };
    });
    vNodes.update(updates);
  }

  function _shouldHide(node) {
    var type    = _classify(node);
    var country = _countryOf(node);  // null for non-A-type

    // UNK Only mode — show ONLY non-A-type nodes
    if (_state.unkOnly) return type === 'A';

    // View mode — GATEWAY/COLLAPSING: show only A-type
    if (_state.viewMode === 'gateway' || _state.viewMode === 'collapsing') {
      if (type !== 'A') return true;
    }

    // Type filter — if not all types active, check inclusion
    if (_state.activeTypes.size > 0 && _state.activeTypes.size < 4) {
      if (!_state.activeTypes.has(type)) return true;
    }

    // Country filter (applies to A-type nodes only)
    if (country && _state.hiddenCountries.has(country)) return true;

    // A-Groups filter (explicit country hide list)
    if (country && _state.groupsHidden.has(country)) return true;

    return false;
  }

  function _visibleCount() {
    if (!_rawNodes || !_rawNodes.length) return 0;
    return _rawNodes.filter(function (n) { return !_shouldHide(n); }).length;
  }

  function _updateStats() {
    var el = document.getElementById(_uid + '-stats');
    if (!el) return;
    var visible = _visibleCount();
    var total   = (_rawNodes || []).length;
    el.textContent = visible + '/' + total + ' nodes';
    el.style.color = visible < total ? '#f59e0b' : '#6b7280';
  }

  // ── Inject CSS (once per page) ────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('tfb-style')) return;
    var css = [
      '.tfb-root{position:relative;width:100%;}',
      '.tfb-toolbar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;',
        'padding:5px 8px;background:#1a2535;border-radius:6px;',
        'border:1px solid #2d3f54;margin-bottom:6px;user-select:none;}',
      '.tfb-sep{width:1px;height:18px;background:#2d3f54;margin:0 2px;flex-shrink:0;}',
      '.tfb-mode-group{display:flex;gap:2px;background:#111827;border-radius:4px;padding:2px;}',
      '.tfb-mode-btn{padding:3px 8px;border:none;border-radius:3px;cursor:pointer;',
        'font-size:11px;background:transparent;color:#6b7280;white-space:nowrap;}',
      '.tfb-mode-btn:hover{color:#c8d8e8;}',
      '.tfb-mode-btn.active{background:#1e3a5f;color:#7cb4ff;font-weight:600;}',
      '.tfb-view-label{font-size:10px;color:#4b5563;margin-right:2px;white-space:nowrap;}',
      '.tfb-tool-btn{display:flex;align-items:center;gap:4px;padding:3px 8px;',
        'border:1px solid #2d3f54;border-radius:4px;cursor:pointer;',
        'font-size:11px;background:#1e2a38;color:#9ca3af;white-space:nowrap;}',
      '.tfb-tool-btn:hover{border-color:#4a9eff;color:#c8d8e8;}',
      '.tfb-tool-btn.active{background:#7c2d00;border-color:#fd7e14;color:#fd7e14;font-weight:600;}',
      '.tfb-stats{font-size:10px;color:#6b7280;margin-left:auto;white-space:nowrap;}',
      /* Dropdown panels */
      '.tfb-panel{position:absolute;z-index:200;top:36px;background:#1a2535;',
        'border:1px solid #2d3f54;border-radius:6px;padding:10px;',
        'min-width:200px;max-width:280px;box-shadow:0 4px 12px #00000066;}',
      '.tfb-panel-title{font-size:11px;font-weight:700;color:#7cb4ff;margin-bottom:8px;}',
      '.tfb-panel-row{display:flex;align-items:center;gap:6px;margin-bottom:4px;',
        'font-size:11px;color:#c8d8e8;cursor:pointer;}',
      '.tfb-panel-row:hover{color:#fff;}',
      '.tfb-swatch{width:10px;height:10px;border-radius:50%;flex-shrink:0;}',
      '.tfb-count{color:#4b5563;font-size:10px;margin-left:auto;}',
      '.tfb-panel-btns{display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;}',
      '.tfb-pbtn{padding:3px 8px;font-size:11px;border:1px solid #2d3f54;',
        'background:#1e2a38;color:#9ca3af;border-radius:3px;cursor:pointer;}',
      '.tfb-pbtn:hover{border-color:#4a9eff;color:#c8d8e8;}',
      '.tfb-pbtn.apply{background:#2563eb;color:#fff;border-color:#2563eb;}',
      '.tfb-pbtn.apply:hover{background:#1d4ed8;}',
      '.tfb-mode-row{display:flex;gap:4px;margin-bottom:8px;}',
      '.tfb-mrbtn{flex:1;text-align:center;padding:3px 4px;font-size:10px;',
        'border:1px solid #2d3f54;background:#1e2a38;color:#9ca3af;border-radius:3px;cursor:pointer;}',
      '.tfb-mrbtn.active{background:#2563eb;color:#fff;border-color:#2563eb;}',
      /* Type filter quick-buttons */
      '.tfb-type-quick{display:flex;gap:4px;margin-bottom:8px;}',
      '.tfb-type-quick-btn{flex:1;text-align:center;padding:3px;font-size:11px;',
        'border:1px solid #2d3f54;background:#1e2a38;color:#9ca3af;border-radius:3px;cursor:pointer;}',
      '.tfb-type-quick-btn:hover{border-color:#4a9eff;}',
      '.tfb-type-quick-btn.active{background:#2563eb;color:#fff;border-color:#2563eb;}',
      /* A-Groups tree */
      '.tfb-group-item{margin-bottom:3px;}',
      '.tfb-group-hdr{display:flex;align-items:center;gap:5px;cursor:pointer;',
        'font-size:11px;color:#c8d8e8;padding:2px 0;}',
      '.tfb-group-hdr:hover{color:#fff;}',
      '.tfb-group-toggle{color:#4b5563;font-size:10px;width:10px;}',
      '.tfb-group-nodes{margin-left:18px;display:none;}',
      '.tfb-group-nodes.open{display:block;}',
      '.tfb-group-node{font-size:10px;color:#6b7280;padding:1px 0;}',
    ].join('');
    var s = document.createElement('style');
    s.id = 'tfb-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ── Build toolbar HTML ────────────────────────────────────────────
  function _buildUI() {
    var container = document.getElementById(_containerId);
    if (!container) return;

    _injectCSS();
    container.innerHTML = '';

    var root = document.createElement('div');
    root.className = 'tfb-root';
    root.id = _uid + '-root';

    // ── Toolbar ────────────────────────────────────────────────────
    var bar = document.createElement('div');
    bar.className = 'tfb-toolbar';

    // View label + mode buttons
    var viewLabel = document.createElement('span');
    viewLabel.className = 'tfb-view-label';
    viewLabel.textContent = 'View:';
    bar.appendChild(viewLabel);

    var modeGroup = document.createElement('div');
    modeGroup.className = 'tfb-mode-group';
    [
      {mode:'asis',      label:'AS-IS'},
      {mode:'gateway',   label:'GATEWAY'},
      {mode:'enriched',  label:'ENRICHED'},
      {mode:'collapsing',label:'COLLAPSING ▼'},
    ].forEach(function (m) {
      var btn = document.createElement('button');
      btn.className = 'tfb-mode-btn' + (m.mode === _state.viewMode ? ' active' : '');
      btn.textContent = m.label;
      btn.dataset.mode = m.mode;
      btn.addEventListener('click', function () { _setViewMode(m.mode); });
      modeGroup.appendChild(btn);
    });
    bar.appendChild(modeGroup);

    // Separator
    var sep1 = document.createElement('div'); sep1.className = 'tfb-sep'; bar.appendChild(sep1);

    // Tool buttons
    var tools = [
      { key:'countries', icon:'🌍', label:'Countries' },
      { key:'type',      icon:'abc', label:'Net Type'  },
      { key:'groups',    icon:'📦', label:'A-Groups'  },
      { key:'unk',       icon:'⚠',  label:'UNK Filter'},
    ];
    tools.forEach(function (t) {
      var btn = document.createElement('button');
      btn.id = _uid + '-btn-' + t.key;
      btn.className = 'tfb-tool-btn';
      btn.innerHTML = t.icon + ' ' + t.label;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (t.key === 'unk') {
          _toggleUnkOnly();
        } else {
          _togglePanel(t.key);
        }
      });
      bar.appendChild(btn);
    });

    // Stats badge
    var stats = document.createElement('span');
    stats.id = _uid + '-stats';
    stats.className = 'tfb-stats';
    stats.textContent = (_rawNodes || []).length + '/' + (_rawNodes || []).length + ' nodes';
    bar.appendChild(stats);

    root.appendChild(bar);

    // ── Panels (absolutely positioned) ────────────────────────────
    root.appendChild(_buildCountriesPanel());
    root.appendChild(_buildTypePanel());
    root.appendChild(_buildGroupsPanel());

    container.appendChild(root);

    // Close panels on outside click
    document.addEventListener('click', function (e) {
      if (_openPanel && !root.contains(e.target)) _closeAllPanels();
    });

    _updateStats();
  }

  // ── Countries panel ───────────────────────────────────────────────
  function _buildCountriesPanel() {
    var countries = _getCountries(_rawNodes);
    var panel = document.createElement('div');
    panel.id = _uid + '-panel-countries';
    panel.className = 'tfb-panel';
    panel.style.display = 'none';
    panel.style.left = '0';

    var title = document.createElement('div');
    title.className = 'tfb-panel-title';
    title.textContent = '🌍 Country Filter';
    panel.appendChild(title);

    // Country list — checked = visible, unchecked = hidden
    if (!countries.length) {
      var noGw = document.createElement('div');
      noGw.style.cssText = 'font-size:11px;color:#6b7280;padding:4px 0;';
      noGw.textContent = 'No A-type gateways found';
      panel.appendChild(noGw);
    } else {
      var list = document.createElement('div');
      list.style.cssText = 'max-height:180px;overflow-y:auto;';
      countries.forEach(function (c) {
        var row = document.createElement('label');
        row.className = 'tfb-panel-row';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !_state.hiddenCountries.has(c.code);
        cb.dataset.country = c.code;
        cb.style.cssText = 'accent-color:#2563eb;cursor:pointer;';
        cb.addEventListener('change', function () {
          if (cb.checked) { _state.hiddenCountries.delete(c.code); }
          else            { _state.hiddenCountries.add(c.code); }
        });
        var swatch = document.createElement('span');
        swatch.className = 'tfb-swatch';
        swatch.style.background = _countryColor(c.code);
        var lbl = document.createElement('span');
        lbl.textContent = c.code;
        var cnt = document.createElement('span');
        cnt.className = 'tfb-count';
        cnt.textContent = c.count + ' nodes';
        row.appendChild(cb); row.appendChild(swatch); row.appendChild(lbl); row.appendChild(cnt);
        list.appendChild(row);
      });
      panel.appendChild(list);
    }

    // Buttons
    var btns = document.createElement('div');
    btns.className = 'tfb-panel-btns';
    var selAll = document.createElement('button');
    selAll.className = 'tfb-pbtn'; selAll.textContent = 'All';
    selAll.addEventListener('click', function () {
      _state.hiddenCountries.clear();
      panel.querySelectorAll('input[data-country]').forEach(function (cb) { cb.checked = true; });
    });
    var selNone = document.createElement('button');
    selNone.className = 'tfb-pbtn'; selNone.textContent = 'None';
    selNone.addEventListener('click', function () {
      countries.forEach(function (c) { _state.hiddenCountries.add(c.code); });
      panel.querySelectorAll('input[data-country]').forEach(function (cb) { cb.checked = false; });
    });
    var apply = document.createElement('button');
    apply.className = 'tfb-pbtn apply'; apply.textContent = '✓ Apply';
    apply.addEventListener('click', function () {
      _applyFilters();
      _updateBtnActive('countries', _state.hiddenCountries.size > 0);
      _closeAllPanels();
    });
    btns.appendChild(selAll); btns.appendChild(selNone); btns.appendChild(apply);
    panel.appendChild(btns);

    return panel;
  }

  // ── Net Type panel ────────────────────────────────────────────────
  function _buildTypePanel() {
    var panel = document.createElement('div');
    panel.id = _uid + '-panel-type';
    panel.className = 'tfb-panel';
    panel.style.display = 'none';
    panel.style.left = '100px';

    var title = document.createElement('div');
    title.className = 'tfb-panel-title';
    title.textContent = 'abc Net Type Filter';
    panel.appendChild(title);

    // Quick buttons
    var quick = document.createElement('div');
    quick.className = 'tfb-type-quick';
    var presets = [
      { label:'All', types:['A','B','C','UNK'] },
      { label:'A Only', types:['A'] },
      { label:'B Only', types:['B'] },
      { label:'C Only', types:['C'] },
    ];
    presets.forEach(function (p) {
      var b = document.createElement('div');
      b.className = 'tfb-type-quick-btn';
      b.textContent = p.label;
      b.addEventListener('click', function () {
        quick.querySelectorAll('.tfb-type-quick-btn').forEach(function(x){x.classList.remove('active');});
        b.classList.add('active');
        _state.activeTypes = new Set(p.types);
        // sync individual toggles
        panel.querySelectorAll('.tfb-type-toggle').forEach(function (cb) {
          cb.checked = _state.activeTypes.has(cb.dataset.type);
        });
        _applyFilters();
        _updateBtnActive('type', _state.activeTypes.size < 4);
      });
      quick.appendChild(b);
    });
    panel.appendChild(quick);

    // Individual type toggles
    var types = [
      {key:'A',   label:'A-type (Gateway)',         color:'#3b82f6'},
      {key:'B',   label:'B-type (Backbone/Transit)', color:'#8b5cf6'},
      {key:'C',   label:'C-type (IP/Leaf)',          color:'#6b7280'},
      {key:'UNK', label:'UNK (Unclassified)',        color:'#374151'},
    ];
    var counts = {};
    (_rawNodes || []).forEach(function (n) {
      var t = _classify(n);
      counts[t] = (counts[t] || 0) + 1;
    });

    types.forEach(function (t) {
      var row = document.createElement('label');
      row.className = 'tfb-panel-row';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'tfb-type-toggle';
      cb.dataset.type = t.key;
      cb.checked = _state.activeTypes.has(t.key);
      cb.style.cssText = 'accent-color:#2563eb;cursor:pointer;';
      cb.addEventListener('change', function () {
        if (cb.checked) { _state.activeTypes.add(t.key); }
        else { _state.activeTypes.delete(t.key); }
        _applyFilters();
        _updateBtnActive('type', _state.activeTypes.size < 4);
        // reset quick buttons active
        quick.querySelectorAll('.tfb-type-quick-btn').forEach(function(x){x.classList.remove('active');});
      });
      var swatch = document.createElement('span');
      swatch.className = 'tfb-swatch';
      swatch.style.background = t.color;
      var lbl = document.createElement('span');
      lbl.textContent = t.label;
      var cnt = document.createElement('span');
      cnt.className = 'tfb-count';
      cnt.textContent = (counts[t.key] || 0) + '';
      row.appendChild(cb); row.appendChild(swatch); row.appendChild(lbl); row.appendChild(cnt);
      panel.appendChild(row);
    });

    return panel;
  }

  // ── A-Groups panel ────────────────────────────────────────────────
  function _buildGroupsPanel() {
    var countries = _getCountries(_rawNodes);
    var panel = document.createElement('div');
    panel.id = _uid + '-panel-groups';
    panel.className = 'tfb-panel';
    panel.style.display = 'none';
    panel.style.left = '160px';

    var title = document.createElement('div');
    title.className = 'tfb-panel-title';
    title.textContent = '📦 A-Type Groups';
    panel.appendChild(title);

    if (!countries.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-size:11px;color:#6b7280;padding:4px 0;';
      empty.textContent = 'No A-type gateways found';
      panel.appendChild(empty);
      return panel;
    }

    // Build node list per country
    var byCountry = {};
    (_rawNodes || []).forEach(function (n) {
      var c = _countryOf(n);
      if (!c) return;
      if (!byCountry[c]) byCountry[c] = [];
      byCountry[c].push(n);
    });

    var tree = document.createElement('div');
    tree.style.cssText = 'max-height:220px;overflow-y:auto;';
    countries.forEach(function (c) {
      var nodes = byCountry[c.code] || [];
      var item = document.createElement('div');
      item.className = 'tfb-group-item';

      var hdr = document.createElement('div');
      hdr.className = 'tfb-group-hdr';

      var toggle = document.createElement('span');
      toggle.className = 'tfb-group-toggle';
      toggle.textContent = '▶';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !_state.groupsHidden.has(c.code);
      cb.style.cssText = 'accent-color:#2563eb;cursor:pointer;margin-right:2px;';
      cb.addEventListener('change', function (e) {
        e.stopPropagation();
        if (cb.checked) { _state.groupsHidden.delete(c.code); }
        else { _state.groupsHidden.add(c.code); }
        _applyFilters();
        _updateBtnActive('groups', _state.groupsHidden.size > 0);
      });

      var swatch = document.createElement('span');
      swatch.className = 'tfb-swatch';
      swatch.style.background = _countryColor(c.code);

      var lbl = document.createElement('span');
      lbl.textContent = c.code;
      lbl.style.fontWeight = '600';

      var cnt = document.createElement('span');
      cnt.className = 'tfb-count';
      cnt.textContent = c.count + '';

      hdr.appendChild(toggle);
      hdr.appendChild(cb);
      hdr.appendChild(swatch);
      hdr.appendChild(lbl);
      hdr.appendChild(cnt);

      // Node list (collapsed by default)
      var nodeList = document.createElement('div');
      nodeList.className = 'tfb-group-nodes';
      nodes.forEach(function (n) {
        var nd = document.createElement('div');
        nd.className = 'tfb-group-node';
        nd.textContent = '• ' + (n.label || String(n.id));
        nodeList.appendChild(nd);
      });

      hdr.addEventListener('click', function (e) {
        if (e.target === cb) return;
        var open = nodeList.classList.toggle('open');
        toggle.textContent = open ? '▼' : '▶';
      });

      item.appendChild(hdr);
      item.appendChild(nodeList);
      tree.appendChild(item);
    });
    panel.appendChild(tree);

    // Select / Deselect all
    var btns = document.createElement('div');
    btns.className = 'tfb-panel-btns';
    var allBtn = document.createElement('button');
    allBtn.className = 'tfb-pbtn'; allBtn.textContent = 'Show All';
    allBtn.addEventListener('click', function () {
      _state.groupsHidden.clear();
      tree.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.checked = true; });
      _applyFilters();
      _updateBtnActive('groups', false);
    });
    var noneBtn = document.createElement('button');
    noneBtn.className = 'tfb-pbtn'; noneBtn.textContent = 'Hide All';
    noneBtn.addEventListener('click', function () {
      countries.forEach(function (c) { _state.groupsHidden.add(c.code); });
      tree.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
      _applyFilters();
      _updateBtnActive('groups', true);
    });
    btns.appendChild(allBtn); btns.appendChild(noneBtn);
    panel.appendChild(btns);

    return panel;
  }

  // ── Panel open/close ──────────────────────────────────────────────
  function _togglePanel(key) {
    var panelId = _uid + '-panel-' + key;
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var isOpen = panel.style.display !== 'none';
    _closeAllPanels();
    if (!isOpen) {
      panel.style.display = '';
      _openPanel = key;
    }
  }

  function _closeAllPanels() {
    ['countries','type','groups'].forEach(function (k) {
      var p = document.getElementById(_uid + '-panel-' + k);
      if (p) p.style.display = 'none';
    });
    _openPanel = null;
  }

  // ── View mode ─────────────────────────────────────────────────────
  function _setViewMode(mode) {
    _state.viewMode = mode;
    var root = document.getElementById(_uid + '-root');
    if (root) {
      root.querySelectorAll('.tfb-mode-btn').forEach(function (b) {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
    }
    _applyFilters();
    if (mode === 'collapsing' && _network) {
      // Fit to visible A-type nodes only
      var visIds = (_rawNodes || []).filter(function (n) {
        return !_shouldHide(n);
      }).map(function (n) { return n.id; });
      if (visIds.length && _network.fit) {
        _network.fit({ nodes: visIds, animation: { duration: 600, easingFunction: 'easeInOutQuad' } });
      }
    } else if (mode === 'asis' || mode === 'enriched') {
      if (_network && _network.fit) {
        _network.fit({ animation: { duration: 600 } });
      }
    }
  }

  // ── UNK toggle ────────────────────────────────────────────────────
  function _toggleUnkOnly() {
    _state.unkOnly = !_state.unkOnly;
    _updateBtnActive('unk', _state.unkOnly);
    _applyFilters();
  }

  // ── Button active state ───────────────────────────────────────────
  function _updateBtnActive(key, active) {
    var btn = document.getElementById(_uid + '-btn-' + key);
    if (btn) btn.classList.toggle('active', !!active);
  }

  // ── Rebuild panels when topology reloads ─────────────────────────
  function _rebuildPanels() {
    var root = document.getElementById(_uid + '-root');
    if (!root) return;
    // Remove old panels
    ['countries','type','groups'].forEach(function (k) {
      var p = document.getElementById(_uid + '-panel-' + k);
      if (p) p.parentNode.removeChild(p);
    });
    // Rebuild
    root.appendChild(_buildCountriesPanel());
    root.appendChild(_buildTypePanel());
    root.appendChild(_buildGroupsPanel());
    _updateStats();
  }

  // ── Public API ────────────────────────────────────────────────────
  /**
   * refresh() — call after a new topology is loaded into rawNodes/rawEdges
   * and new vis.DataSets have been created.
   */
  self.refresh = function (newRawNodes, newRawEdges, newVNodes, newVEdges, newNetwork, newSecVN, newSecVE, newSecRaw) {
    _rawNodes  = newRawNodes  || [];
    _rawEdges  = newRawEdges  || [];
    _vNodes    = newVNodes    || _vNodes;
    _vEdges    = newVEdges    || _vEdges;
    if (newNetwork)  _network  = newNetwork;
    if (newSecVN)    _secVNodes = newSecVN;
    if (newSecVE)    _secVEdges = newSecVE;
    if (newSecRaw)   _secRaw    = newSecRaw;
    // Reset filter state to clean
    _state.hiddenCountries.clear();
    _state.groupsHidden.clear();
    _state.activeTypes = new Set(['A','B','C','UNK']);
    _state.unkOnly = false;
    _rebuildPanels();
    _applyFilters();
    // Reset button active states
    ['countries','type','groups','unk'].forEach(function(k){ _updateBtnActive(k, false); });
  };

  /**
   * apply() — re-apply current filter state to the (possibly updated) DataSets.
   * Call after any vis overlay operation that might have reset hidden flags.
   */
  self.apply = function () {
    _applyFilters();
  };

  /**
   * update() — update DataSet references (e.g. after _cpBuildVis rebuilds DataSets)
   */
  self.update = function (opts) {
    if (opts.vNodes)    _vNodes   = opts.vNodes;
    if (opts.vEdges)    _vEdges   = opts.vEdges;
    if (opts.rawNodes)  _rawNodes = opts.rawNodes;
    if (opts.rawEdges)  _rawEdges = opts.rawEdges;
    if (opts.network)   _network  = opts.network;
    _applyFilters();
  };

  /**
   * destroy() — remove the toolbar from DOM.
   */
  self.destroy = function () {
    var container = document.getElementById(_containerId);
    if (container) container.innerHTML = '';
    _closeAllPanels();
  };

  // ── Initialize ────────────────────────────────────────────────────
  _buildUI();
  _applyFilters();
}
