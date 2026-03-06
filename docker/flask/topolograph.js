/*
let edge_id = '10.10.10.1_to_10.10.10.2_123'
let edge1_from = '192.168.1.1'
let edge1_to = '192.168.1.2'
let edge1_cost = '10'
let data = [{'edge_from': '192.168.1.1', 'edge_to': '192.168.1.2', 'edge_cost': 10},
{'edge_from': '192.168.1.2', 'edge_to': '192.168.1.1', 'edge_cost': 1}]
*/
$(function() {

  $("div.PopUpFormBackupNonBackupNets").hide();
  $("div.PopUpFormNewOSPFCostSet").hide();
  $("div.PopUpFormUnsymmetricPaths").hide();
  $(".general_view_edge_menu").hide(100);
  $("a.close").click(function(e)
    {
        e.preventDefault();
        $(this).closest("div.PopUpFormBackupNonBackupNets").fadeToggle();
        // Clear content
        document.getElementById('backuped_num').innerHTML = '';
        document.getElementById('backuped_networks_id').innerHTML = '';
        document.getElementById('nonbackuped_networks_id').innerHTML = '';
        $('.PopUpFormBackupNonBackupNets').css({
          height: "300px"
        })
        $(this).closest("div.PopUpFormNewOSPFCostSet").fadeToggle();
        $(this).closest("div.PopUpFormUnsymmetricPaths").fadeToggle();
    });
  $('input:checkbox#assignHostToGroupBtn').click(function(e)
  {
    if (document.getElementById('assignHostToGroupBtn').checked) {
      assignHostToGroup();
    }
    else {
      resetHostGroupMembership();
    }
  });
  $('input:checkbox#hideLinkCostBtn').click(function(e)
  {
    if (document.getElementById('hideLinkCostBtn').checked) {
      ClearPaintedGraph();
    }
    else {
      mark_all_edges_for_dyn_filtering(conf={"labelFrom": "","labelTo": ""});
    }
  });
  $('input:checkbox#ckboxL1IsisLevel').click(function(e)
  {
    if (document.getElementById('ckboxL1IsisLevel').checked) {
      unhide_edges_by_edge_attribute(edge_attribute_name='isis_level', level_number=1);
      color_isis_edges_by_edge_attribute(edge_attribute_name='isis_level', edge_attribute_value=1);
    }
    else {
      hide_edges_by_edge_attribute(edge_attribute_name='isis_level', edge_attribute_value=1);
    }
  });
  $('input:checkbox#ckboxL2IsisLevel').click(function(e)
    {
      if (document.getElementById('ckboxL2IsisLevel').checked) {
        unhide_edges_by_edge_attribute(edge_attribute_name='isis_level', level_number=2);
        color_isis_edges_by_edge_attribute(edge_attribute_name='isis_level', edge_attribute_value=2);
      }
      else {
        hide_edges_by_edge_attribute(edge_attribute_name='isis_level', edge_attribute_value=2);
      }
    });
  $('input:checkbox#ckboxIsisNarrowEdge').click(function(e)
    {
      if (document.getElementById('ckboxIsisNarrowEdge').checked) {
        unhide_edges_by_edge_attribute(edge_attribute_name='isnarrow', level_number=true);
        color_isis_edges_by_edge_attribute(edge_attribute_name='isnarrow', edge_attribute_value=true);
      }
      else {
        hide_edges_by_edge_attribute(edge_attribute_name='isnarrow', edge_attribute_value=true);
      }
    });
  $('input:button#saveNodesPositionsBtn').click(function(e)
  {
    save_nodes_position();
  });
  $('select').change( function() {
    var value = $(this).val();
    var new_value = true;
    if (!document.querySelectorAll("input[name=choosen_vendor_device]:checked").length) {
      return
    }
    var choosen_vendor_name = document.querySelectorAll("input[name=choosen_vendor_device]:checked")[0].id; //Cisco, juniper Quagga or None
    console.log('choosen_vendor_name', choosen_vendor_name);
    if (value == 'add_from_file')
    {
      console.log(value);
      //document.getElementById("devinputGroupFile02").removeAttribute("hidden");
      document.getElementById("inputOSPFFileID").click();
      //document.getElementById("select_how_to_get_ospf_db").setAttribute("hidden", "hidden");
    }
  });
});

function elementExists(id) {
  return document.getElementById(id) !== null;
}

function do_load_diagram_btn() {
  var graph_time_options = document.getElementById("graph_time");
  if (!graph_time_options) {
    graph_time_options = document.getElementById("dynamic_graph_time");
  }
  // remember the time of diagram from what we loaded
  loaded_diagram_graph_time = graph_time_options.options[graph_time_options.selectedIndex].value;
  $.ajax({
      url: "/upload-yaml-diagram",
      type: "post",
      data: {"graph_time": loaded_diagram_graph_time},
      success:  function callbackFunc(response)
          {
          do_fill_yaml_text(response.yaml_file_str);
          _load_graph_from_yaml_diagram_page(loaded_diagram_graph_time);
          }
    })
}

function do_save_diagram_btn() {
  let yaml_str = document.getElementById("yamlTextAreaStr").value;
    $.ajax({
        url: "/upload-yaml-diagram",
        type: "post",
        data: {"yaml_str": yaml_str, "do_save": true},
        success:  function callbackFunc(response)
            {
            do_fill_yaml_text(response.yaml_file_str);
            _load_graph_from_yaml_diagram_page(response.graph_time);
            // delete old temp diagrams, when we pressed Show button
            delete_old_yaml_graph(all=true);
            }
    })
}

function do_show_diagram_button_btn() {
  let yaml_str = document.getElementById("yamlTextAreaStr").value;
    $.ajax({
        url: "/upload-yaml-diagram",
        type: "post",
        data: {"yaml_str": yaml_str, "loaded_from_diagram_graph_time": loaded_diagram_graph_time},
        success:  function callbackFunc(response)
          {
            do_fill_yaml_text(response.yaml_file_str);
            _load_graph_from_yaml_diagram_page(response.graph_time);
            //console.log(`${response.graph_time} with comparance ${loaded_diagram_graph_time}`);
            // delete old temp diagrams, when we pressed Show button
            delete_old_yaml_graph();
            if (response.error_code != '') {
              show_instant_notification(response.error_code, delay=10000, warning=true);
            }
          },
        error: function callbackFunc(response) {
              let err_response = response.responseJSON;
              show_instant_notification(err_response.error_code, delay=12500, warning=true);
          }
    })
}

function removeOldYamlTempGraphs() {
  /*
  remove only old Yaml graphs when Show graph button pressed
  */
  $.ajax({
      url: "/ospf_host_to_group_mapping",
      type: "post",
      data: {'graph_time': dynamic_graph_time, 'jsonify': true},
      success:  function callbackFunc(response)
            {
              color_host_by_group(response.host_to_group_id_map);
            }
          })
}

function resetHostGroupMembership() {
  let reseted_nodes_ll = [];
  var assigned_nodes_to_group_w_attr_ll = nodes.get({
    filter: function (item) {
      return (item.group);
    }
    });
  for (var n in assigned_nodes_to_group_w_attr_ll) {
    node_attr = assigned_nodes_to_group_w_attr_ll[n];
    node_attr.color = options.nodes.color;
    delete node_attr['group']
    reseted_nodes_ll.push(node_attr);
  }
  nodes.update(reseted_nodes_ll);
}
function assignHostToGroup() {
  /*
  assign assign group attribute
  */
  var graph_time_options = document.getElementById("dynamic_graph_time");
  var dynamic_graph_time = graph_time_options.options[graph_time_options.selectedIndex].value;
  $.ajax({
      url: "/ospf_host_to_group_mapping",
      type: "post",
      data: {'graph_time': dynamic_graph_time, 'jsonify': true},
      success:  function callbackFunc(response)
            {
              color_host_by_group(response.host_to_group_id_map);
            }
          })
}

function save_nodes_position() {
  /*
  save nodes locations
  */
  $.ajax({
    url: "/save_nodes_position",
    type: "post",
    data: {"graph_id": graph_id, "nodes_positions_json": JSON.stringify(network.getPositions())},
    success:  function callbackFunc(response)
            {
              show_instant_notification(response.msg, delay=2500);
            },
    error: function(xhr, status, error) {
      // Handle error responses (403 for permission denied, 404 for not found, etc.)
      var errorMsg = "Failed to save node positions";
      if (xhr.responseJSON && xhr.responseJSON.msg) {
        errorMsg = xhr.responseJSON.msg;
      } else if (xhr.status === 403) {
        errorMsg = "You do not have permission to modify this graph";
      } else if (xhr.status === 404) {
        errorMsg = "Graph not found or access denied";
      }
      show_instant_notification(errorMsg, delay=5000, warning=true);
    }
  })
}
/*
$(function() {

    $("div.PopUpFormBackupNonBackupNets").hide();
    //$(".edge_id").text(edge_id);
		// fill the table 
    $.each(data,function(i,item){
      $("#location tbody").append(
          "<tr>"
              +"<td>"+item.edge_from+"</td>"
              +"<td>"+item.edge_to+"</td>"
              +"<td>"+item.edge_cost+"</td>"
              +"<td>"+`<input type='text' class='row_input' name='answer1' id=$item.edge_from class='answer'>`+"</td>"
          +"</tr>" )
    })
    $("a.toggle").click(function(e)
    {
        e.preventDefault();
        var $test = $(this).attr('href');        
        $( $test ).siblings("div.PopUpFormBackupNonBackupNets").fadeOut();
        $( $test ).fadeToggle();
    });

    $("a.close").click(function(e)
    {
        e.preventDefault();
        $(this).closest("div.PopUpFormBackupNonBackupNets").fadeToggle();        
    });

});
*/
function js_delete_selected_host_groups() {
  var array = []
  var checkboxes = document.querySelectorAll('tbody input[type=checkbox]:checked')
  for (var i = 0; i < checkboxes.length; i++) {
    array.push(checkboxes[i].value)
  }
  $.ajax({
    url: "/delete_selected_host_groups",
    type: "post",
    data: {'selected_host_groups_ll_json': JSON.stringify(array)}
  })
}

function bind(ip, gr_id)
    {
    var grset_id = document.getElementById('groupset_'+gr_id);
    var host_ip = document.getElementById('ip_'+ip);
    var g_id_matched = document.getElementById('slct_'+ip).value;
    $.ajax({
        url: "/save_single_host_group_mapping",
      type: "post",
      data: {'groupset_id': grset_id['value'], "host_id": host_ip['value'], 'group_id': g_id_matched}
    })
  }

function bind_master_vrf(ip, gr_id)
  {
  var grset_id = document.getElementById('groupset_'+gr_id);
  var host_ip = document.getElementById('ip_'+ip);
  var _select_options = document.getElementById('slct_master_'+ip);
  let master_device_id = _select_options.options[_select_options.selectedIndex].value;
  $.ajax({
      url: "/save_single_host_group_mapping",
    type: "post",
    data: {'groupset_id': grset_id['value'], "host_id": host_ip['value'], 'master_device_id': master_device_id}
  })
}


  function NetworkReactionOnFailureClick (event) {

    let pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure
    
    if (pressed_button == 'GeneralView') {
      $(GeneralView).button('toggle');
      ResetGraph_and_Variables();
    }
    $(NetworkReactionOnFailure).button('toggle');
    print_element_descriptions_NetworkReaction();
  }

  function do_save_graph_scale (gravitationalConstant = -10000, springLength = 150) {
    /*
    In order to change properties of VIS graph, for dense or sparse topologies
    */
    let pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure
    
    if (pressed_button == 'GeneralView' || pressed_button == 'NetworkReactionOnFailure')
    {
      // the graph has been uploaded, we can change Scale
      let phy_scale_settings = {physics:{barnesHut:{gravitationalConstant: gravitationalConstant, springLength: springLength}}};
      network.setOptions(phy_scale_settings);
      // save these settings for future use
      $.ajax({
        url: "/save_graph_physics_scale",
        type: "post",
        data: {"graph_id": graph_id, "graph_physics_scale_settings_json": JSON.stringify(phy_scale_settings)}
      })
    }
    else {
      $.ajax(alert("Please upload a Graph in order to change Scale"));
    }
  }
  function GeneralView2Click (event) {
    let pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure

    if (pressed_button == 'NetworkReactionOnFailure') {
      $(NetworkReactionOnFailure).button('toggle');
      ResetGraph_and_Variables();
    }
    $(GeneralView).button('toggle');
    print_element_descriptions_GeneralView();
    }



function add_auth_source_api_net() {
  auth_source_api_net = document.getElementById('auth_source_api_net').value;
  $.ajax({
      url: "/add-auth-source-api-net",
      type: "post",
      data: {'auth_source_api_net': auth_source_api_net},
      success:  function callbackFunc(response)
          {

          update_source_net_table(response.auth_source_api_net_ll);
          show_instant_notification(response.msg);
          }
          })
}


function delete_auth_source_ip_net(source_net) {
  $.ajax({
      url: "/delete-auth-source-ip-net",
      type: "post",
      data: {'source_net': source_net},
      success:  function callbackFunc(response)
          {

          update_source_net_table(response.auth_source_api_net_ll);

          }
          })
}

function update_hostname_on_graph() {
  /*
  copy hostnames of routers from user input to igraph. Host_to_dns_name_mapping pages
  */
  let _select_options = document.getElementById("select_graph_time_id");
  let choosen_graph_time = _select_options && _select_options.options[_select_options.selectedIndex]
    ? _select_options.options[_select_options.selectedIndex].value
    : '';
  if (!choosen_graph_time) {
    return $.Deferred().reject('no_graph_time').promise();
  }
  // paint a button from yellow to grey
  let update_hostname_on_graph_btn = document.getElementById('update_hostname_on_graph');
  return $.ajax({
      url: "/update_hostname_on_graph",
      type: "post",
      data: {'choosen_graph_time': choosen_graph_time},
      success:  function callbackFunc(response)
            {
              if (update_hostname_on_graph_btn) {
                update_hostname_on_graph_btn.className = "btn btn-secondary btn-lg btn-block";
              }
            }
          })
}

function save_hostname(_ip, _graph_id) {
  let inputEl = document.getElementById(`comment_${_ip}`);
  let _hostname = arguments.length >= 3 ? String(arguments[2] || '').trim() : (inputEl ? inputEl.value : '');
  let update_hostname_on_graph_btn = document.getElementById('update_hostname_on_graph');
  if (update_hostname_on_graph_btn) {
    update_hostname_on_graph_btn.className = "btn btn-warning btn-lg btn-block";
  }
  return $.ajax({
      url: "/save_hostname",
      type: "post",
      data: {'ip': _ip, 'hostname': _hostname, 'graph_id': _graph_id}
          })
}

function _setHostCsvImportStatus(msg, color) {
  let status = document.getElementById('hostCsvImportStatus');
  if (status) {
    status.innerHTML = '<span style="color:' + (color || '#6c757d') + ';">' + msg + '</span>';
  }
}

function _parseHostnameImportText(csvText) {
  let idToHostname = {};
  let lines = String(csvText || '').trim().split(/\r?\n/).filter(function(line) { return line.trim(); });
  for (let i = 0; i < lines.length; i++) {
    let rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('#')) continue;
    let cols = rawLine.indexOf(',') >= 0
      ? rawLine.split(',').map(function(c) { return c.trim(); })
      : rawLine.split(/\s+/, 2).map(function(c) { return c.trim(); });
    if (cols.length < 2) continue;
    let c0 = (cols[0] || '').trim();
    let c1 = (cols[1] || '').trim();
    let c2 = (cols[2] || '').trim();
    let c0l = c0.toLowerCase();
    let c1l = c1.toLowerCase();
    if (c0l === 'router_id' || c0l === 'device_ip_address' || c0l === 'hostname_prefix' ||
        c0l === 'hostname' || c0l === 'id' || c1l === 'hostname' || c1l === 'device_name' || c1l === 'country') {
      continue;
    }
    if (_looksLikeIpv4(c0) && c1) {
      idToHostname[c0] = c1;
    } else if (c2 && _looksLikeIpv4(c1)) {
      idToHostname[c1] = c2;
    }
  }
  return idToHostname;
}

function import_hostname_csv_file(inputEl) {
  let file = inputEl && inputEl.files ? inputEl.files[0] : null;
  if (!file) return;
  let reader = new FileReader();
  _setHostCsvImportStatus('Reading ' + file.name + '…', '#6c757d');
  reader.onload = function(e) {
    _importHostnameCsvText(e.target.result, file.name);
  };
  reader.readAsText(file);
}

function _importHostnameCsvText(csvText, filename) {
  let idToHostname = _parseHostnameImportText(csvText);
  let routerIds = Object.keys(idToHostname);
  if (!routerIds.length) {
    _setHostCsvImportStatus('No hostname mappings found in ' + filename + '.', '#dc3545');
    return;
  }
  let requests = [];
  let matched = 0;
  let updated = 0;
  routerIds.forEach(function(routerId) {
    let inputEl = document.getElementById(`comment_${routerId}`);
    if (!inputEl) return;
    matched++;
    let hostname = String(idToHostname[routerId] || '').trim();
    let graphId = inputEl.getAttribute('data-graph-id') || '';
    if (!hostname || !graphId) return;
    if (String(inputEl.value || '').trim() !== hostname) {
      inputEl.value = hostname;
      updated++;
    }
    requests.push(save_hostname(routerId, graphId, hostname));
  });
  if (!matched) {
    _setHostCsvImportStatus('No routers from ' + filename + ' matched the selected graph.', '#dc3545');
    return;
  }
  _setHostCsvImportStatus('Saving ' + matched + ' hostname mappings from ' + filename + '…', '#6c757d');
  let persistence = requests.length ? $.when.apply($, requests) : $.Deferred().resolve().promise();
  persistence.always(function() {
    _setHostCsvImportStatus('Saved ' + matched + ' hostname mappings from ' + filename + '. Syncing graph…', '#17a2b8');
    let syncRequest = update_hostname_on_graph();
    if (syncRequest && typeof syncRequest.always === 'function') {
      syncRequest.always(function() {
        _setHostCsvImportStatus('✅ Imported ' + filename + ': ' + matched + ' matched, ' + updated + ' updated, graph sync requested.', '#28a745');
      });
    } else {
      _setHostCsvImportStatus('✅ Imported ' + filename + ': ' + matched + ' matched, ' + updated + ' updated.', '#28a745');
    }
  });
}

function update_source_net_table(all_auth_source_net_ll) {
  document.getElementById("allAuthorisedIpAddressRange").innerHTML = "";
  var t = "";
  for (var i = 0; i < all_auth_source_net_ll.length; i++){
      let tr = "<tr>";
      tr += `<td class="source_net_row_table">`+ all_auth_source_net_ll[i] +"</td>";
      tr += `<td class="source_net_row_table"><input type="submit" value="Delete" onclick="delete_auth_source_ip_net('` + all_auth_source_net_ll[i] + `')" class="btn btn-primary"></td>`;
      tr += "</tr>";
      t += tr;
  }
  document.getElementById("allAuthorisedIpAddressRange").innerHTML = t;
}


function set_date_on_datetime_picker(datepicker_id, date_obj) {
  const formattedDateValue = $.datepicker.formatDate('yy-mm-dd', date_obj) + ' ' +
                           ('0' + date_obj.getHours()).slice(-2) + ':' +
                           ('0' + date_obj.getMinutes()).slice(-2);
  $(datepicker_id).val(formattedDateValue);
}

function set_min_date_on_datetime_picker(datepicker_id, date_obj) {
  $(datepicker_id).datetimepicker('option', {
    minDate: date_obj,
    minDateTime: date_obj
  });
}

function upload_network_heatmap() {
  // upload graph
  upload_ospf_lsdb(with_heatmap=true);
}

function upload_ospf_lsdb(with_heatmap = false, for_ospfwatcher = false, dynamic_graph_time='') {
  // get selected value from dropdown menu
  var selectElement = document.getElementById("dynamic_graph_time");
  if (dynamic_graph_time=='') {
    var dynamic_graph_time = selectElement.options[selectElement.selectedIndex].value;
  }
  else {
    var dynamic_graph_time = dynamic_graph_time;
    if (selectElement) {
      const matchingOption = Array.from(selectElement.options).find(
        opt => opt.value === dynamic_graph_time
      );
      if (matchingOption) {
        matchingOption.selected = true;
      }
    }
  }
  // clear previous graphs
  if (typeof edges !== 'undefined')
    {
      ResetGraph_and_Variables(for_ospfwatcher = for_ospfwatcher);
    }
  // revert back out StopStart Physics button
  if (document.getElementById('btnStopPhysics') !== null) {
    //document.getElementById('btnStopPhysicsImg').src = "/static/stop_button.png";
    document.getElementById('btnStopPhysics').innerHTML = '<img src=\'/static/stop_button.png\'/>Freeze network';
  }

  //update a link with graph_time of DesignMode pointed to yaml-diagram
  if (document.getElementById('DesignMode') !== null) {
    document.getElementById('DesignMode').setAttribute('onclick', `location.href="/yaml-diagram?graph_time=${dynamic_graph_time}"`)
  }
  $.ajax({
      url: "/upload-ospf-lsdb-from-js",
      type: "post",
      data: {'dynamic_graph_time': dynamic_graph_time, 'with_heatmap': with_heatmap, 'for_ospfwatcher': for_ospfwatcher},
      success:  function callbackFunc(response)
          {
          
          graph_id = response.graph_id;
          // set value to global variable
          nodes_attr_dd_in_ll = response.nodes_attr_dd_in_ll;
          edges_attr_dd_in_ll = response.edges_attr_dd_in_ll;
          let graph_physics_scale_settings = JSON.parse(response.graph_physics_scale_settings_dd_json);
          init_visjs_graph(response.nodes_attr_dd_in_ll, response.edges_attr_dd_in_ll, graph_physics_scale_settings);
          // ── Country filter: apply colours & build panel after graph settles ──
          setTimeout(function() {
            var finalizeGraphLoad = function(appliedServerSync) {
              if (!appliedServerSync && typeof _reapplySavedHostnameMapping === 'function') { _reapplySavedHostnameMapping(); }
              if (typeof applyCountryColors === 'function') { applyCountryColors(); }
              if (typeof buildCountryFilterPanel === 'function') { buildCountryFilterPanel(); }
              if (typeof _buildUnkPanel === 'function') { _buildUnkPanel(); }       // EN-F4
              if (typeof _resetCollapseState === 'function') { _resetCollapseState(); }
              if (typeof buildViewModeButtons === 'function') { buildViewModeButtons(); }
            };
            if (typeof _syncHostnameMappingsFromServer === 'function') {
              _syncHostnameMappingsFromServer(dynamic_graph_time).then(finalizeGraphLoad, function() { finalizeGraphLoad(false); });
            } else {
              finalizeGraphLoad(false);
            }
          }, 900);
          // mark General View as pressed button
          let pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure
          // we mark button pressed if only button has not been marked as pressed
          if (!pressed_button | pressed_button.length == 0 && !for_ospfwatcher) {
            load_graph_buttonOnClick();
            }
          stub_nets_attr_dd_ll = response.stub_nets_attr_dd_ll; // [{'10.10.10.0': '1.1.1.1'}, {}] network: ospf_rid
          nodeNameToNodeRidMap = response.nodeNameToNodeRidMap;
          if (!for_ospfwatcher) {
            show_spt_dropdown_menu(); // Focus/From ... To
            print_element_descriptions_GeneralView(with_heatmap);
            
            if (response.isIsIs) {
              document.getElementById('ckboxL1IsisLevelLabel').innerHTML = `L1 (${response.l1_edges_num} edges)`;
              document.getElementById('ckboxL2IsisLevelLabel').innerHTML = `L2 (${response.l2_edges_num} edges)`;
              const is_l1_active_btn = document.getElementById('ckboxL1IsisLevel');
              if (is_l1_active_btn !== null && response.l1_edges_num == 0) {is_l1_active_btn.setAttribute('disabled', true);}
              const is_l2_active_btn = document.getElementById('ckboxL2IsisLevel');
              if (is_l2_active_btn !== null && response.l2_edges_num == 0) { is_l2_active_btn.setAttribute('disabled', true);}
              // Narrow
              const narrow_edge_btn = document.getElementById('ckboxIsisNarrowEdge');
              if (narrow_edge_btn !== null && response.edge_narrow_num != 0) {
                document.getElementById('ckboxIsisNarrowEdgeLabel').innerHTML = `Narrow (${response.edge_narrow_num} edges)`;
                show('IsisNarrowEdgeDiv');
              }

              show('L1IsisLevelDiv');
              show('L2IsisLevelDiv');
            } else { // after isis load OSPF and ISIS buttons left
              document.querySelectorAll('div.input-group.PopUpCommonFormHideLinkCostSaveNodesPositions').forEach(function(element) { element.style.display = 'none'; }); 
            }
            show('networkFullScreenDiv');
            show('messagepop4'); // Groups
            show('hideLinkCostDevId');
            mark_checked('hideLinkCostBtn'); // when pres Load new graph, but this button is set unchecked
            show('saveNodesPositionsDiv');

            add_radio_button_listener(); //Once we unchecked `Print Minimum Shortest Tree (MST) for the node` we should clear all radion buttons
          }
          if (for_ospfwatcher){
            if (response.isIsIs) {
              const is_l1_active_btn = document.getElementById('is_l1_active');
              if (is_l1_active_btn !== null) {is_l1_active_btn.removeAttribute('disabled');is_l1_active_btn.setAttribute('checked', '');}
              const is_l2_active_btn = document.getElementById('is_l2_active');
              if (is_l2_active_btn !== null) { is_l2_active_btn.removeAttribute('disabled');is_l2_active_btn.setAttribute('checked', '');}
            }
            // fill time to datetimepicker on Monitoring page
            const startDateStr = response.start_time_iso; // "2022-12-11T08:38:00"
            // const startDate = new Date(startDateStr);
            const startDate = new Date(getLocalTimeFromUTC(startDateStr));
            // Example: update datetimepicker with new minDateTime
            set_min_date_on_datetime_picker(datepicker_id='#StartLogTime', date_obj=startDate)
            set_date_on_datetime_picker(datepicker_id='#StartLogTime', date_obj=startDate)

            const endDateStr = response.end_time_iso; // "2022-12-11T08:38:00"
            // const endDate = new Date(endDateStr);
            const endDate = new Date(getLocalTimeFromUTC(endDateStr));
            set_date_on_datetime_picker(datepicker_id='#EndLogTime', date_obj=endDate)

            upload_monitoring_stat();
          }
          return graph_id;
          },
          error: function(jqXHR, textStatus, errorThrown) {
            show_instant_notification("An error occurred while building the graph. Please contact the administrator using the details provided in the Links tab.", delay=10000, warning=true);
          }
          })
}

function delete_ospf_lsdb() {
  // get selected value from dropdown menu
  var graph_time_options = document.getElementById("dynamic_graph_time");

  var dynamic_graph_time = graph_time_options.options[graph_time_options.selectedIndex].value;

  $.ajax({
      url: "/delete-ospf-lsdb",
      type: "post",
      data: {'dynamic_graph_time': dynamic_graph_time},
      success:  function callbackFunc(response)
          {
            //$.ajax(alert(`Graph ${dynamic_graph_time} has been removed from DB. Please refresh page.`));
            // reload page
            document.location.reload(true);
          }
          })
}

function delete_old_yaml_graph(all=false) {

  $.ajax({
      url: "/delete-old-yaml-diagram",
      type: "post",
      data: {"all": all},
    })
}

function get_term_node_id_by_network(network) {
  $.ajax({
      url: "/get_term_node_id_by_network",
      type: "post",
      async: false, // wait answer before continue
      data: {'network': network, 'graph_id': graph_id},
      success:  function callbackFunc(response)
          {
            return response.node_id;
          }
          })
}

// #####################
function get_edge_from_spt_outcome(graph_id, src_node, dst_node, spt_src_node, spt_dst_node, selected_edge_id)
  {
    /*
    when we under General View, built a SPT and press on the edge along SPT. We show backup path of such edge
    */
  if (src_node && dst_node) {
    var removed_edges_ll = [src_node, dst_node];
    removed_links_from_spt_path_ll_in_ll.push([src_node, dst_node]);
    removed_edge_id_from_spt_path_ll_in_ll.push(selected_edge_id);
  }

  $.ajax({
      url: "/get_edge_from_spt_remove_outcome_new",
    type: "post",
    data: {'graph_id': graph_id, "src_node": spt_src_node, "dst_node": spt_dst_node, 
    "removed_links_from_spt_path_ll_in_ll_json": JSON.stringify(removed_links_from_spt_path_ll_in_ll), 
    "removed_edge_id_from_spt_path_ll_in_ll_json": JSON.stringify(removed_edge_id_from_spt_path_ll_in_ll),
    "changed_edge_cost_dd_json": JSON.stringify(changed_edge_cost_dd)
  },
      success:  function callbackFunc(response)
        {
        /*
        node_dd_in_ll = node_dd_in_ll,
        unbackup_paths_nodes_name_as_ll_in_ll = unbackup_paths_nodes_name_as_ll_in_ll,
        to_unflat_ecmp_edges_id_ll = to_unflat_ecmp_edges_id_ll,
        cost_and_spt_path_node_names_ll_in_ll = cost_and_spt_path_node_names_ll_in_ll,
        unused_cost_and_spt_path_ll_ll = unused_cost_and_spt_path_ll_ll,
        used_cost_and_spt_path_ll_ll = used_cost_and_spt_path_ll_ll,
        cost_and_backup_paths_node_names_ll_in_ll = cost_and_backup_paths_node_names_ll_in_ll
        */
        unflat_ecmp(response.to_unflat_ecmp_edges_id_ll);
        remove_unnumbered_edge(response.node_dd_in_ll, response.to_unflat_ecmp_edges_id_ll); // remove 1.1.1.1_2.2.2.2, because in SPT path we use 1.1.1.1_2.2.2.2_88 where 88 is edge id in igraph
        paint_js_edges_node_order_is_matter(response.node_dd_in_ll, {'width': 8, color: {color:'#0073e6', opacity: 0.7, hover: '#1a8cff'}, 'comment': 'backup_path_edge', 'spt_src_node': spt_src_node, 'spt_dst_node': spt_dst_node}, paint_over_existed=true);
        // 0073e6 - dark blue

        // we mark edge as deleted if edge is a part of SPT. If we under OSPF edge cost planning and select non SPT colored link in order to change ospf cost - we mark it as deleted. It's not a true
        if (selected_edge_id) {
          mark_edge_as_deleted(selected_edge_id);}

        // clear old description about SPT paths
        add_spt_description(Array(), clear=true);
        // clear old description
        add_backup_path_description(Array(), clear=true);
        add_spt_description(response.used_cost_and_spt_path_ll_ll, not_used=false, clear=false, backup_path_from_spt_path=true);
        add_spt_description(response.unused_cost_and_spt_path_ll_ll, not_used=true, clear=false);
        add_backup_path_description(response.cost_and_backup_paths_node_names_ll_in_ll);
        }
  })
}
function mark_edge_as_deleted(selected_edge_id) {
    /*
    selected_edge_attr:
    arrows: {from: true, to: false}
    color: {color: "#1a8cff", opacity: 0.7, hover: "#1a8cff"}
    comment: "spt_path_edge"
    from: "123.10.10.10"
    id: "123.10.10.10_to_123.30.30.30_38"
    new_edge: false
    parent_edge_id: "123.10.10.10_to_123.30.30.30"
    spt_dst_node: "123.10.10.10"
    spt_src_node: "123.123.31.31"
    title: "<p>123.10.10.10-<b>1</b>->123.30.30.30</p><p>123.30.30.30-<b>10</b>->123.10.10.10</p>"
    to: "123.30.30.30"
    width: 8
    */
    var arr = [];
    var deleted_edge_color_dd = {'width': 3, color: {color: '#ff0000', opacity: 0.7, highlight:'#ff0000', hover: '#ff0000'}, 'dashes': true, 'comment': 'deleted_spt_path_edge'};
    // ff0000 - red
    var edge_attr_from_graph = edges.get(selected_edge_id);
    if (edge_attr_from_graph) {
      Object.assign(edge_attr_from_graph, deleted_edge_color_dd);
      edge_attr_from_graph.parent_edge_id = selected_edge_id;
      arr.push(edge_attr_from_graph);
    data.edges.update(arr);
    }
  }

function mark_edges_id_as_deleted(edge_id_ll) {
    /*
    edge_id_ll = ["123.14.14.14_to_123.123.111.111", "123.14.14.14_to_123.123.110.110"]
    */
    var arr = [];
    var deleted_edge_color_dd = {'width': 3, color: {color: '#ff0000', opacity: 0.7, highlight:'#ff0000', hover: '#ff0000'}, 'dashes': true, 'comment': 'deleted_edge'};
    // ff0000 - red

    for (var n in edge_id_ll) {
      var edge_id = edge_id_ll[n];
      // console.log('we are going to remove', edge_id);
      var edge_attr_from_graph = edges.get(edge_id);
      if (edge_attr_from_graph) {
        edge_attr_from_graph.parent_edge_id = edge_attr_from_graph.id;
        // console.log('Yes, we remove it', edge_attr_from_graph);
        Object.assign(edge_attr_from_graph, deleted_edge_color_dd);
        arr.push(edge_attr_from_graph);
      }
 
    data.edges.update(arr);
    }
  }

function accept_node_for_spt_return_spt() {
    let pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure

    /*
    If we accept a node for SPT there are several options:
    If just only `Print Minimum Shortest Tree (MST) for the node` is enabled - we change the behaviour from right clicked menu:
      if you choose get SPT from node - we print all SPT paths from this node
      the same logic with TO this node

      if `Print Minimum Shortest Tree (MST) for the node` and IN or From radio button is choosed - we will print MST if just we hover over node
    */
    if ((spt_src_node && !spt_dst_node) && (document.getElementById("do_print_MST").checked === true)) {
      mst_node_id = spt_src_node;
      accept_node_for_mst_return_mst(direction = 'OUT');
      spt_src_node = false;
      mst_node_id = false;
      return
    }
    if ((!spt_src_node && spt_dst_node) && (document.getElementById("do_print_MST").checked === true)) {
      mst_node_id = spt_dst_node;
      accept_node_for_mst_return_mst(direction = 'IN');
      spt_dst_node = false;
      mst_node_id = false;
      return
    }
    if ((spt_src_node && spt_dst_node) && (spt_src_node != spt_dst_node) && (pressed_button == "GeneralView")) {
      $.ajax({
          url: "/get_spt_path",
	        type: "post",
	        data: {'graph_id': graph_id, "src_node": spt_src_node, "dst_node": spt_dst_node, "changed_edge_cost_dd_json": JSON.stringify(changed_edge_cost_dd)},
            success:  function callbackFunc(response){
            
            // if we changed some edges - it's better to clear graph from network reaction arrows and then paint SPT paths
            if (changed_edge_cost_dd) {
              ClearPaintedGraph();
            }
            unflat_ecmp(response.to_unflat_ecmp_edges_id_ll);

            remove_unnumbered_edge(response.node_dd_in_ll, response.to_unflat_ecmp_edges_id_ll); // remove 1.1.1.1_2.2.2.2, because in SPT path we use 1.1.1.1_2.2.2.2_88 where 88 is edge id in igraph
            //paint_js_edges_node_order_is_matter(response.node_dd_in_ll, {'width': 8, color: {color:'#1a8cff', opacity: 0.7, hover: '#1a8cff'}, 'comment': 'updown_traffic_node', 'spt_src_node': spt_src_node, 'spt_dst_node': spt_dst_node});
            //change comment

            paint_js_edges_node_order_is_matter(response.node_dd_in_ll, {'width': 8, color: {color:'#1a8cff', opacity: 0.7, hover: '#1a8cff'}, 'comment': 'spt_path_edge', 'spt_src_node': spt_src_node, 'spt_dst_node': spt_dst_node});
            // 3399ff - blue
            //change comment
            //paint_js_edges_node_order_is_matter(response.unbackup_paths_nodes_name_as_ll_in_ll, {'width': 4, color: {color: '#ff0000', opacity: 0.7, hover: '#ff0000'}, 'comment': 'updown_traffic_node', title: 'unbackuped edge'}, paint_over_existed=true, rewrite_color=true);
            paint_js_edges_node_order_is_matter(response.unbackup_paths_nodes_name_as_ll_in_ll, {'width': 4, color: {color: '#ff0000', opacity: 0.7, hover: '#ff0000'}, 'comment': 'spt_path_edge', title: 'unbackuped edge'}, paint_over_existed=false, rewrite_color=true);
            // ff0000 - red

            spt_src_node = false;
            spt_dst_node = false;

            // add notion that you can press colored link
            add_spt_warning_description();
            add_spt_description(response.cost_and_spt_path_node_names_ll_in_ll);
            // we focus on src node and want to fit the network with normal size
            network.fit();
          }
      });
    }
    if ((spt_src_node && spt_dst_node) && (spt_src_node != spt_dst_node) && (pressed_button == "NetworkReactionOnFailure")) {
      $.ajax(alert("Please select General View for building SPT"))
    }
  }


function accept_node_for_mst_return_mst(direction = 'IN') {
    let pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure

    if ((mst_node_id) && (pressed_button == "GeneralView") && (document.getElementById("do_print_MST").checked === true)) {

      // make fog only number of edges is high doesn't work. it's annoying to make topology as in the fog and clear
      // document.getElementById('mynetwork').style.opacity = 0.2; // make topology in the fog

      $.ajax({
          url: "/get_mst_path",
	        type: "post",
	        data: {'graph_id': graph_id, "mst_node_id": mst_node_id, "all_paths_direction": direction},
            success:  function callbackFunc(response){
            
            unflat_ecmp(response.to_unflat_ecmp_edges_id_ll);

            remove_unnumbered_edge(response.node_dd_in_ll, response.to_unflat_ecmp_edges_id_ll); // remove 1.1.1.1_2.2.2.2, because in SPT path we use 1.1.1.1_2.2.2.2_88 where 88 is edge id in igraph
            //paint_js_edges_node_order_is_matter(response.node_dd_in_ll, {'width': 8, color: {color:'#1a8cff', opacity: 0.7, hover: '#1a8cff'}, 'comment': 'updown_traffic_node', 'spt_src_node': spt_src_node, 'spt_dst_node': spt_dst_node});
            //change comment
            paint_js_edges_node_order_is_matter(response.node_dd_in_ll, {'width': 8, color: {color:'#1a8cff', opacity: 0.7, hover: '#1a8cff'}, 'comment': 'spt_path_edge', 'spt_src_node': spt_src_node, 'spt_dst_node': spt_dst_node});
            // 3399ff - blue
            //change comment

            mst_node_id = false;
          }
      });
    }
    if ((mst_node_id) && (pressed_button == "NetworkReactionOnFailure")) {
      $.ajax(alert("Please select General View for building MST"))
    }
}

function accept_node_for_MstInOutDiff_return_diff() {
  let pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure

  if ((mst_node_id) && (pressed_button == "GeneralView") && (document.getElementById("do_print_MST").checked === true)) {
    
    // make fog only number of edges is high doesn't work. it's annoying to make topology as in the fog and clear
    // document.getElementById('mynetwork').style.opacity = 0.2; // make topology in the fog

    $.ajax({
        url: "/get_unsym_paths",
        type: "post",
        data: {'graph_id': graph_id, "mst_node_name": mst_node_id},
          success:  function callbackFunc(response){

          //unflat_ecmp(response.to_unflat_ecmp_edges_id_ll); we add new edge and do not mark ecmp's edge
          if (response.node_dd_in_ll.length + response.node_dd_out_ll.length == 0) {
            $.ajax(alert("Graph doesn't have unsymmetric paths"))
          }
          remove_unnumbered_edge(response.node_dd_in_ll, response.to_unflat_ecmp_edges_id_ll); // remove 1.1.1.1_2.2.2.2, because in SPT path we use 1.1.1.1_2.2.2.2_88 where 88 is edge id in igraph
          remove_unnumbered_edge(response.node_dd_out_ll, response.to_unflat_ecmp_edges_id_ll); // remove 1.1.1.1_2.2.2.2, because in SPT path we use 1.1.1.1_2.2.2.2_88 where 88 is edge id in igraph
          //change comment
          paint_js_edges_node_order_is_matter(response.node_dd_in_ll);
          paint_js_edges_node_order_is_matter(response.node_dd_out_ll);

          // 3399ff - blue
          //change comment

          mst_node_id = false;
        }
    });
  }
  if ((mst_node_id) && (pressed_button == "NetworkReactionOnFailure")) {
    $.ajax(alert("Please select General View for building MST"))
  }
}

function accept_node_for_node_failure_prediction() {
    //var pressed_button = document.querySelectorAll("input[name=options]:checked")[0].id; //Genereal View, Network reaction or Diff Graph
    let pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure

    
    if (pressed_button == "NetworkReactionOnFailure") {
      $.ajax({
          url: "/get_node_id_for_network_reaction",
	        type: "post",
	        data: {'graph_id': graph_id, "node_shutdown_choosed_node_name": node_shutdown_choosed_node_name},
            success:  function callbackFunc(response){
            
            unflat_ecmp(response.to_unflat_ecmp_edges_id_ll);

            remove_unnumbered_edge(response.down_all_edge_attr_dd_in_ll, response.to_unflat_ecmp_edges_id_ll); // remove 1.1.1.1_2.2.2.2, because in SPT path we use 1.1.1.1_2.2.2.2_88 where 88 is edge id in igraph

            remove_unnumbered_edge(response.up_all_edge_attr_dd_in_ll, response.to_unflat_ecmp_edges_id_ll); // remove 1.1.1.1_2.2.2.2, because in SPT path we use 1.1.1.1_2.2.2.2_88 where 88 is edge id in igraph
            if (!response.down_all_edge_attr_dd_in_ll.length && !response.up_all_edge_attr_dd_in_ll.length && !response.down_traffic_nodes_name_ll.length && !response.up_traffic_nodes_name_ll.length)
              {
                show('node_failure_prediction_description'); // change display settings in order to see text
                // as tests are showed that no difference between betweenneess if we remove edge Node from the Graph
                document.getElementById('node_failure_prediction_description').innerHTML = 'It seems that you shutdown border node';
              }
            else 
              {
                paint_network_reaction_results(response.down_all_edge_attr_dd_in_ll, response.up_all_edge_attr_dd_in_ll, response.down_traffic_nodes_name_ll, response.up_traffic_nodes_name_ll);
              }
            // request all edges, even after unflatting ECMP and mark them deleted
            var connected_edges = network.getConnectedEdges(node_shutdown_choosed_node_name);
            mark_edges_id_as_deleted(connected_edges);
            // for painting deleted edges
            var connected_js_edges_id = Array();
            if (connected_edges)
            {
              for (var n in connected_edges) 
                {
                  connected_js_edges_id.push(connected_edges[n]);
                }
            }
            removed_js_edge_ids_ll.push(...connected_js_edges_id); // for painting deleted edges
            if (response.edges_id_w_min_cost_ll)
            {
              removed_edge_ids_ll.push(...response.edges_id_w_min_cost_ll); // for backend calculation
            }

            node_shutdown_choosed_node_name = false;

            // add description about unbackuped/ backuped networks

          }
      })
  }
}

function get_central_nodes() {
  var graph_time_options = document.getElementById("dynamic_graph_time");
  var graph_time = graph_time_options.options[graph_time_options.selectedIndex].value;
  $.ajax({
    url: "/get_central_nodes",
    type: "post",
    data: {'graph_time': graph_time},
    success:  function callbackFunc(response)
        {
          central_node_names_ll = response._1_central_node_names_ll;
          color_nodes(response._1_central_node_names_ll, {size: 30, color: '#ff0000', 'comment': '_1_central_node'}); // ff0000 - red
        }
    })
}


function get_the_most_loaded_graph_elements() {
  var graph_time_options = document.getElementById("dynamic_graph_time");
  var graph_time = graph_time_options.options[graph_time_options.selectedIndex].value;

  let the_most_loaded_nodes_options = document.getElementById("most_loaded_nodes_slct_id");
  let the_most_loaded_nodes_number = the_most_loaded_nodes_options.options[the_most_loaded_nodes_options.selectedIndex].value;

  let colloringMap = {1: {size: 30, color: '#ff0000', 'comment': 'most_loaded_node'},
                      2: {size: 30, color: '#ff7700', 'comment': 'most_loaded_node'}, 
                      3: {size: 30, color: '#ffa200', 'comment': 'most_loaded_node'}, 
                      4: {size: 30, color: '#ffd000', 'comment': 'most_loaded_node'}, 
                      5: {size: 30, color: '#c8ff00', 'comment': 'most_loaded_node'}, 
  }
  // #ff7700 red-orange
  // #ffa200 light orange
  // #ffd000 yellow
  // #c8ff00 light green
    $.ajax({
        url: "/get_the_most_loaded_graph_elements",
        type: "post",
        data: {"graph_time": graph_time, "the_most_loaded_nodes_number": the_most_loaded_nodes_number, "node_shutdown_choosed_node_name": node_shutdown_choosed_node_name},
        success:  function callbackFunc(response)
          {
            for (const [top_i, node_names_ll] of Object.entries(response.topNumToGraphElementIdsllMap)) {
              color_nodes(node_names_ll, colloringMap[top_i]);
            }
          }
    })
}

function get_the_most_loaded_edges() {
  var graph_time_options = document.getElementById("dynamic_graph_time");
  var graph_time = graph_time_options.options[graph_time_options.selectedIndex].value;

  let the_most_loaded_edges_options = document.getElementById("most_loaded_edges_slct_id");
  let the_most_loaded_edges_number = the_most_loaded_edges_options.options[the_most_loaded_edges_options.selectedIndex].value;

  let colloringMap = {1: {width: 10, color: {color: '#ff0000'}, 'comment': 'most_loaded_edge'},
                      2: {width: 8, color: {color: '#ff7700'}, 'comment': 'most_loaded_edge'}, 
                      3: {width: 6, color: {color: '#ffa200'}, 'comment': 'most_loaded_edge'}, 
                      4: {width: 4, color: {color: '#ffd000'}, 'comment': 'most_loaded_edge'}, 
                      5: {width: 2, color: {color: '#c8ff00'}, 'comment': 'most_loaded_edge'}, 
  }
  // #ff7700 red-orange
  // #ffa200 light orange
  // #ffd000 yellow
  // #c8ff00 light green
    $.ajax({
        url: "/get_the_most_loaded_graph_elements",
        type: "post",
        data: {"graph_time": graph_time, "the_most_loaded_edges_number": the_most_loaded_edges_number},
        success:  function callbackFunc(response)
          {
            for (const [top_i, edge_attr_dd_in_ll] of Object.entries(response.topNumToGraphElementIdsllMap)) {
              paint_js_edges_node_order_is_matter(edge_attr_dd_in_ll, colloringMap[top_i], paint_over_existed=true, rewrite_color=true) // logic of rewrite color is reverted!:()
            }
          }
    })
}

function get_single_point_of_failure_node_ll() {
  var graph_time_options = document.getElementById("dynamic_graph_time");
  var graph_time = graph_time_options.options[graph_time_options.selectedIndex].value;
  $.ajax({
    url: "/get_single_point_of_failure_node_ll",
    type: "post",
    data: {'graph_time': graph_time},
    success:  function callbackFunc(response)
        {
          single_point_of_failure_node_name_ll = response.single_point_of_failure_node_name_ll;
          if (single_point_of_failure_node_name_ll.length > 0) {
            color_nodes(response.single_point_of_failure_node_name_ll, {size: 30, color: '#ff0000'}); // ff0000 - red
          } else {
            show_instant_notification("Network is fault tolerant", delay=12500);
          }
          color_nodes(response.fault_tolerant_node_name_ll, {size: 10, color: '#00ea27'}); // #00ea27 - green
        }
    })
}

function get_fault_tolerant_node_ll() {
  var graph_time_options = document.getElementById("dynamic_graph_time");
  var graph_time = graph_time_options.options[graph_time_options.selectedIndex].value;
  $.ajax({
    url: "/get_fault_tolerant_node_ll",
    type: "post",
    data: {'graph_time': graph_time},
    success:  function callbackFunc(response)
        {
          fault_tolerant_node_name_ll = response.fault_tolerant_node_name_ll;
          if (fault_tolerant_node_name_ll.length > 0) {
            color_nodes(response.fault_tolerant_node_name_ll, {size: 10, color: '#00ea27'}); // #00ea27 - green
          } else {
            show_instant_notification("Network is not fault tolerant", delay=12500);
          }
        }
    })
}

function add_spt_warning_description(clear=false){
    if (clear) {
      document.getElementById('spt_path_warning').innerHTML = '';
      hide('spt_path_warning');
    }
    else {
      warning_message_str = document.getElementById('spt_path_warning').innerHTML;
      // we add warning message only once, when string is empty
      if (!warning_message_str) {
        document.getElementById('spt_path_warning').innerHTML += '<ins>Press on colored link in order to simulate link outage</ins>. Note, there is a limit on graph size for ECMP calculation, check doc to increase it.'}
        show('spt_path_warning'); // change display settings in order to see text
    }
  }
  function hide(id){
    /* set style display option in order to hide empty rows*/
    elem_obj = document.getElementById(id)
    if (elem_obj !== null) {
      elem_obj.style.display = "none";}
  }
  function show(id){
    /* set style display option in order to hide empty rows*/
    elem_obj = document.getElementById(id)
    if (elem_obj !== null) {
      elem_obj.style.display = "";}
  }
  function mark_checked(id){
    /* set checked == true for input type checkbox*/
    elem_obj = document.getElementById(id)
    if (elem_obj !== null) {
      elem_obj.checked = true;}
  }
  function add_spt_description(cost_and_spt_ll_ll, not_used=false, clear=true, backup_path_from_spt_path=false){
    /*
    cost_and_spt_ll_ll = [[40, [1,2,3]], [40, [1,4,3]]]
    */
    if (clear) {
      elem_obj = document.getElementById('spt_path_description')
      if (elem_obj !== null) {
        elem_obj.innerHTML = "";
        hide('spt_path_description');
      }
    }
    show('spt_path_description'); // change display settings in order to see text
    for (var n in cost_and_spt_ll_ll) {
      var cost_and_path_ll = cost_and_spt_ll_ll[n];
      if (!not_used) 
        {
          if (!backup_path_from_spt_path) {
            var _color = "#3399ff";
          } else {
            var _color = darken_new_color;
          }
          document.getElementById('spt_path_description').innerHTML += `<p style="color:${_color};">The shortest path cost: <b>` + JSON.stringify(cost_and_path_ll[0], null, 4) + '</b> path: '+JSON.stringify(cost_and_path_ll[1].toString(), null, 4) + '</p>';
        }
      else {
        document.getElementById('spt_path_description').innerHTML += '<p><del>The shortest path cost: <b>' + JSON.stringify(cost_and_path_ll[0], null, 4) + '</b> path: '+JSON.stringify(cost_and_path_ll[1].toString(), null, 4) + '</del></p>';
      }
    }
  }

function add_backup_path_description(cost_and_backup_path_ll_ll, not_used=false, clear=true){
    /*
    cost_and_backup_path_ll_ll = [[40, [1,2,3]], [40, [1,4,3]]]
    */
    elem_obj = document.getElementById('backup_path_description');
    if (clear) {
      if (elem_obj !== null) {
        elem_obj.innerHTML = '';
        hide('backup_path_description');
      }
    }
    if (elem_obj !== null) {
      show('backup_path_description'); // change display settings in order to see text
    }
    for (var n in cost_and_backup_path_ll_ll) {
      var cost_and_path_ll = cost_and_backup_path_ll_ll[n];
      if (!not_used) 
        {
          document.getElementById('backup_path_description').innerHTML += `<p style="color:${darken_new_color};">Backup path cost: <b>` + JSON.stringify(cost_and_path_ll[0], null, 4) + '</b> path: '+JSON.stringify(cost_and_path_ll[1].toString(), null, 4) + '</p>';
        }
      else {
        document.getElementById('backup_path_description').innerHTML += '<p><del>Backup path cost: <b>' + JSON.stringify(cost_and_path_ll[0], null, 4) + '</b> path: '+JSON.stringify(cost_and_path_ll[1].toString(), null, 4) + '</del></p>';
      }
    }
  }

function LightenColor(color, percent) {
    var num = parseInt(color.replace("#",""),16),
    amt = Math.round(2.55 * percent),
    R = (num >> 16) + amt,
    B = (num >> 8 & 0x00FF) + amt,
    G = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (B<255?B<1?0:B:255)*0x100 + (G<255?G<1?0:G:255)).toString(16).slice(1);
};


function paint_js_edges_node_order_is_matter(edge_attr_dd_in_ll, config, paint_over_existed = false, rewrite_color=false){
    /*
    edge_attr_dd_in_ll = [{'from': '10.2.2.10', 'to': '10.50.50.8', 'id': '', 'uni_bi_directed': 'bidirected', 'edge_spt_stat': 'bw old:12.0 new:24.0, rate:0.50'}, {}]
    */
    var arr = [];
    var new_edges_arr = [];
    for (var n in edge_attr_dd_in_ll) {
      var edge_attr = edge_attr_dd_in_ll[n];
      var smooth_attr = {enabled:true, type: 'curvedCW', roundness: 0.2};
      //console.log('before color changing edge, config', edge_attr, config);
      Object.assign(edge_attr, config); //config has style of edge, edge_attr has attrubutes for building edge in the graph

      var edge_attr_from_graph = edges.get(edge_attr.id);
      var parent_edge_attr_from_graph = edges.get(edge_attr.parent_edge_id);


      // in case when we delete unnumbered edges `1.1.1.1_to_1.1.1.2` and change it by `1.1.1.1_to_1.1.1.2_99` and set parent_edge_id to `1.1.1.1_to_1.1.1.2`
      // if we find edges with parent_edge_id like new edge has parent_edge_id - so we should make curve 
      // Case - down_edge_attr - grey, up_edge_attr - blue over one link
      
      let is_there_painted_edge = edges.get({
        filter: function (item) {
          return (item.parent_edge_id == edge_attr.parent_edge_id);
        }
      });
      if (is_there_painted_edge.length > 0){
        // when we delete unnumbered edges - we get null in edge_attr_from_graph
        if (edge_attr_from_graph !== null) {
          if (edge_attr_from_graph.id != edge_attr.id) {
            edge_attr.new_edge = true; 
          }
        }
        else {
          edge_attr.new_edge = true; 
        }
      }
      if (parent_edge_attr_from_graph && typeof parent_edge_attr_from_graph.title !== 'undefined'){
        // PARENT EDGE HAS ALREADY PAINTED
        //console.log('found PARENT EDGE HAS ALREADY PAINTED');
        smooth_attr.roundness += 0.1;
        }
      
      //else {console.log('PARENT EDGE HAS NOT PAINTED')};
      
      // Title update If edge already has a title - we add new info to it. If not - assign
      if (edge_attr_from_graph && typeof edge_attr_from_graph.title !== 'undefined') {
        if (typeof edge_attr.title !== 'undefined') {
          // existed edge and new config has a title
          // console.log('Title update, existed, old title', edge_attr.title, edge_attr_from_graph.title);
          edge_attr.title += edge_attr_from_graph.title}
        }
      //console.log('Title', edge_attr.title)

      if (edge_attr_from_graph && edge_attr_from_graph.comment) {
        // add new edge or not, paint new edge or existed edge
        let old_color = edge_attr_from_graph.color.color;
        if (!paint_over_existed)
          {
          edge_attr.new_edge = true; 
          edge_attr.id += n.toString();
          }
        if (!rewrite_color)
          {
          darken_new_color = LightenColor(old_color, -30);
          edge_attr.color.color = darken_new_color;
          }
        }
      if (edge_attr.new_edge == true) {  
        // we need to add new edge
        edge_attr.smooth = smooth_attr;
        new_edges_arr.push(edge_attr);
        if (parent_edge_attr_from_graph) {
          parent_edge_attr_from_graph.has_already_painted = true;
          data.edges.update(parent_edge_attr_from_graph);}
        }
      else {
        //console.log('update this edge', edge_attr); 
        arr.push(edge_attr);
        }
    }
    //console.log('arr, new_edges_arr', arr, new_edges_arr);
    data.edges.add(new_edges_arr);
    data.edges.update(arr);
}

function get_right_edge(node_ids_ll, edge_dataset, config) {
    var arr = [];
    var new_edges_arr = [];
    for (var n in node_ids_ll) {
      var has_already_painted_edge_str_order = false;
      var has_already_painted_edge_back_order = false;
      var has_already_painted_edge = false;

      var edge_id = edge_dataset.get({
        //stright order
          filter: function (item) {
            return (item.from == node_ids_ll[n][0] && item.to == node_ids_ll[n][1]);
          }
        });
        /*
        from: "123.15.15.15"
        id: "123.15.15.15_to_123.123.111.111"
        title: "<p>123.123.111.111-<b>10</b>->123.15.15.15</p><p>123.15.15.15-<b>10</b>->123.123.111.111</p>"
        to: "123.123.111.111"
        weight: 10
        width: 1
        */
      if (edge_id.length == 0) {
        // we didn't find the edge ID with required from Node ID TO node id
        var edge_id = edge_dataset.get({
          //reverse order
            filter: function (item) {
              return (item.to == node_ids_ll[n][0] && item.from == node_ids_ll[n][1]);
            }
          });

        var has_already_painted_edge_back_order = (edge_dataset.get(edge_id[0].id).comment === undefined) ? false: true;
        }
        //if (!has_already_painted_edge_back_order) {config.arrows = { from: true }}
      else {
        //stright order. we found Edge ID with the same corelation of src and dst node
        var has_already_painted_edge_str_order = (edge_dataset.get(edge_id[0].id).comment === undefined) ? false: true;};
        //if (!has_already_painted_edge_back_order) {config.arrows = {to: true}} // we edit current edge if it hasn't been edit before
      edge_id = edge_id[0].id;
      // if from A to B traffic dicrease, but from B to A increase. Then we add new edge
      var has_already_painted_edge = (edge_dataset.get(edge_id).comment === undefined) ? false: true;
      //console.log('has_already_painted_edge ', has_already_painted_edge);
      if (has_already_painted_edge) {

        new_edge_id = edge_id + String(n)
        var new_edge_conf = {};
        Object.assign(new_edge_conf, config);
        new_edge_conf.id = new_edge_id;
        new_edge_conf.smooth = {enabled:true, type: 'curvedCW', roundness: 0.2};
        new_edge_conf.parent_edge_id = edge_id[0].id;
        //data.edges.add({'id': new_edge_id, })
        //config.background = { enabled: true, color: 'rgba(111,111,111,0.5)', size:20, dashes: [20,10] };
        //config.smooth = {"enabled": true};
        /* it doesn't need to do it
        if (has_already_painted_edge_str_order)
        {new_edge_conf.from = node_ids_ll[n][0]; new_edge_conf.to = node_ids_ll[n][1];
          new_edge_conf.arrows = {to: true};
        console.log('update edge config stright order: ', new_edge_conf)}
        else {
          new_edge_conf.to = node_ids_ll[n][0];
          new_edge_conf.from = node_ids_ll[n][1];
          new_edge_conf.arrows = { from: true };
          console.log('update edge config reverse order: ', new_edge_conf)};
        */
        new_edges_arr.push(new_edge_conf)
        //data.edges.add(new_edge_conf);
      };
      // add if only we checked that thre is no any comment on the edges
      if (!has_already_painted_edge){
      var obj = {};
      Object.assign(obj, config);
      obj.id = edge_id;
      arr.push(obj);}
    }

    data.edges.update(arr);
    data.edges.add(new_edges_arr);
  }

function remove_unnumbered_edge(node_dd_in_ll, ecmp_unflat_edge_id_ll) {
    // This function remove edge with ID 1.1.1.1_2.2.2.2 in order to replace it with ordered edge 1.1.1.1_2.2.2.2_88 88 is edge id from igraph

    /*
    ecmp_unflat_edge_id_ll: "123.10.10.10_to_123.123.100.100"
    */
    var arr = [];
    for (var n in node_dd_in_ll) {
      //console.log("node_dd_in_ll edge", node_dd_in_ll[n]);
      unnumbered_edge_attr_from_graph = edges.get(node_dd_in_ll[n].parent_edge_id);
      if (!ecmp_unflat_edge_id_ll.includes(node_dd_in_ll[n].parent_edge_id)) {
        // once we delete edge from the graph - we copy Title from this edge to the new one
        // Title = "<p>123.123.101.101-<b>10</b>->123.13.13.13</p><p>123.13.13.13-<b>10</b>->123.123.101.101</p>"
        // if `title` attribute exists and it's not equal to Null
        if (unnumbered_edge_attr_from_graph && unnumbered_edge_attr_from_graph.title && typeof unnumbered_edge_attr_from_graph.title !== 'undefined') {
        //if (unnumbered_edge_attr_from_graph && unnumbered_edge_attr_from_graph.title && unnumbered_edge_attr_from_graph.title !== undefined) {
          let title = unnumbered_edge_attr_from_graph.title;
          // if we already have title - update it. If not - attach
          if (node_dd_in_ll[n].title) {
            node_dd_in_ll[n].title += title;
          }
          else {
            node_dd_in_ll[n].title = title;
          }
        }
        /*
        NEW SPT edge
        arrows: {from: true, to: false}
        color: {color: "#1a8cff", opacity: 0.7, hover: "#1a8cff"}
        comment: "updown_traffic_node"
        from: "123.30.30.30"
        id: "123.30.30.30_to_123.123.31.31_51"
        new_edge: false
        parent_edge_id: "123.30.30.30_to_123.123.31.31"
        spt_dst_node: "123.10.10.10"
        spt_src_node: "123.123.31.31"
        to: "123.123.31.31"
        width: 8
        */
        if (unnumbered_edge_attr_from_graph) {
          edges.remove(unnumbered_edge_attr_from_graph.id);
        }
      }
    }
  }

function unflat_ecmp(edge_id_ll) {
    /*
    ["123.10.10.10_to_123.123.100.100"]
    */
    var arr = [];
    for (var n in edge_id_ll) {
      ecmp_single_line_edge_id = edges.get(edge_id_ll[n])
      if (ecmp_single_line_edge_id && ecmp_single_line_edge_id.inside_ecmp_edges_ll) {
        /*
        added edges: []
        arrows: {from: false, to: true}
        from: "123.10.10.10"
        id: "123.10.10.10_to_123.123.100.100_0"
        label: "15"
        title: "<p>123.10.10.10-<b>15</b>->123.123.100.100</p>123.10.10.10_to_123.123.100.100_0"
        to: "123.123.100.100"
        weight: 15
        width: 1
        */
        data.edges.remove(ecmp_single_line_edge_id.id);
        //edges.add(e.inside_ecmp_edges_ll);
        for (var m in ecmp_single_line_edge_id.inside_ecmp_edges_ll) {
          var obj = {smooth: {enabled:true, type: 'curvedCW', roundness: 0.1*m}, 'ecmp_parent_edge_id': ecmp_single_line_edge_id.id}; //ecmp_parent_edge_id is used for getting edge_id in NetworkReactionOnFailure in ECMP
          Object.assign(obj, ecmp_single_line_edge_id.inside_ecmp_edges_ll[m]);
          arr.push(obj);
        }
      }
    }
    data.edges.add(arr);
  }

function reset_up_edge_stype(edge_dataset) {
    var arr = [];
    var default_edge_attr = options.edges;
    var ids = edge_dataset.get({
        filter: function (item) {
          return (item.comment == 'updown_traffic_node');
        }
      });
    for (var n in ids) {
      //console.log('n: ', n, ids[n]);
      edge_id = ids[n].id;
      var obj = {};
      Object.assign(obj, default_edge_attr);
      obj.id = edge_id;
      arr.push(obj);
    }
    data.edges.update(arr);
  }

function color_host_by_group(host_to_group_id_map) {
  var arr = [];

  for (const [host_id, group_id_str] of Object.entries(host_to_group_id_map)){
    var existing_node_attr = nodes.get(host_id);

    Object.assign(existing_node_attr, {'group': group_id_str});
    //obj.id = existing_node_attr.id;
    arr.push(existing_node_attr);
  }
  nodes.update(arr);
}

function color_nodes(node_id_ll, conf) {
    var arr = [];

    for (var n in node_id_ll) {
      //var node_id = node_ids_ll[n].id;
      var existing_node_attr = nodes.get(node_id_ll[n]);
      if (existing_node_attr !== null) {
        if (existing_node_attr.hasOwnProperty("x") && existing_node_attr["x"] == null) {
          delete existing_node_attr["x"]
        }
        if (existing_node_attr.hasOwnProperty("y") && existing_node_attr["y"] == null) {
          delete existing_node_attr["x"]
        }
        //var obj = {};
        //var existing_node_attr = {};
        //var newColor = '#' + Math.floor((Math.random() * 255 * 255 * 255)).toString(16);
        //var conf = {color: {background: newColor}};
        Object.assign(existing_node_attr, conf);
        //obj.id = existing_node_attr.id;
        arr.push(existing_node_attr);
      }
    }
    nodes.update(arr);
  }

function reset_color_nodes(node_id_ll) {
  /*
  Reset only node's Color and Size
  */
  var arr = [];

  for (var n in node_id_ll) {
    //var node_id = node_ids_ll[n].id;
    var existing_node_attr = nodes.get(node_id_ll[n]);

    existing_node_attr.color = options.nodes.color;
    existing_node_attr.size = options.nodes.size;
    //obj.id = existing_node_attr.id;
    arr.push(existing_node_attr);
  }
  nodes.update(arr);
}

function get_edge_cost(graph_id, src_node, dst_node, edge_dataset, node_dataset)
        {
        $.ajax({
            url: "/get_edge_remove_outcome",
	        type: "post",
	        data: {'graph_id': graph_id, "src_node": src_node, "dst_node": dst_node},
            success:  function callbackFunc(response)
  {
      //updateEdgesForIds(response.up_traffic_node_ids_tuple_in_ll, {'width': 10, color: 'blue'});
      get_right_edge(response.up_traffic_node_ids_tuple_in_ll, edge_dataset, {'width': 10, color: '#3399ff', 'comment': 'updown_traffic_node'});
      // 3399ff - blue
      get_right_edge(response.down_traffic_node_ids_tuple_in_ll, edge_dataset, {'width': 10, color: '#808080', 'comment': 'updown_traffic_node'});
      // 808080 - grey
      get_right_edge([[src_node, dst_node]], edge_dataset, {color: '#ff0000', 'dashes': true, 'comment': 'updown_traffic_node'});
      // ff0000 - red
      color_nodes(response.down_traffic_nodes_name_ll, {color: '#808080'});
      // 808080 - grey
  }
        })
	}

  function get_edge_details(graph_id, edge_id)
    {
      $.ajax({
          url: "/get_edge_details",
        type: "post",
        data: {'graph_id': graph_id, "edge_id": edge_id},
          // success:  function callbackFunc(response)
          // {
          //   console.log(response);
          // },
          error: function(XMLHttpRequest, textStatus, errorThrown) {
            //textStatus = error
            //errorThrown = NOT FOUND
          console.log(`${errorThrown}, ${XMLHttpRequest.responseText}`)
        }
      })
    }

  function get_edge_details_by_igraph_edge_id(js_edge_attr, choosed_js_edge_attr = false)
    {
      let igraph_edges_id_ll = js_edge_attr.igraph_edges_id_ll;

      if (choosed_js_edge_attr.comment == "spt_path_edge" || choosed_js_edge_attr.comment == 'backup_path_edge') {
          spt_src_node_ospf_plan = choosed_js_edge_attr.spt_src_node; // global variables
          spt_dst_node_ospf_plan = choosed_js_edge_attr.spt_dst_node; // global variables
      }

      else {
        // okay, it's not a link along SPT path, but probably we pressed on general link ider GeneralView with have already built SPT path
        is_any_spt_path_edges_dd_ll = edges.get({
          filter: function (item) {
            return (item.comment == "spt_path_edge");
          }
        });
        if (is_any_spt_path_edges_dd_ll.length > 0) {
          // we found SPT path - so we can take any edge attr and get spt_src_node and spt_dst_node
          edge_attr_along_spt = is_any_spt_path_edges_dd_ll[0];
          spt_src_node_ospf_plan = edge_attr_along_spt.spt_src_node; // global variables
          spt_dst_node_ospf_plan = edge_attr_along_spt.spt_dst_node; // global variables
        }
      }

      // inside ecmp links - igraph_edges_id_ll is an integer
      $.ajax({
          url: "/get_edge_details_by_igraph_edge_id",
        type: "post",
        data: {'graph_id': graph_id, "igraph_edges_id_ll": JSON.stringify(igraph_edges_id_ll)},
          success:  function callbackFunc(response)
          {
            // response edge_attr_dd_ll: [{'from': '10.10.10.1', 'to': '10.10.10.2', 'weight': 1000, 'igraph_edge_id': 3}]
            $("#old_new_edge_cost_table_id tbody").text('') // clear table
            $.each(response.edge_attr_dd_ll,function(i,item){
              /* in case when we have already changes ospf cost on a link - and get directed colored link. Then we right-clicked on this edge once again and get '1.1.1.1_1.1.1.2_123' edge_id
              So in order to get all igraph edges IDs - we recover this info from edge_attr, but edge_attr keeps only original ospf cost (you remember we changed one of them and save it in changed_edge_cost_dd dictionary). 
              That's why we should get actual (what we changed earlier) cost
              */
              let _edge_ospf_cost = changed_edge_cost_dd[item.igraph_edge_id]; // is there we changed cost on this edge?
              if (typeof _edge_ospf_cost == 'undefined') {
                // if no - use that what used in edge attr
                _edge_ospf_cost = item.weight;
              } 
              $("#old_new_edge_cost_table_id tbody").append(
                  "<tr>"
                      +`<td id=node_from_${item.igraph_edge_id}>`+item.from+"</td>"
                      +`<td id=node_to_${item.igraph_edge_id}>`+item.to+"</td>"
                      +`<td id=old_${item.igraph_edge_id}>`+_edge_ospf_cost+"</td>"
                      +"<td>"+`<input type='text' class='row_input' id=${item.igraph_edge_id} oninput="get_network_reaction_on_ospf_edge_plan(${item.igraph_edge_id}, '${js_edge_attr.id}')" name='answer1' class='answer'>`+"</td>"
                  +"</tr>" )
            })
          }
      })
    }
    function isNumeric(num){
      return !isNaN(num)
    }
    function get_network_reaction_on_ospf_edge_plan(edge_id_w_new_weight, js_edge_id) {
      // receive an input with new OSPF edge cost. Should recalculate OSPF once again
      let new_ospf_edge_weight = document.getElementById(edge_id_w_new_weight).value;

      let src_node = document.getElementById(`node_from_${edge_id_w_new_weight}`).innerText;
      let dst_node = document.getElementById(`node_to_${edge_id_w_new_weight}`).innerText;
      // conver to int.
      let new_ospf_cost = parseInt(new_ospf_edge_weight, 10);
      // check new ospf link weight with original one. if they are equal - remove this edge as `changed`
      //original_weight = parseInt(changed_js_edge_cost_dd[js_edge_id]['original_js_edge_weight'], 10);
      // original_weight = changed_js_edge_cost_dd.hasOwnProperty(js_edge_id) ? parseInt(changed_js_edge_cost_dd[js_edge_id]['original_js_edge_weight']) : -1;
      let _original_weight = document.getElementById(`old_${edge_id_w_new_weight}`).innerText;
      let original_weight = changed_js_edge_cost_dd.hasOwnProperty(js_edge_id) ? changed_js_edge_cost_dd[js_edge_id]['original_js_edge_weight'] : parseInt(_original_weight, 10) ;
      if (isNumeric(new_ospf_cost) && new_ospf_cost > 0) {

        if (new_ospf_cost== original_weight) {
          delete changed_edge_cost_dd[edge_id_w_new_weight];
          delete changed_js_edge_cost_dd[js_edge_id];
        }
        else {
          // Save changed ospf cost. fill the dict with all changed edges. {10: 1}, 10 - igraph edge id, 1 ospf weight
          changed_edge_cost_dd[edge_id_w_new_weight] = new_ospf_cost;
          
          if (js_edge_id in changed_js_edge_cost_dd) {
            // 10.1.1.1_to_10.1.1.2: {'js_edge_new_weight': 1}
            changed_js_edge_cost_dd[js_edge_id]['js_edge_new_weight'] = new_ospf_cost;
          }
          else {
            // this edge is changing first time, so save original ospf cost
            /*
            from: "10.0.0.7"
            id: "10.0.0.7_to_10.2.2.10"
            igraph_edges_id_ll: (2) [0, 3]
            title: "<p>10.0.0.7-<b>1000</b>->10.2.2.10</p><p>10.2.2.10-<b>1000</b>->10.0.0.7</p>"
            to: "10.2.2.10"
            weight: 1000
            width: 1
            */
            ////original_weight = edges.get(js_edge_id)['weight'];
            // 10.1.1.1_to_10.1.1.2: {'original_js_edge_weight': 1}
            changed_js_edge_cost_dd[js_edge_id] = {'original_js_edge_weight': original_weight};
            // 10.1.1.1_to_10.1.1.2: {'js_edge_new_weight': 1, 'original_js_edge_weight': 1, 'igraph_edge_id': 123}
            changed_js_edge_cost_dd[js_edge_id]['js_edge_new_weight'] = new_ospf_cost;
            changed_js_edge_cost_dd[js_edge_id]['igraph_edge_id'] = edge_id_w_new_weight;
          }
        }

        // when we built SPT path and changed painted edge - we rebuild SPT with new changed edge. 
        // If right clicked on general edge - paint edge outcome with new changed ospf cost
        /*
        SPT edge = js_edge_attr =
        arrows: {from: true, to: false}
        color: {color: "#1a8cff", opacity: 0.7, hover: "#1a8cff"}
        comment: "spt_path_edge"
        from: "123.123.101.101"
        id: "123.123.101.101_to_123.123.110.110_29"
        igraph_edges_id_ll: [29]
        new_edge: false
        parent_edge_id: "123.123.101.101_to_123.123.110.110"
        spt_dst_node: "123.123.101.101"
        spt_src_node: "123.15.15.15"
        title: "<p>123.123.101.101-<b>10</b>->123.123.110.110</p><p>123.123.110.110-<b>10</b>->123.123.101.101</p>"
        to: "123.123.110.110"
        width: 8
        */
        //js_edge_attr = data.edges.get(js_edge_id);
        /*
        27/09 changes
        if (spt_src_node_ospf_plan && spt_dst_node_ospf_plan) {
          spt_src_node = spt_src_node_ospf_plan;
          spt_dst_node = spt_dst_node_ospf_plan;
          // rebuild SPT with new changed OSPF costs. Do not forget to clear backup path info
          add_backup_path_description(Array());
          //accept_node_for_spt_return_spt();
          get_edge_from_spt_outcome(graph_id, src_node = false, dst_node = false, spt_src_node = spt_src_node, spt_dst_node=spt_dst_node, js_edge_id=false) 
          // src_node and dst_node is needed in order to simulate shutdown this edge, js_edge_id is needed in order to mark selected edge as deleted
        }
        else {
          get_edge_remove_outcome(graph_id, selected_edge_attr = Array(), plan_when_changed_ospf_cost = true);
        }
        */
        let pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure
        if (pressed_button == 'GeneralView') {
          // under General View if we pres on general edge - we rebuild SPT
          if (spt_src_node_ospf_plan && spt_dst_node_ospf_plan) {
            spt_src_node = spt_src_node_ospf_plan;
            spt_dst_node = spt_dst_node_ospf_plan;
            // rebuild SPT with new changed OSPF costs. Do not forget to clear backup path info
            add_backup_path_description(Array());
            //accept_node_for_spt_return_spt();
            get_edge_from_spt_outcome(graph_id, src_node = false, dst_node = false, spt_src_node = spt_src_node, spt_dst_node=spt_dst_node, js_edge_id=false) 
            // src_node and dst_node is needed in order to simulate shutdown this edge, js_edge_id is needed in order to mark selected edge as deleted
          }
          else {
            // we dont save changed edge because user under wrong TAB
            delete changed_edge_cost_dd[edge_id_w_new_weight];
            delete changed_js_edge_cost_dd[js_edge_id];
            $.ajax(alert('Please build a path from some source to destination or jump to Network Reaction On failure Tab in order to see general network reaction without any SPT paths'))
          }
        }
        else {
          get_edge_remove_outcome(graph_id, selected_edge_attr = Array(), plan_when_changed_ospf_cost = true);
        }
      }
      else {
        // when we delete what we have wrote before
        //changed_edge_cost_dd[edge_id_w_new_weight] = parseInt(old_ospf_edge_weight, 10);
        delete changed_edge_cost_dd[edge_id_w_new_weight];
        delete changed_js_edge_cost_dd[js_edge_id];
        if (pressed_button == 'GeneralView') {
          // under General View if we pres on general edge - we rebuild SPT
          if (spt_src_node_ospf_plan && spt_dst_node_ospf_plan) {
            spt_src_node = spt_src_node_ospf_plan;
            spt_dst_node = spt_dst_node_ospf_plan;
            // rebuild SPT with new changed OSPF costs. Do not forget to clear backup path info
            add_backup_path_description(Array());
            //accept_node_for_spt_return_spt();
            get_edge_from_spt_outcome(graph_id, src_node = false, dst_node = false, spt_src_node = spt_src_node, spt_dst_node=spt_dst_node, js_edge_id=false) 
            // src_node and dst_node is needed in order to simulate shutdown this edge, js_edge_id is needed in order to mark selected edge as deleted
          }
        }
        else {
          get_edge_remove_outcome(graph_id, selected_edge_attr = Array(), plan_when_changed_ospf_cost = true);
        }
      }
    }
// #####################

// #123#################
function get_node_details(graph_id, node_index)
  {
  /*
  backuped_nets: []
  linked_subnets: []
  not_available_nets: []
  */
  $.ajax({
      url: "/get_node_details",
    type: "post",
    data: {'graph_id': graph_id, "node_index": node_index},
      success:  function callbackFunc(response)
        {
        // clear description
        document.getElementById('node_failure_prediction_description').innerHTML = '';
        hide('node_failure_prediction_description');

        $("#backuped_num").text(response.backuped_nets.length); // bold text statistic
        $("#nonbackuped_num").text(response.not_available_nets.length); // bold text statistic
        // clear previous networks
        $("#backuped_networks_id").text('Backuped networks [HSRP neighbour]:');
        $("#nonbackuped_networks_id").text('Non-backuped networks:');
        if (response.backuped_nets.length > 0) {
          //$("#backuped_networks_id").text('');
          $.each(response.backuped_nets,function(i,item){
            $("#backuped_networks_id").append('<li style="color: green">'+item + ' [' +response.hsrp_neighbor_subnet_map[item]+']' +'</li>\n')
          })      
        }
        if (response.not_available_nets.length > 0) 
          {
            //$("#nonbackuped_networks_id").text('');
            $.each(response.not_available_nets,function(i,item){
            $("#nonbackuped_networks_id").append(
              '<li style="color: red">'+item+'</li>\n')
          })
          }
        $('.PopUpFormBackupNonBackupNets').css({
          height: (220 + response.backuped_nets.length*23 + response.not_available_nets.length*23).toString() + "px"
        })
        /*
        if (response.backuped_nets.length > 0) 
          {
            document.getElementById('node_failure_prediction_description').innerHTML = '<h4>Backup networks: </h4>';
            for (var n in response.backuped_nets) {
              var backuped_net = response.backuped_nets[n];
              console.log('backuped_net', backuped_net);
              document.getElementById('node_failure_prediction_description').innerHTML += backuped_net + '\n';
            }
          }

        if (response.linked_subnets.length > 0) 
          {
            document.getElementById('node_failure_prediction_description').innerHTML += '<h4>Linked networks: </h4>';
            for (var n in response.linked_subnets) {
              var linked_subnet = response.linked_subnets[n];
              document.getElementById('node_failure_prediction_description').innerHTML += linked_subnet + '\n';
            }
          }
      
        if (response.not_available_nets.length > 0) 
          {
            document.getElementById('node_failure_prediction_description').innerHTML += '<h4>Not backuped networks: </h4>';
            for (var n in response.not_available_nets) {
              var not_available_net = response.not_available_nets[n];
              document.getElementById('node_failure_prediction_description').innerHTML += not_available_net + '\n';
            }
          }
        */
        //nodes.update([{id: node_index, shape: 'box', label: "backuped nets: " + response.backuped_nets.length + "\nnot_available_nets: " + response.not_available_nets}]);
        },
      error: function(XMLHttpRequest, textStatus, errorThrown) {
        $("a.close").click(function(e)
          {
              e.preventDefault();
              $(this).closest("div.PopUpFormBackupNonBackupNets").fadeToggle();        
          });
          //textStatus = error
          //errorThrown = NOT FOUND
        console.log(`${errorThrown}, ${XMLHttpRequest.responseText}`)
      }
        })
}

function do_stop_start_physics() {
  /* when press on square and in changed to triangle only if we upload a graph previously*/
  if (typeof network === 'undefined') {
    $.ajax(alert("Please upload a Graph in order to stop physics"));
  }
  else {
    var phy_scale_settings = {};
    if (network.physics.physicsEnabled == true) {
      phy_scale_settings = {physics: {enabled: false}}
      network.setOptions(phy_scale_settings);
      document.getElementById('btnStopPhysics').innerHTML = '<img src=\'/static/start_button.png\'/>Unfreeze network';
      show_instant_notification("Physics was disabled. So move nodes one by one without affecting other nodes.");
    }
    else {
      phy_scale_settings = {physics: {enabled: true}}
      network.setOptions(phy_scale_settings);
      //document.getElementById('btnStopPhysicsImg').src = "/static/stop_button.png";
      document.getElementById('btnStopPhysics').innerHTML = '<img src=\'/static/stop_button.png\'/>Freeze network';
    }
    // save physics settings as graph attributes in DB. It's needed when nodes will be rendered with saved X and Y
    $.ajax({
      url: "/do_stop_start_physics",
      type: "post",
      data: {"graph_id": graph_id, "graph_physics_settings_json": JSON.stringify(phy_scale_settings)}
    });
  }
}

function show_instant_notification(message, delay=4500, warning=false) {
  if (warning) {
    document.getElementById('btnStopStartPhysics').style.background = "#ff8c1a";
  }
  else {
    document.getElementById('btnStopStartPhysics').style.background = 'rgba(93, 230, 150, 0.871)';
  }
  $( '#btnStopStartPhysics').text(message);
  $( '#btnStopStartPhysics').show().delay(delay).fadeOut(2000);
}

function get_backup_paths_in_ecmp__report(){
  /*Not used */
  if (typeof graph_id === 'undefined') {
    alert('Please, choose a graph from previously uploaded and Load it firstly');
  }
  else {
    $.ajax({
      url: "/get_backup_paths_in_ecmp__report",
      type: "post",
      data: {'graph_id': graph_id},
      success:  function callbackFunc(response)
        {
        paint_js_edges_node_order_is_matter(response.not_passed_ecmp_report_node_pair_js_ll, {'width': 8, color: {color:'#f0120f', opacity: 0.8, hover: '#d11210'}}, rewrite_color=true);
        // f0120f black red
        // d11210 a litle bit lighter. 
        if (response.not_passed_ecmp_report_node_pair_js_ll.length == 0) {
          show_instant_notification('The check has been passed!')}
        else {
          show_instant_notification(`There are ${response.not_passed_ecmp_report_node_pair_js_ll.length} ECMP link which did not pass this check. If one of ECMP link with lowest cost goes down - the backup path will be redirected via another hosts, not via this ECMP`)
        }
        }
        
        })
    }
}

function get_backup_paths_in_inter_area__report(neighbors_with_ecmp_only=false){
  /*Not used */
  if (typeof graph_id === 'undefined') {
    alert('Please, choose a graph from previously uploaded and Load it firstly');
  }
  else {
    $.ajax({
      url: "/get_backup_paths_in_inter_area__report",
      type: "post",
      data: {'graph_id': graph_id, 'neighbors_with_ecmp_only': neighbors_with_ecmp_only},
      success:  function callbackFunc(response)
        {
          do_fill_table_with_not_passed_interarea_backup_paths(response.not_passed_report_node_obj_ll);
          
          if (response.all_groups_w_attr.length == 0) {
            show_instant_notification('Please create groups in Devices Tab and assign devices to them!', 5500, warning=true)
          }
          else {
            if (response.not_passed_report_node_obj_ll.length == 0) {
              show_instant_notification('The check has been passed!')}
            else {
              show_instant_notification(`There are ${response.not_passed_report_node_obj_ll.length} backup paths, which go via third locations if primary link between two location goes down.`, 5500)
              show('interarea_backup_paths_table');
            }
          }
        }
        
        })
    }
}

function get_unidir_and_unsym_edges(){
  /*Not used */
  if (typeof graph_id === 'undefined') {
    alert('Please, choose a graph from previously uploaded and Load it firstly');
  }
  else {
    $.ajax({
      url: "/get_unidir_and_unsym_edges",
      type: "post",
      data: {'graph_id': graph_id},
      success:  function callbackFunc(response)
        {
          if (response.unidir_edges_ll.length == 0 && response.unsym_end_router_edges_ll.length == 0 && response.unsym_edges_ll.length == 0) {
            show_instant_notification("The graph does not have asymmetric edges/paths.", 5500);
          }
        else {
        paint_js_edges_node_order_is_matter(response.unidir_edges_ll, {'width': 8, color: {color:'#3000f5', opacity: 0.8, hover: '#3109d7'}}, rewrite_color=true);
        // #3000f5 dark blue
        // #ff8000 - orange
        // #e67300 - dark orange
        paint_js_edges_node_order_is_matter(response.unsym_end_router_edges_ll, {'width': 8, color: {color:'#2f7e11', opacity: 0.8, hover: '#1eb017'}}, rewrite_color=true);
        // #dbe01a - between yellow and green
        // black green - new variant #2f7e11
        // 1eb017 - green
        paint_js_edges_node_order_is_matter(response.unsym_edges_ll, {'width': 8, color: {color:'#f0120f', opacity: 0.8, hover: '#d11210'}}, rewrite_color=true);
        // f0120f black red
        // d11210 a litle bit lighter. So unsym edges are much more dangerous that unsym end router edges, so hover such edges with a little bit darker light, but end routers - a little bit lighter color
        // show pop up message
        show_instant_notification(`There are ${response.unidir_edges_ll.length} unidirectional and ${response.unsym_edges_ll.length + response.unsym_end_router_edges_ll.length} asymmetric edges`, delay=4500, warning=true)
        // show button to print asymmetric edges as a table
        show('unidir_and_asym_edges_table_btn');
        var all_unsym_edges_ll = response.unsym_edges_ll;
        all_unsym_edges_ll.push(...response.unsym_end_router_edges_ll)
        do_fill_table_with_unidir_and_asym_edges(all_unsym_edges_ll);
      }
    }
        })
    }
  }

function do_fill_table_with_unidir_and_asym_edges(unsym_edges_ll){
  /*
  [{'from': '123.11.11.11', 'id': '123.11.11.11_to_123.31.31.31', 'router_from_edge_weight_ll': [1], 'router_to_edge_weight_ll': [10], 'to': '123.31.31.31'}, 
  {'from': '123.10.10.10', 'id': '123.10.10.10_to_123.30.30.30', 'router_from_edge_weight_ll': [10], 'router_to_edge_weight_ll': [1], 'to': '123.30.30.30'}] */
  document.getElementById('unidir_and_asym_edges_table_body').innerHTML = '';
  const table = document.getElementById("unidir_and_asym_edges_table_body");
  unsym_edges_ll.forEach( unsym_edge_dd => {
    let row = table.insertRow();
    let router_from = row.insertCell(0);
    router_from.innerHTML = unsym_edge_dd.from;
    let router_from_edge_weight_ll = row.insertCell(1);
    router_from_edge_weight_ll.innerHTML = unsym_edge_dd.router_from_edge_weight_ll;
    let router_to_edge_weight_ll = row.insertCell(2);
    router_to_edge_weight_ll.innerHTML = unsym_edge_dd.router_to_edge_weight_ll;
    let router_to = row.insertCell(3);
    router_to.innerHTML = unsym_edge_dd.to;
  });
}

function do_fill_table_with_not_passed_interarea_backup_paths(not_passed_report_node_obj_ll){
  /*
  not_passed_report_node_obj f"{self.src_node_name}->{self.dst_node_name} now:{self.current_group_name_path} backup group:{self.backup_group_name_path}, backup_path:{self.backup_path_ll_in_ll}"
 */
  document.getElementById('interarea_backup_paths_table_body').innerHTML = '';
  const table = document.getElementById("interarea_backup_paths_table_body");
  not_passed_report_node_obj_ll.forEach( node_obj => {
    let row = table.insertRow();
    let router_from = row.insertCell(0);
    router_from.innerHTML = node_obj.src_node_name;
    let router_destination = row.insertCell(1);
    router_destination.innerHTML = node_obj.dst_node_name;
    let spt_group_name_path = row.insertCell(2);
    spt_group_name_path.innerHTML = node_obj.current_group_name_path;
    let backup_group_name_path = row.insertCell(3);
    backup_group_name_path.innerHTML = node_obj.backup_group_name_path;
    let backup_path_ll_in_ll = row.insertCell(4);
    backup_path_ll_in_ll.innerHTML = node_obj.backup_path_ll_in_ll;
  });
}

function get_duplicated_terminated_networks(){
  /*Not used */
  if (typeof graph_id === 'undefined') {
    alert('Please, choose a graph from previously uploaded and Load it firstly');
  }
  else {
    var graph_time_options = document.getElementById("dynamic_graph_time");
    var graph_time = graph_time_options.options[graph_time_options.selectedIndex].value;
    $.ajax({
      url: "/get_duplicated_terminated_networks",
      type: "post",
      data: {'graph_time': graph_time},
      success:  function callbackFunc(response)
        {
          if (response.networks_attr_ll.length == 0) {
            show_instant_notification("The graph does not have duplicated terminated subnets.", 5500);
          }
        else {
          show('duplicated_terminated_networks_table_btn');
          // show pop up message
          show_instant_notification(`There are ${response.networks_attr_ll.length} duplicated networks`, delay=4500, warning=true)
          document.getElementById('duplicated_terminated_networks_table_body').innerHTML = '';
          const table = document.getElementById("duplicated_terminated_networks_table_body");
          response.networks_attr_ll.forEach( network_attr_dd => {
            let row = table.insertRow();
            let cidr = row.insertCell(0);
            cidr.innerHTML = network_attr_dd.cidr;
            let net_count = row.insertCell(1);
            net_count.innerHTML = network_attr_dd.net_count;
            let terminated_nodes_ll = row.insertCell(2);
            terminated_nodes_ll.innerHTML = JSON.stringify(network_attr_dd.terminated_nodes_ll);
            if (network_attr_dd.disjoint_neighbors_bool) {
              terminated_nodes_ll.className = "table-danger";
            }
          });
      }
    }
        })
    }
  }

function fadeout_duplicated_terminated_networks_table_table(){
  // Show a table of duplicated stub networks
  let _btn = document.getElementById('show_duplicated_terminated_networks_table');
  if (_btn.value == 'Show report result') {
    // the table has already populated, it's needed just to unhide
    show('duplicated_terminated_networks_table');
    _btn.value = 'Hide the table';
  }
  else {
    document.getElementById('duplicated_terminated_networks_table_body').innerHTML = '';
    _btn.value = 'Show report result';
    hide('duplicated_terminated_networks_table_btn');
    hide('duplicated_terminated_networks_table');
  }
  
}

function fadeout_unidir_and_asym_edges_table(){
  // Show a table of asymmetric links is pressed and a table with asymetric links is going to show
  let _btn = document.getElementById('show_unidir_and_asym_edges_table');
  //if (_btn.value == 'Show a table of asymmetric links') {
  if (_btn.value == 'Show report result') {
    // the table with asymmetric links has already populated, it's needed just to unhide
    show('unidir_and_asym_edges_table');
    _btn.value = 'Hide the table';
  }
  else {
    document.getElementById('unidir_and_asym_edges_table_body').innerHTML = '';
    //_btn.value = 'Show a table of asymmetric links';
    _btn.value = 'Show report result';
    hide('unidir_and_asym_edges_table_btn');
    hide('unidir_and_asym_edges_table');
  }
  
}

function get_unsym_paths(){
  //Not used
  if (typeof graph_id === 'undefined') {
    alert('Please, choose a graph from previously uploaded and Load it firstly');
  }
  else {
    show('loadingWheel' );
    document.getElementById('mynetwork').style.opacity = 0.2; // make topology in the fog
    // if we built SPT or MST earlier we have to clear painted edges first
    ClearPaintedGraph();
    $.ajax({
      url: "/get_unsym_paths",
      type: "post",
      data: {'graph_id': graph_id},
      success:  function callbackFunc(response)
        {
        hide('loadingWheel' );
        document.getElementById('mynetwork').style.opacity = 1; // calculation has been finished. Take the fog off from topology
        if (response.unsym_edges_attr_dd_ll.length == 0) {
          show_instant_notification("The graph does not have asymmetric edges/paths.", 5500);
        }
        else{
        $( 'div.PopUpFormUnsymmetricPaths' ).fadeToggle();
        show_instant_notification("For building SPTs and using NetworkReactionOnFailure Load Dynamic Graph again.", 5500, warning=true);
        /* Works
        //clear table
        $("#unsym_table_w_node_names tbody").text('') // clear table
        //$.each( response.ordered_unsym_edge_w_diff_edges_dd, function(node_name_as_key,item){
        // unsym_edges_attr_dd_ll[0] = {'color': {'color': 'red'}, 'from': '123.10.10.10', 'mst_node_name_ll': ['123.10.10.10', '123.123.100.100', '123.11.11.11', '123.30.30.30', '123.123.31.31'], 'to': '123.30.30.30', 'unsym_edge': '0_9', 'width': 4}
        $("#unsym_table_w_node_names tbody").append('<div class="container1" id="container1">')
        $.each( response.unsym_edges_attr_dd_ll, function(ind){
          var context = '<div class="container2">'
          context += '<div name="header" class="header"><span>Expand</span>';
          context +='</div>'
          context +='<div name="content" class="content">'
          $.each( response.unsym_edges_attr_dd_ll[ind].mst_node_name_dd_ll, function(ind2, mst_node_dd){
            // Fill a table of MST Node

            context +=`<label>`  
            context +=`<input type="checkbox" name="edgesFilter" id=${mst_node_dd.filter} value=${mst_node_dd.filter} checked />`+ mst_node_dd.node_name
            context +=`</label>`
          })
          context +='</div>'
          context +='</div>'
          $("#unsym_table_w_node_names tbody").append(
            // Fill a table with unsymmetric edges
            "<tr>"
              +`<td>`
              +`<label>`
              //+`<input type="checkbox" name="edgesFilter" value=${response.unsym_edges_attr_dd_ll[ind].unsym_edge} checked />`+response.unsym_edges_attr_dd_ll[ind].from+`_`+response.unsym_edges_attr_dd_ll[ind].to
              +`<input type="checkbox" name="edgesFilter" value=${response.unsym_edges_attr_dd_ll[ind].unsym_edge} checked />`+response.unsym_edges_attr_dd_ll[ind].from+`_`+response.unsym_edges_attr_dd_ll[ind].to
              +`</label>`
              +context
              +`</td>`
            +`</tr>`);

        });
        */
        
        //clear table
        $("#list_w_unsym_node_names").text(''); // clear a list
        $("#unsym_node_names").text(''); // clear a list
        //edgesFilterValues_dd_ll [['123.10.10.10': True], ['123.11.11.11': True], ...] sorted MST Node names by number of diff edges    
        $("#unsym_node_names").append(`<label><input type="checkbox" name="edgesFilter" value=unsym_edge checked /> All unsymmetric edges</label>`);
        
        $.each( response.edgesFilterValues_dd_ll, function(ind, node_name_and_flag_ll){
            let node_name_as_key = node_name_and_flag_ll[0];
            is_checked = node_name_and_flag_ll[1] ? 'checked' : ''
            
            // mark checked node with green color
            if (is_checked == 'checked') {
              color_nodes([node_name_as_key], conf={'size': 12, 'color': {'background': '#7BE141'}})
            }

            $("#list_w_unsym_node_names").append(
              // Fill a table with unsymmetric edges
              `<label>`
              +`<input type="checkbox" name="edgesFilter" value=${node_name_as_key} ${is_checked} />`+node_name_as_key + ` (${response.rootNodeWithNumberOfUnsymEdgesStat_dd[node_name_as_key]})`
              +`</label>`);
            });

        /*Change size of pop-up form. We adapt the size of form to number of result until scroll max-height. When we get so many results that we need to use scroll - we set background form to MAX size*/
        let innerTextHeight = Object.keys(response.edgesFilterValues_dd).length*30;
        const MaxInnerTextHeight = 200;
        if (innerTextHeight<MaxInnerTextHeight) {
          $('.PopUpFormUnsymmetricPaths').css({
            height: (180 + innerTextHeight).toString() + "px"
          })
        } else {
          $('.PopUpFormUnsymmetricPaths').css({
              height: "550px"
            })
        }

        
        //unflat_ecmp(response.to_unflat_ecmp_edges_id_ll);

        let edgesFilterValues = response.edgesFilterValues_dd;
        edgesFilterValues['links'] = true; // we add a key 'links' into filter dictionary for future filtering
        // in order to see all edges - we should assign 'root_node_name' attribute to all edges before adding DIFF edges. DIFF edges - edges where Inconmming and Outgogin paths are differ
        //mark_all_edges_for_dyn_filtering(conf={'root_node_name': 'links'});
        mark_all_edges_for_dyn_filtering(conf={'unsym_edge': 'links'});
        edgesFilterValues['unsym_edge'] = true; // we add a key 'unsym_edge' into filter dictionary in order to show and hide unsummetric edges
        
        // we use copy because we add new edges to the graph
        const all_visjs_edges_w_attr = edges.get(); // could take long time???
        let edges_copy = new vis.DataSet(all_visjs_edges_w_attr);


        edges_copy.add(response.node_dd_in_ll);
        edges_copy.add(response.node_dd_out_ll);
        edges_copy.add(response.unsym_edges_attr_dd_ll);


        // Get Multiple Choosed Web Form Option
        const edgeFilters = document.getElementsByName("edgesFilter");
        const MstNodesExpand = document.getElementsByName("header");
            
        
        const edgesFilter = (edge) => {
          //return edgesFilterValues[edge.root_node_name];
          return edgesFilterValues[edge.unsym_edge];
          };
        const nodesView = new vis.DataView(nodes);
        const edgesView = new vis.DataView(edges_copy, { filter: edgesFilter });
        
        edgeFilters.forEach((filter) => filter.addEventListener("change", (e) => {
                      //console.log(e.currentTarget);
                      const { value, checked } = e.target;
                      edgesFilterValues[value] = checked;
                      edgesView.refresh();
                      // change network MST Node for better it finding
                      // doesn't work const test = document.getElementById(value); // value == ID
                      // doesn't work console.log($('#' + value).data('mstnodename'));
                      const _mstNodeName = e.target.nextSibling.data; // 10.1.1.1 (8) - 10.1.1.1 - mst root node name, 8 - number of diff edges
                      mstNodeName = _mstNodeName.split(" ")[0];
                      if (checked == true) {
                        //js_node_attr = nodes.get(mstNodeName);
                        color_nodes([mstNodeName], conf={'size': 12, 'color': {'background': '#7BE141'}})
                      } else {
                        reset_color_nodes([mstNodeName]);
                      }
                    })
              );

        MstNodesExpand.forEach((MstNodeList) => MstNodeList.addEventListener("click", (e) => {
          const header = e.currentTarget;
          const content = header.nextSibling;
          //console.log(content);
          //open up the content needed - toggle the slide- if visible, slide up, if not slidedown.
          $( content).slideToggle(500);
          //change text based on condition
          $( header).text(function () {
            return header.innerText === 'Collapse' ? "Expand" : "Collapse";
        })
          
        })
);

        network = new vis.Network(container, { nodes: nodesView, edges: edgesView }, options=options);
        // global var which indicate that what we see is DataView object. It used for clearing 
        is_network_view = true;
      }
      }
      })
    }
  }

function mark_all_edges_for_dyn_filtering( conf = {}) {
  // in order to see all edges - we should assign 'root_node_name' attribute to all edges before adding DIFF edges. DIFF edges - edges where Inconmming and Outgogin paths are differ

  let arr = Array();
  edges.forEach(function (edge_attr) {
    Object.assign(edge_attr, conf);
    arr.push(edge_attr);
  })
  data.edges.update(arr);
}

/*
function paint_graph_for_network_reaction_outcome(){
  // Not used
  if (graph_id == '') {
    alert('Please, choose a graph from previously uploaded and Load it')
  }
  $.ajax({
      url: "/paint_graph_for_network_reaction_outcome",
    type: "post",
    data: {'graph_id': graph_id},
      success:  function callbackFunc(response)
        {
        var dd_ll = Array();
        for (var n in response.all_edge_attr_dd_in_ll) {
          let dd = {};
          Object.assign(dd, response.all_edge_attr_dd_in_ll[n]);
          dd.new_edge = false;
          dd_ll.push(dd);
        }
        paint_js_edges_node_order_is_matter(response.all_edge_attr_dd_in_ll, {'width': 8, color: {color:'#ff8000', opacity: 0.6, hover: '#e67300'}}, rewrite_color=true);
      // #ff8000 - orange
      // #e67300 - dark orange
        }
          })
}*/

function paint_network_reaction_results(down_all_edge_attr_dd_in_ll, up_all_edge_attr_dd_in_ll, down_traffic_nodes_name_ll, up_traffic_nodes_name_ll, deleted_edge_as_src_dst_node_ll = Array())
  // This function add curved Blue or Grey Lines in order to demonstray increasing or descresing data traffic over links after deleting particular edge
  {
      paint_js_edges_node_order_is_matter(down_all_edge_attr_dd_in_ll, {'width': 8, color: {color:'#808080', opacity: 0.7, hover: '#4d4d4d'}, 'comment': 'updown_traffic_node'});
      // 808080 grey 
      /*
      up_all_edge_attr_dd_in_ll = [
      arrows: {from: true, to: true}
      color: {color: "#3399ff", opacity: 0.9, hover: "#1a8cff"}
      comment: "updown_traffic_node"
      from: "123.14.14.14"
      id: "123.14.14.14_to_123.123.111.111_9"
      new_edge: true
      parent_edge_id: "123.14.14.14_to_123.123.111.111"
      smooth: {enabled: true, type: "curvedCW", roundness: 0.30000000000000004}
      title: "<p><p>123.14.14.14 -> 123.123.111.111 bw old:6.00 new:12.00, UP rate:100.00 </p>123.123.111.111 -> 123.14.14.14 bw old:6.00 new:12.00, UP rate:100.00 </p>"
      to: "123.123.111.111"
      value: 100
      width: 8]
      */
      paint_js_edges_node_order_is_matter(up_all_edge_attr_dd_in_ll, {'width': 8, color: {color:'#3399ff', opacity: 0.9, hover: '#1a8cff'}, 'comment': 'updown_traffic_node'}, rewrite_color=true);
      // 3399ff - blue
      if (deleted_edge_as_src_dst_node_ll)
      {
        get_right_edge(deleted_edge_as_src_dst_node_ll, data.edges, {color: '#ff0000', 'dashes': true, arrows : { from: {enabled: true, scaleFactor : 1} , to: {enabled: true, scaleFactor : 1}}, 'comment': 'updown_traffic_node'});
      }
      // ff0000 - red
      color_nodes(up_traffic_nodes_name_ll, {color: '#3399ff', 'comment': 'updown_traffic_node'}); // up_traffic_nodes_name_ll = ["123.11.11.11", "123.31.31.31"]
      // 3399ff - blue
      color_nodes(down_traffic_nodes_name_ll, {color: '#808080', 'comment': 'updown_traffic_node'}); // down_traffic_nodes_name_ll = ["123.10.10.10", "123.30.30.30"]
      // 808080 grey 
  }

function hide_edges_by_edge_attribute(edge_attribute_name, edge_attribute_value) {
  // set hidden: true for all edges with isis_level == 2

  let arr = Array();
  edges.forEach(function (edge_attr) {
    if (edge_attr.hasOwnProperty(edge_attribute_name) && edge_attr[edge_attribute_name] == edge_attribute_value) {
      Object.assign(edge_attr, {'hidden': true}); // #ffffff white
      arr.push(edge_attr);
    }
  })
  data.edges.update(arr);
}

function unhide_edges_by_edge_attribute(edge_attribute_name, edge_attribute_value) {
  // set hidden: false for all edges with isis_level == 2

  let arr = Array();
  edges.forEach(function (edge_attr) {
    if (edge_attr.hasOwnProperty(edge_attribute_name) && edge_attr[edge_attribute_name] == edge_attribute_value) {
        Object.assign(edge_attr, {'hidden': false});
      arr.push(edge_attr);
    }
  })
  data.edges.update(arr);
}

function color_isis_edges_by_edge_attribute(edge_attribute_name='isis_level', edge_attribute_value, level_number=0) {

  if (level_number == 1) {
    var _color = '#ef9901'; // amber
  } else if (level_number == 2) {
    var _color = '#9820BC'; // fuxi
  } else if (edge_attribute_name == 'isnarrow') {
    var _color = '#ef0101'; // red
  }
  else {
    var _color = '#000000'; // black
  }
  let arr = Array();
  edges.forEach(function (edge_attr) {
    if (edge_attr.hasOwnProperty(edge_attribute_name) && edge_attr[edge_attribute_name] == edge_attribute_value) {
        Object.assign(edge_attr, {'color': _color});
      arr.push(edge_attr);
    }
  })
  data.edges.update(arr);
}

function get_removed_edges_id(selected_edge_attr, _shared_removed_edge_vis_id_in_ll = Array()) {
  /*
  The func mantains removed_js_edge_ids_ll and removed_edge_ids_ll lists. The first one for painting edges on VISJS
  the second one - collects igraph edge IDs and push it to the backend, then backend mark it as deleted and return results 
  The func operates based on attributes assigned on edges
  */
  let dr_neighbor_edges_ll = Array();
  if (typeof selected_edge_attr.ecmp_parent_edge_id !== 'undefined' && selected_edge_attr.comment != "deleted_edge")
    {
      // directed edge after unflating ECMP edges
      removed_js_edge_ids_set.add(selected_edge_attr.id);
    }
  else if (selected_edge_attr.comment == "updown_traffic_node")
    {
      removed_js_edge_ids_set.add(selected_edge_attr.parent_edge_id);
    }
  else if (selected_edge_attr.comment == "deleted_edge")
    {
      removed_js_edge_ids_set.delete(selected_edge_attr.id);
      // if we mark deleted edge, but it shares media with DR and multiple neighbors
      // we can click on any link between multiple neighbors and we need to remove all edges between neighbors
      let dr_neighbor_edges_ll = edges.get({
        filter: function (item) {return item.dr_ip_address == selected_edge_attr.dr_ip_address}
        });
      // we should exclude directed links from it. Because once you select directed edge, we do not need to add reverse edge to deleted
      if (dr_neighbor_edges_ll.length > 0 && typeof selected_edge_attr.ecmp_parent_edge_id === 'undefined') {
        dr_neighbor_edges_ll.forEach(function(edgeAttrToNeighbor) {removed_js_edge_ids_set.delete(edgeAttrToNeighbor.id)});
      }
    }
  else
    {
      if (_shared_removed_edge_vis_id_in_ll.length > 0) {
        for (var i = 0; i < _shared_removed_edge_vis_id_in_ll.length; i++) {
          removed_js_edge_ids_set.add(_shared_removed_edge_vis_id_in_ll[i].id);
        }
      }
      else {
        removed_js_edge_ids_set.add(selected_edge_attr.id);
      }
    }
  // remove igraph directed edges
  if (selected_edge_attr && typeof selected_edge_attr.igraph_edges_id_ll !== 'undefined') 
    {
      if (selected_edge_attr.comment != "deleted_edge") {
        if (Array.isArray(selected_edge_attr.igraph_edges_id_ll))
            {
              selected_edge_attr.igraph_edges_id_ll.forEach(function(edge_id) {removed_edge_ids_set.add(edge_id)});
            }
          else
            {
              removed_edge_ids_set.add(selected_edge_attr.igraph_edges_id_ll)
            }
        }
      else {
        // remove only recovered from deleted edge igraph edges ids
        if (Array.isArray(selected_edge_attr.igraph_edges_id_ll)) {
          selected_edge_attr.igraph_edges_id_ll.forEach(function(edge_id) {removed_edge_ids_set.delete(edge_id)});
        }
        else {
          removed_edge_ids_set.delete(selected_edge_attr.igraph_edges_id_ll);
        }
        if (dr_neighbor_edges_ll.length > 0) {
          // remove all igraph edges ID from all neighboars of shared media
          dr_neighbor_edges_ll.forEach(function(edgeAttrToNeighbor) {
            if (Array.isArray(edgeAttrToNeighbor.igraph_edges_id_ll)) {
              edgeAttrToNeighbor.igraph_edges_id_ll.forEach(function(edge_id) {removed_edge_ids_set.delete(edge_id)});
            }
            else {
              removed_edge_ids_set.delete(edge_id)
            }
          });
        }
      }
    }
  removed_js_edge_ids_ll = Array.from(removed_js_edge_ids_set)
  removed_edge_ids_ll = Array.from(removed_edge_ids_set)
  return removed_js_edge_ids_ll, removed_edge_ids_ll
  }

  function get_edge_remove_outcome(graph_id, selected_edge_attr = Array(), plan_when_changed_ospf_cost = false)
  {
    /*
    when we under NetworkReactionOnFailure View, press on the edge. We show network reaction on a failure of such edge. How traffic will overflow such segment
    We might press 
    on unchanged edge with 1.1.1.1_to_1.1.1.2 id or so we choose igraph_edges_id_ll with all inside igraph edges and JS edge ID for removed_js_edge_ids_ll
    coloured edge id 2.2.2.2_to_2.2.2.3_99 but we should add not ..._99 we take parent_edge_id for removed_js_edge_ids_ll as removed edge because We emulate NetworkReaction on a graph from scratch. ALso takes igraph_edges_id_ll
    ECMP edge with ecmp_parent_edge_id = 3.3.3.3_to_3.3.3.4 and id 3.3.3.3_to_3.3.3.4_199 <- Take value from igraph_edges_id_ll (it always single digit in directed graphs). edge id for removed_js_edge_ids_ll
    
    plan_when_changed_ospf_cost Boolean
    when plan_when_changed_ospf_cost = True we pass a dictionary with changed ospf link cost and backend function should take it into account
    */
  /*
  if (typeof selected_edge_attr.ecmp_parent_edge_id !== 'undefined')
    {
      console.log('You choosed ECMP edge', selected_edge_attr.id);
      removed_js_edge_ids_ll.push(selected_edge_attr.id);
    }
  else if (selected_edge_attr.comment == "updown_traffic_node")
    {
      console.log('You choosed Colored edge with id', selected_edge_attr.parent_edge_id);
      removed_js_edge_ids_ll.push(selected_edge_attr.parent_edge_id);
    }
  else
    {
      console.log('You choosed unchanged edge', selected_edge_attr.id);
      removed_js_edge_ids_ll.push(selected_edge_attr.id);
    }
  //removed_edge_as_src_dst_node_name_ll.push([src_node, dst_node]);
  if (selected_edge_attr && typeof selected_edge_attr.igraph_edges_id_ll !== 'undefined') 
    {
      if (Array.isArray(selected_edge_attr.igraph_edges_id_ll))
        {
          removed_edge_ids_ll.push(...selected_edge_attr.igraph_edges_id_ll);
        }
      else
        {
          removed_edge_ids_ll.push(selected_edge_attr.igraph_edges_id_ll);
        }
    }
  */
  //removed_edge_as_src_dst_node_name_ll = Array();
  if (!plan_when_changed_ospf_cost) {
    removed_js_edge_ids_ll, removed_edge_ids_ll = get_removed_edges_id(selected_edge_attr);
  }
  else {
    // clear painted SPT paths
    let is_painted_edges = edges.get({
      filter: function (item) {return item.color}
      });
    if (is_painted_edges) {
      ClearPaintedGraph();
    }
  }

  let do_include_all_shared_media_neighbors = false;
  if (document.getElementById('do_include_all_shared_media_neighbors') !== null) {
    do_include_all_shared_media_neighbors = document.getElementById("do_include_all_shared_media_neighbors").checked ;
  }

  $.ajax({
      url: "/get_edge_remove_outcome",
    type: "post",
    data: {'graph_id': graph_id, "removed_edge_ids_ll_json": JSON.stringify(removed_edge_ids_ll), "plan_when_changed_ospf_cost": plan_when_changed_ospf_cost, "changed_edge_cost_dd_json": JSON.stringify(changed_edge_cost_dd),'selected_edge_attr': JSON.stringify(selected_edge_attr), 'do_include_all_shared_media_neighbors': do_include_all_shared_media_neighbors},
    success:  function callbackFunc(response)
  {
    
    unflat_ecmp(response.to_unflat_ecmp_edges_id_ll);
    // console.log('lets remove edges through which we noticed DOWN traffic: ');
    remove_unnumbered_edge(response.down_all_edge_attr_dd_in_ll, response.to_unflat_ecmp_edges_id_ll); // remove 1.1.1.1_2.2.2.2, because in SPT path we use 1.1.1.1_2.2.2.2_88 where 88 is edge id in igraph
    // console.log('lets remove edges through which we noticed UP traffic: ');
    remove_unnumbered_edge(response.up_all_edge_attr_dd_in_ll, response.to_unflat_ecmp_edges_id_ll); // remove 1.1.1.1_2.2.2.2, because in SPT path we use 1.1.1.1_2.2.2.2_88 where 88 is edge id in igraph
    paint_network_reaction_results(response.down_all_edge_attr_dd_in_ll, response.up_all_edge_attr_dd_in_ll, response.down_traffic_nodes_name_ll, response.up_traffic_nodes_name_ll);
    mark_edges_id_as_deleted(removed_js_edge_ids_ll);
    // backend detected that removed edge is on shared media (with DRs) so we need to mark all shared links as deleted
    if (!plan_when_changed_ospf_cost && response.shared_removed_edge_vis_id_in_ll.length > 0 && document.getElementById("do_include_all_shared_media_neighbors").checked === true) {
      removed_js_edge_ids_ll, removed_edge_ids_ll = get_removed_edges_id(selected_edge_attr, response.shared_removed_edge_vis_id_in_ll);
      mark_edges_id_as_deleted(removed_js_edge_ids_ll);
    }

    // update_ecmp_weight(); I couldn't control width of ECMP links
  }
        })
  }
  function update_ecmp_weight() {
    /*
    we update ECMP weight according to max value of others links. after link reaction weight could be 500 or 800

    arrows: {from: true, to: false}
    color: {color: "#808080", opacity: 0.7, hover: "#4d4d4d"}
    comment: "updown_traffic_node"
    from: "123.15.15.15"
    id: "123.15.15.15_to_123.123.110.110_28"
    igraph_edges_id_ll: [28]
    new_edge: false
    parent_edge_id: "123.15.15.15_to_123.123.110.110"
    title: "<p>123.123.110.110 -> 123.15.15.15 DOWN traffic rate:500.00% </p><p>123.123.110.110-<b>10</b>->123.15.15.15</p><p>123.15.15.15-<b>10</b>->123.123.110.110</p>"
    to: "123.123.110.110"
    value: 500
    width: 8
    */
   
    // retriev ECMP links
  var scalled_edges_dd_ll = edges.get({
    fields: ['value'],
    //fields: ['weight'],
    filter: function (item) {
      return (item.value > 0);
    }
    });
  // get max value
  let index, max_value, min_value = 0;

  scalled_edges_dd_ll.forEach(function (o) {
      Object.keys(o).forEach(function (k) {                
          if (o[k] !== null) {
            min_value = Math.min(min_value, o[k]);
            max_value = Math.max(max_value, o[k]);
          }
      });
  });

  // retriev all ECMP edges

  var ecmp_edges_dd_ll = edges.get({
    filter: function (item) {
      return (item.inside_ecmp_edges_ll);
    }
    });

  let arr = Array();
  for (let ecmp_edges_ind in ecmp_edges_dd_ll) { 
    let ecmp_edges_attr = ecmp_edges_dd_ll[ecmp_edges_ind];
    //Object.assign(ecmp_edges_attr, {'value': min_value, 'label': 'ECMP'}); // It's too big to print ECMP and too weight
    Object.assign(ecmp_edges_attr, {'value': 10});
    arr.push(ecmp_edges_attr);
    // console.log('new edge attributes', ecmp_edges_attr);
  }
  data.edges.update(arr);
  /*
  ecmp_edges_dd_ll.forEach(function (_edge_attr) {
    Object.assign(_edge_attr, {'value': max_value/2})
    });
  */
  }
  function mark_edges_w_changed_ospf_cost_as_changed(){
    // update edge label
    // It doesn't work! It always shows last updated edge as `changed`. We make request edges.get('1.1.1.1_to_1.1.1.2') but receive 1.1.1.2_to_1.1.1.8 (last changed edge)
    let arr = Array();
    // console.log('all edges ID', edges.getIds());
    for (let _js_edge_id in changed_js_edge_cost_dd) {
        // changed_js_edge_cost_dd = {10.1.1.1_to_10.1.1.2: {'js_edge_new_weight': 1, 'original_js_edge_weight': 1, 'igraph_edge_id': 123}}
        for (var n in [0,1]) {

          if (n == 0) {
            let js_edge_attr = edges.get({
              filter: function (item) {
                return (item.id == _js_edge_id);
              }
              }); }
          else { 
            let _edge_id = `${_js_edge_id}_${changed_js_edge_cost_dd[_js_edge_id]['igraph_edge_id']}`;
            //let js_edge_attr = edges.get(_edge_id);  
            let js_edge_attr = edges.get({
              filter: function (item) {
                return (item.id == _edge_id.toString());
              }
              });
          }
                    
          if (js_edge_attr) {
            Object.assign(js_edge_attr, {label: 'changed', font: {align: 'horizontal'}});
            arr.push(js_edge_attr);
            }
          }
      }
    data.edges.update(arr);
  }
// #123#################

// #456################
function ValidateIPaddress(ipaddress) {  
  if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipaddress)) {  
    return (true)  
  }  
  return (false)  
}  

function resetAllNodes() {
  // not used
  nodes.clear();
  edges.clear();
  //nodes.add({{nodes_attr_dd_in_ll|tojson}});
  //edges.add({{edges_attr_dd_in_ll|tojson}});
  nodes.add(nodes_attr_dd_in_ll);
  edges.add(edges_attr_dd_in_ll);
}

function resetAllNodesStabilize() {
  // not used
  resetAllNodes();
  network.stabilize();
  // clear old description about SPT paths
  add_spt_description(Array(), clear=true);
  // clear old description
  add_backup_path_description(Array(), clear=true);
  // clear deleted edges
  removed_edge_id_from_spt_path_ll_in_ll = Array();
  // clear warning message if it is
  document.getElementById('node_failure_prediction_description').innerHTML = '';
  hide('node_failure_prediction_description');
}
function ClearPaintedGraph() {
  // remove color and comment attributes from edges and nodes. Do not clear removed edges list
  // get all painted edges
  var painted_edges_id_w_comments_ll = Array();
  var reseted_nodes_ll = Array();

  var painted_edges_w_comments = edges.get({
      filter: function (item) {
        return (item.comment);
      }
    });
  // get all painted nodes
  var painted_nodes_attr_ll = nodes.get({
      filter: function (item) {
        //return (item.comment == "updown_traffic_node");
        return (item.color);
      }
    });
  // prepare edges ID list
  for (var n in painted_edges_w_comments) {
    edge_attr = painted_edges_w_comments[n];
    painted_edges_id_w_comments_ll.push(edge_attr.id);
  }
  // reset color and comment property in node
  for (var n in painted_nodes_attr_ll) {
    node_attr = painted_nodes_attr_ll[n];
    node_attr.color = options.nodes.color;
    delete node_attr['comment']
    delete node_attr['value'] // value is set in Heatmap view
    node_attr.size = options.nodes.size;
    reseted_nodes_ll.push(node_attr);
  }
  // reset property on selected edges
  data.edges.clear(painted_edges_id_w_comments_ll);
  // old method with refresh page data.edges.add({{edges_attr_dd_in_ll|tojson}});
  data.edges.add(edges_attr_dd_in_ll);

  // if clear labels button is enabled - clear it
  if (elementExists("hideLinkCostBtn") && document.getElementById('hideLinkCostBtn').checked == false) {
    mark_all_edges_for_dyn_filtering(conf={"labelFrom": "","labelTo": ""})
  }
  nodes.update(reseted_nodes_ll);
  console.log('Clearing the Graph has been finished...')
}
function ResetGraph_and_Variables(for_ospfwatcher = false) {
  if (!is_network_view) {
    // clear graph from color
    ClearPaintedGraph();
    // reset variables

    if (!for_ospfwatcher) {
      // clear old warning how to use SPT
      add_spt_warning_description(clear=true);

      // clear old description about SPT paths
      add_spt_description(Array(), clear=true);
      // clear old description
      add_backup_path_description(Array(), clear=true);
      // clear deleted edges
      removed_edge_id_from_spt_path_ll_in_ll = Array();
      // clear warning message if it is
      document.getElementById('node_failure_prediction_description').innerHTML = ''
      hide('node_failure_prediction_description');
    }
    // this array keep deleted edges as Node names ll for the backend in order to find this edge in igraph
    removed_edge_as_src_dst_node_name_ll = Array();
    // this array keep deleted edges as IDs of JS Graph in order to mark it as deleted
    removed_edge_ids_ll = Array();
    removed_edge_ids_set = new Set();
    //
    removed_js_edge_ids_ll = Array();
    removed_js_edge_ids_set = new Set();
    // SPT src and dst from right-clicked button
    spt_src_node = false;
    spt_dst_node = false;
    mst_node_id = false;
    //spt_src_node_ospf_plan = spt_dst_node_ospf_plan = false; // break spt calculation
    // Used for changed ospf link cost
    changed_edge_cost_dd = {};
    // Used for marking changes edges as `changed`
    changed_js_edge_cost_dd = {};

    // activate physics again
    //network.setOptions( { physics: true }); //it's not needed because button is implemented
  }
  else {
    is_network_view = false; // global var has to be set to False before upload_ospf_lsdb, because this function run ResetGraph_and_Variables once again
    upload_ospf_lsdb();
  }
}
// #456################

// #789###############
function _pressed_button_name() {
  var pressed_button_ll = document.querySelectorAll("input[name=graph-view-or-reaction-options].active"); //Genereal View, Network reaction
  let pressed_button = '';
  // if some button has been activated - un-activate it
  if (pressed_button_ll && pressed_button_ll.length > 0) {
    pressed_button = pressed_button_ll[0].id; // GeneralView, NetworkReactionOnFailure
  }
  else {
    // if no button pressed - GeneralView should be pressed by default
    load_graph_buttonOnClick();
    return 'None'; // None is used for monitoring page when no buttons on a page
  }
  return pressed_button
}
function print_element_descriptions_NetworkReaction () {
  let content = '<blockquote class="blockquote text-center">';
  content += '<p class="mb-0">Simulate a link or router shutdown. Look at traffic flow around failed link or router</p>';
  content += '<footer class="blockquote-footer">Simulate a link failure just clicking on a link <a class="badge badge-info" href="/how-to#ospf-network-reaction-on-a-link-failure">example</a></footer>';
  content += '<footer class="blockquote-footer">Simulate a router failure through righted-click menu <a class="badge badge-info" href="/how-to#ospf-network-reaction-on-a-node-failure">example</a></footer>';
  content += '<footer class="blockquote-footer">Network reaction on ospf edge cost changes on the fly (right-clicked edge menu) <a class="badge badge-info" href="/how-to#ospf-network-reaction-on-link-cost-change">example</a></footer>';
  content += '</blockquote>';
  // Mark all DR neigbors as deleted if one of his neighbor marked as deleted or not
  content += '<div class="form-group form-check">';
	content += '<input type="checkbox" class="form-check-input" name="do_include_all_shared_media_neighbors" id="do_include_all_shared_media_neighbors" checked>';
	content += '<label style="background-color:#ff9a00;" class="form-check-label" for="do_include_all_shared_media_neighbors">Mark all shared media links (which have common DR) as deleted<a class="badge badge-info" href="/how-to#ospf-network-reaction-on-a-link-failure-dr-enabled"> example</a></label>';
  content += '</div>';
  show('description_elem'); // change display settings in order to see text
  document.getElementById('description_elem').innerHTML = content; 
}

function display_graph_statistics() {
    if (typeof graph_id === 'undefined' || !graph_id) {
        console.error("Graph ID not available");
        return;
    }
    
    $.ajax({
        url: "/get_graph_statistics",
        method: "POST",
        data: {"graph_id": graph_id},
        success: function(response) {
            let stats = response.statistics;
            let score = response.score;
            
            let content = '<div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap;">';
            
            // Left side: Statistics
            content += '<div style="flex: 1; min-width: 250px; max-width: 100%;">';
            content += '<h5>Graph Statistics</h5>';
            content += '<table class="table table-sm table-borderless" style="margin-bottom: 0;">';
            
            // Protocol field
            if (stats.protocol) {
                content += '<tr><td><strong>Protocol:</strong></td><td>' + stats.protocol + '</td></tr>';
            }
            
            // Watcher name field
            if (stats.watcher_name) {
                content += '<tr><td><strong>Watcher:</strong></td><td>' + stats.watcher_name + '</td></tr>';
            } else if (stats.is_from_watcher === false) {
                content += '<tr><td><strong>Watcher:</strong></td><td><span style="color: #6c757d;">Not monitored</span></td></tr>';
            }
            
            // Nodes field - clickable
            content += '<tr><td><strong>Nodes:</strong></td><td>';
            content += '<details id="nodes_details">';
            content += '<summary style="cursor: pointer; color: #007bff; text-decoration: underline;">' + stats.nodes + '</summary>';
            content += '<div id="nodes_table_container"></div>';
            content += '</details></td></tr>';
            
            content += '<tr><td><strong>Edges:</strong></td><td>' + stats.edges + '</td></tr>';
            
            // Subnets field - clickable
            let subnetText = stats.networks;
            if (stats.network_entries && stats.network_entries !== stats.networks) {
                subnetText = stats.networks + ' unique (' + stats.network_entries + ' entries)';
            }
            content += '<tr><td><strong>Subnets:</strong></td><td>';
            content += '<details id="subnets_details">';
            content += '<summary style="cursor: pointer; color: #007bff; text-decoration: underline;">' + subnetText + '</summary>';
            content += '<div id="subnets_table_container"></div>';
            content += '</details></td></tr>';
            
            // Backuped field - clickable
            content += '<tr><td><strong>Backuped:</strong></td><td>';
            content += '<details id="backuped_details">';
            content += '<summary style="cursor: pointer; color: #007bff; text-decoration: underline;"><span style="color: green;">' + stats.backuped_networks + '</span></summary>';
            content += '<div id="backuped_table_container"></div>';
            content += '</details></td></tr>';
            
            // Non Backuped field - clickable
            content += '<tr><td><strong>Non backuped:</strong></td><td>';
            content += '<details id="non_backuped_details">';
            content += '<summary style="cursor: pointer; color: #007bff; text-decoration: underline;"><span style="color: red;">' + stats.non_backuped_networks + '</span></summary>';
            content += '<div id="non_backuped_table_container"></div>';
            content += '</details></td></tr>';
            
            // Areas field - clickable (if areas > 0)
            if (stats.areas > 0) {
                content += '<tr><td><strong>Areas:</strong></td><td>';
                content += '<details id="areas_details">';
                content += '<summary style="cursor: pointer; color: #007bff; text-decoration: underline;">' + stats.areas + '</summary>';
                content += '<div id="areas_table_container"></div>';
                content += '</details></td></tr>';
            }
            content += '</table>';
            content += '</div>';
            
            // Right side: Network Score (min-width: 0 allows flex item to shrink so content wraps inside)
            content += '<div style="flex: 1; min-width: 0; max-width: 100%; border-left: 2px solid #ddd; padding-left: 20px;">';
            content += '<h5>Network Score: ' + score.total + '/' + score.max + '</h5>';
            
            // Score bar
            let scoreColor = score.percentage >= 80 ? 'success' : (score.percentage >= 60 ? 'warning' : 'danger');
            content += '<div class="progress" style="height: 30px; margin-bottom: 15px;">';
            content += '<div class="progress-bar bg-' + scoreColor + '" role="progressbar" style="width: ' + score.percentage + '%;" aria-valuenow="' + score.total + '" aria-valuemin="0" aria-valuemax="' + score.max + '">';
            content += score.percentage.toFixed(0) + '%';
            content += '</div></div>';
            
            // Score details with Pass/Failed and advice
            content += '<div style="max-height: 300px; overflow-y: auto;">';
            score.details.forEach(function(detail) {
                let statusClass = detail.passed ? 'success' : 'danger';
                let statusText = detail.passed ? 'Pass' : 'Failed';
                let statusIcon = detail.passed ? '✓' : '✗';
                let borderColor = detail.passed ? '#28a745' : '#dc3545';
                
                content += '<div style="margin-bottom: 10px; padding: 8px; border-left: 3px solid ' + borderColor + '; background-color: #f8f9fa;">';
                content += '<strong>' + statusIcon + ' ' + statusText + ':</strong> ' + detail.message;
                
                if (detail.advice && !detail.passed) {
                    content += '<br><small style="color: #6c757d; font-style: italic; display: block; word-wrap: break-word; overflow-wrap: break-word;">💡 ' + detail.advice + '</small>';
                }
                content += '</div>';
            });
            content += '</div>';
            content += '</div>';
            
            content += '</div>';
            
            // Append statistics below instructions in description_elem (with collapsible section)
            let existingContent = document.getElementById('description_elem').innerHTML;
            let scoreText = score.total + '/' + score.max + ' (' + score.percentage.toFixed(0) + '%)';
            let scoreColorHex = score.percentage >= 80 ? '#28a745' : (score.percentage >= 60 ? '#ffc107' : '#dc3545');
            let statisticsSection = '<details style="margin-top: 20px;"><summary style="cursor: pointer; font-weight: bold; padding: 10px; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px;">📊 Network Statistics & Score: <span style="color: ' + scoreColorHex + '; font-weight: bold;">' + scoreText + '</span></summary><div style="padding: 15px 0;">' + content + '</div></details>';
            let separator = existingContent ? '' : '';
            document.getElementById('description_elem').innerHTML = existingContent + separator + statisticsSection;
            
            // Attach event listeners for clickable fields
            attach_statistics_details_listeners();
        },
        error: function(xhr, status, error) {
            console.error("Error fetching graph statistics:", error);
            // Show error message
            show('description_elem');
            document.getElementById('description_elem').innerHTML = '<div class="alert alert-warning">Unable to load graph statistics. Please ensure a graph is loaded.</div>';
        }
    });
}

function print_element_descriptions_GeneralView (with_heatmap = false) {
  let content = '<blockquote class="blockquote text-center">';
  content += '<p class="mb-0">Build the shortests paths, find backup paths.</p>';
  content += '<footer class="blockquote-footer">Build the shortest path from source node (router) to the destination (right-clicked node menu) <a class="badge badge-info" href="/how-to#how-to-build-ospf-the-shortest-path">example</a></footer>';
  content += '<footer class="blockquote-footer">Simulate a link failure along the shortest paths and find backup paths (click on colored edge) <a class="badge badge-info" href="/how-to#ospf-backup-path">example</a></footer>';
  content += '<footer class="blockquote-footer">Find a node on the network graph by selecting the node in "Find node by RID/IP" dropdown list <a class="badge badge-info" href="/how-to#ospf-network-termination-device">example</a></footer>';
  content += '<footer class="blockquote-footer">Shortest path rebuilding by changing ospf cost on the fly (right-clicked edge menu) <a class="badge badge-info" href="/how-to#change-ospf-edge-cost-on-the-fly">example</a></footer>';
  if (with_heatmap) {
    content += '<footer class="blockquote-footer">Size of node is correlated with a number of backuped (green)/ not-backuped (red) stub networks</footer>';
  }
  content += '</blockquote>';
  
  show('description_elem');
  document.getElementById('description_elem').innerHTML = content;
  
  // Load and display statistics (will append below instructions)
  display_graph_statistics();
}

  // var custom_menu_container = document.getElementById('toggled_buttons');
  // custom_menu_container.addEventListener('click', onClick);
  
  function onClick (event) {
    //var properties = timeline.getEventProperties(event);
    // properties contains things like node id, group, x, y, time, etc.
    //console.log('button click properties:',event);
    //console.log('custom_menu_container:',custom_menu_container);

    var pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure
    document.getElementById('description_elem').innerHTML = '';
    hide('description_elem');
    // we don't wont that Graph with SPT and backup paths will be on Network reaction Tab
    //ResetEdgeAttr();
    ResetGraph_and_Variables();
  }

function show_focused_node(nodeId)
  {
  // get selected focused node
    // var nodeId = elm.value;
    if (ValidateIPaddress(nodeId)) 
    {
      //statusUpdateSpan = document.getElementById('statusUpdate');
      color_nodes([nodeId], {size: 10, color: '#c8ff00', 'comment': 'focused_node'});
      var options = {
        scale: 2.0,
        animation: true // default duration is 1000ms and default easingFunction is easeInOutQuad.
        };
      network.focus(nodeId, options);
      //statusUpdateSpan.innerHTML = 'Focusing on node: ' + nodeId;
    }
    else {console.log('invalid ip', nodeId)}
}
  function focused_src_node(elm)
    {
      // clear painted SPT paths
      var is_with_spt_path_on_graph = edges.get({
        filter: function (item) {return ( (item.comment == 'spt_path_edge') || (item.comment == 'backup_path_edge') );}
      });
      if (is_with_spt_path_on_graph) {console.log('CLEAR GRAPH', is_with_spt_path_on_graph); ClearPaintedGraph();}
      // get either node_id looks like ip address, or network
      //var nodeId = elm.value;
      var nodeId = elm.value;
      if (nodeNameToNodeRidMap[nodeId]) {
        nodeId = nodeNameToNodeRidMap[nodeId]
      }
      /*
      if (nodeId_or_net.includes("/")) {
        // stub_net_10.0.0.0/16. take only subnets
        let stub_net = nodeId_or_net;
        // THE FUNCTION FOR GETTING NODE ID
        var nodeId = get_term_node_id_by_network(stub_net);
      }
      else {
        var nodeId = nodeId_or_net;
      }
      */
      if (ValidateIPaddress(nodeId)) 
      {
        // get selected focused node
        show_focused_node(nodeId);
        // try to build SPT path
        spt_src_node = nodeId; accept_node_for_spt_return_spt();
      }
    }
  function focused_dst_node(elm)
    {
    // clear painted SPT paths
    var is_with_spt_path_on_graph = edges.get({
        filter: function (item) {return (item.comment);}
      });
    if (is_with_spt_path_on_graph) {console.log('CLEAR GRAPH', is_with_spt_path_on_graph); ClearPaintedGraph();}
    //var nodeId = elm.value;
    var nodeId = elm.value;
    if (nodeNameToNodeRidMap[nodeId]) {
      nodeId = nodeNameToNodeRidMap[nodeId]
    }
    /*
    if (nodeId_or_net.includes("/")) {
      // stub_net_10.0.0.0/16. take only subnets
      let stub_net = nodeId_or_net;
      // THE FUNCTION FOR GETTING NODE ID
      var nodeId = get_term_node_id_by_network(stub_net);
    }
    else {
      var nodeId = nodeId_or_net;
    }
    */
    if (ValidateIPaddress(nodeId)) 
    {
      // try to build SPT path
      spt_dst_node = nodeId; accept_node_for_spt_return_spt();
    }
    }
  function build_spt_from_button(elm)
    {
      spt_src_node = document.getElementById('src_node_ip').value;
      spt_dst_node = document.getElementById('dst_node_ip').value;
      accept_node_for_spt_return_spt();
    }
// #789###############
function show_spt_dropdown_menu() {
  let content = '<div class="d-flex flex-row bd-highlight mb-3">';
  content += '<div class="p-2 bd-highlight">';
  content += 'Find node by RID/IP. Find network: <input type="text" list="src_nodes" name="src_node" id="src_node_ip" onchange="focused_src_node(this)">';
  content += '<datalist id="src_nodes">';
  content += '<option></option>';
  content += '<option>--- Routers ID ---</option>';
  for (var n in nodes_attr_dd_in_ll) {
    let node_attr_dd = nodes_attr_dd_in_ll[n];
    // add name of device to the dropdown list
    // Use systemid if available, otherwise fall back to name/id
    let systemid = node_attr_dd['systemid'] || node_attr_dd['name'] || node_attr_dd['id'];
    content += `<option value="${systemid}">` + node_attr_dd['label'] + '</option>';
  }

  content += '<option>--- Networks ---</option>';
  for (var stub_net_i in stub_nets_attr_dd_ll) {
    let stub_net_attr_dd = stub_nets_attr_dd_ll[stub_net_i]; // {'10.10.10.0/25': '1.1.1.1'} or 'RTR-A' for ISIS
    let stub_net = Object.keys(stub_net_attr_dd)[0];
    content += `<option value="${stub_net_attr_dd[stub_net]}">` + stub_net + '</option>';
    }
  content += '</datalist>';
  content += '</div>';
  
  content += '<div class="p-2 bd-highlight">';
  content += 'To: <input type="text" list="dst_nodes" name="dst_node" id="dst_node_ip" onchange="focused_dst_node(this)">';
  content += '<datalist id="dst_nodes">';
  content += '<option></option>';
  content += '<option>Routers ID</option>';
  for (var n in nodes_attr_dd_in_ll) {
    // add name of device to the dropdown list
    let node_attr_dd = nodes_attr_dd_in_ll[n];
    // OSPF nodes may not have systemid; fall back to name/id to avoid "undefined" values in destination field.
    let systemid = node_attr_dd['systemid'] || node_attr_dd['name'] || node_attr_dd['id'];
    content += `<option value="${systemid}">` + node_attr_dd['label'] + '</option>';
    }
  content += '<option>Networks</option>';
  for (var stub_net_i in stub_nets_attr_dd_ll) {
    let stub_net_attr_dd = stub_nets_attr_dd_ll[stub_net_i]; // {'10.10.10.0/25': '1.1.1.1'} or 'RTR-A' for ISIS
    let stub_net = Object.keys(stub_net_attr_dd)[0];
    content += `<option value="${stub_net_attr_dd[stub_net]}">` + stub_net + '</option>';
    }
  content += '</datalist>';
  content += '</div>';

  content += '<div class="p-2 d-inline-flex bd-highlight ml-4"></div>';
  content += '<input type="submit" value="Build a path" class="btn btn-primary" onclick = "build_spt_from_button()">';
  content += '</div>';

  content += '</div>';
  
  // For MST checkbox
  content += '<div class="form-group form-check" id="general_view_button_options_div">';
	content += '<input type="checkbox" class="form-check-input" name="do_print_MST" id="do_print_MST">';
	content += '<label class="form-check-label" for="do_print_MST">Print <strong>Minimum Shortest Tree (MST)</strong> for the node. If MST is enabled. Show all paths on the fly, since hover the node. Show all </label>';
  content += '</div>';
  // dynamically show all paths To or From hovered node
  //content += '<p>If MST is enabled. Show all paths on the fly, since hover the node. Show all </p>';
  content += '<div class="form-check form-check-inline">';
  content += '<input class="form-check-input" type="radio" name="inlineRadioOptions" id="hover_node_MST_in" value="hover_node_mst_in">';
  content += '<label class="form-check-label" for="hover_node_MST_in"><strong>Incoming</strong> paths to hovered node</label>';
  content += '</div>';
  content += '<div class="form-check form-check-inline">';
  content += '<input class="form-check-input" type="radio" name="inlineRadioOptions" id="hover_node_MST_from" value="hover_node_mst_from">';
  content += '<label class="form-check-label" for="hover_node_MST_from"><strong>Outgoing</strong> paths From hovered node</label>';
  content += '</div>';
  content += '<div class="form-check form-check-inline">';
  content += '<input class="form-check-input" type="radio" name="inlineRadioOptions" id="hover_node_MST_InOutDiff" value="hover_node_mst_InOutDiff">';
  content += '<label class="form-check-label" for="hover_node_MST_InOutDiff"><strong>Diff</strong> IN and OUT paths From hovered node</label>';
  content += '</div>';
  content += '<div id="other_options_below_mst">';
  
  show('spt_dropdown_menu'); // change display settings in order to see text
  if (document.getElementById('spt_dropdown_menu') !== null) {
  document.getElementById('spt_dropdown_menu').innerHTML = content;}
  
  // three button in one row: show central nodes, the most loaded nodes, the most loaded edges

  //show central nodes
  var new_row = document.createElement("div");
  new_row.classList.add( "d-flex", "flex-row", "bd-highlight", "mb-3" );
  var new_label = document.createElement("label");
  new_label.classList.add( "p-2", "toggler-wrapper", "style-11" );
  var new_input = document.createElement("input");
  new_input.type = "checkbox"
  new_input.value = "networkReactionOnAppliedChanges"
  new_input.id = "showCentralNodesInput"
  var new_slider = document.createElement("div");
  new_slider.classList.add( "toggler-slider" );
  var new_knob = document.createElement("div");
  new_knob.classList.add( "toggler-knob" );
  var btn_name = document.createElement("div");
  btn_name.innerText = "Central nodes"
  
  new_row.appendChild(new_label)
  new_label.appendChild(new_input)
  new_label.appendChild(new_slider)
  new_slider.appendChild(new_knob)
  new_row.appendChild(btn_name)
  
  // the most loaded nodes
  var parent_btn_group = document.createElement("div");
  parent_btn_group.classList.add( "btn-group", "mr-5" );

  var most_loaded_nodes_div = document.createElement("div");
  most_loaded_nodes_div.classList.add( "input-group", "input-group-sm", "mb-3" );
  var most_loaded_nodes_select = document.createElement("select");
  most_loaded_nodes_select.classList.add( "custom-select", "form-control" );
  most_loaded_nodes_select.style = "padding: 0.25rem 1.5rem"
  most_loaded_nodes_select.id = "most_loaded_nodes_slct_id"
  most_loaded_nodes_select.setAttribute('aria-describedby', "inputGroup-sizing-sm");

  //Create and append the options
  for (var i = 1; i < 6; i++) {
      var option = document.createElement("option");
      option.value = i;
      option.text = i;
      most_loaded_nodes_select.appendChild(option);
  }
  var most_loaded_nodes_btn_div = document.createElement("div");
  most_loaded_nodes_btn_div.classList.add( "input-group-append" );
  var most_loaded_nodes_btn = document.createElement("button");
  most_loaded_nodes_btn.classList.add( "btn", "btn-outline-secondary", "form-control" );
  most_loaded_nodes_btn.type = "button"
  most_loaded_nodes_btn.textContent = "Most loaded nodes"
  most_loaded_nodes_btn.setAttribute('onclick', "get_the_most_loaded_graph_elements()");
  most_loaded_nodes_btn_div.appendChild(most_loaded_nodes_btn)

  most_loaded_nodes_div.appendChild(most_loaded_nodes_select)
  most_loaded_nodes_div.appendChild(most_loaded_nodes_btn_div)
  parent_btn_group.appendChild(most_loaded_nodes_div)

  // the most loaded edges
  var most_loaded_edges_div = document.createElement("div");
  most_loaded_edges_div.classList.add( "input-group", "input-group-sm", "mb-3" );
  var most_loaded_edges_select = document.createElement("select");
  most_loaded_edges_select.classList.add( "custom-select", "form-control" );
  most_loaded_edges_select.style = "padding: 0.25rem 1.5rem"
  most_loaded_edges_select.id = "most_loaded_edges_slct_id"
  most_loaded_edges_select.setAttribute('aria-describedby', "inputGroup-sizing-sm");

  //Create and append the options
  for (var i = 1; i < 6; i++) {
      var option = document.createElement("option");
      option.value = i;
      option.text = i;
      most_loaded_edges_select.appendChild(option);
  }
  var most_loaded_edges_btn_div = document.createElement("div");
  most_loaded_edges_btn_div.classList.add( "input-group-append" );
  var most_loaded_edges_btn = document.createElement("button");
  most_loaded_edges_btn.classList.add( "btn", "btn-outline-secondary", "form-control" );
  most_loaded_edges_btn.type = "button"
  most_loaded_edges_btn.textContent = "Most loaded edges"
  most_loaded_edges_btn.setAttribute('onclick', "get_the_most_loaded_edges()");
  most_loaded_edges_btn_div.appendChild(most_loaded_edges_btn)

  most_loaded_edges_div.appendChild(most_loaded_edges_select)
  most_loaded_edges_div.appendChild(most_loaded_edges_btn_div)
  parent_btn_group.appendChild(most_loaded_edges_div)
  
  // Single point of failure
  var new_spof_label = document.createElement("label");
  new_spof_label.classList.add( "p-2", "toggler-wrapper", "style-11" );
  var new_spof_input = document.createElement("input");
  new_spof_input.type = "checkbox"
  new_spof_input.id = "showSinglePointOfFailureNodesInput"
  new_spof_input.onchange = function() {
    if ($(this).is(':checked')) {
      get_single_point_of_failure_node_ll();
    } else {
      if (typeof single_point_of_failure_node_name_ll !== 'undefined') {
        reset_color_nodes(single_point_of_failure_node_name_ll);
      }
    }
  }
  var new_spof_slider = document.createElement("div");
  new_spof_slider.classList.add( "toggler-slider" );
  var new_spof_knob = document.createElement("div");
  new_spof_knob.classList.add( "toggler-knob" );
  var btn_name = document.createElement("div");
  btn_name.innerText = "Single point of failure nodes"
  
  new_spof_label.appendChild(new_spof_input)
  new_spof_label.appendChild(new_spof_slider)
  new_spof_slider.appendChild(new_spof_knob)

  // Fault tolerant
  var new_ft_label = document.createElement("label");
  new_ft_label.classList.add( "p-2", "toggler-wrapper", "style-11" );
  var new_ft_input = document.createElement("input");
  new_ft_input.type = "checkbox"
  new_ft_input.id = "showFaultTolerantNodesInput"
  new_ft_input.onchange = function() {
    if ($(this).is(':checked')) {
      get_fault_tolerant_node_ll();
    } else {
      if (typeof fault_tolerant_node_name_ll !== 'undefined') {
        reset_color_nodes(fault_tolerant_node_name_ll);
      }
    }
  }
  var new_ft_slider = document.createElement("div");
  new_ft_slider.classList.add( "toggler-slider" );
  var new_ft_knob = document.createElement("div");
  new_ft_knob.classList.add( "toggler-knob" );
  var ft_btn_name = document.createElement("div");
  ft_btn_name.innerText = "Fault tolerant nodes"
  
  new_ft_label.appendChild(new_ft_input)
  new_ft_label.appendChild(new_ft_slider)
  new_ft_slider.appendChild(new_ft_knob)

  //merge all buttons togather
  new_row.appendChild(parent_btn_group)
  // add Single Point of failure button
  new_row.appendChild(new_spof_label)
  new_row.appendChild(btn_name)
  // add Fault tolerant failure button
  new_row.appendChild(new_ft_label)
  new_row.appendChild(ft_btn_name)

  document.getElementById("other_options_below_mst").appendChild(new_row);
  let showCentralNodesInput = document.getElementById("showCentralNodesInput")
  showCentralNodesInput.addEventListener('change', function() {
    if ($(this).is(':checked')) {
      get_central_nodes();
    } else {
      if (typeof central_node_names_ll !== 'undefined') {
        reset_color_nodes(central_node_names_ll);
      }
    }
  });
}

function add_radio_button_listener() {
  /*
  Once we unchecked `Print Minimum Shortest Tree (MST) for the node` we should clear all radion buttons
  */
  var checkbox = document.getElementById("do_print_MST");

  checkbox.addEventListener('change', function() {
    if (!$(this).is(':checked')) {
      $('input[name=inlineRadioOptions]').prop('checked', false);
    }
  });
}
function load_graph_buttonOnClick () {
  $( document ).ready(function() {
      if (typeof(GeneralView) !== "undefined" && GeneralView != null) {
        $(GeneralView).button('toggle');
      }
    })
}

  // make the clusters
  function makeClusters(scale) {
    var clusterOptionsByData = {
        processProperties: function (clusterOptions, childNodes) {
            clusterIndex = clusterIndex + 1;
            var childrenCount = 0;
            for (var i = 0; i < childNodes.length; i++) {
                childrenCount += childNodes[i].childrenCount || 1;
            }
            clusterOptions.childrenCount = childrenCount;
            clusterOptions.label = "# " + childrenCount + "";
            clusterOptions.font = {size: childrenCount*5+30}
            clusterOptions.id = 'cluster:' + clusterIndex;
            clusters.push({id:'cluster:' + clusterIndex, scale:scale});
            return clusterOptions;
        },
        clusterNodeProperties: {borderWidth: 3, shape: 'database', font: {size: 30}}
    }
    network.clusterOutliers(clusterOptionsByData);
    // since we use the scale as a unique identifier, we do NOT want to fit after the stabilization
    network.setOptions({physics:{stabilization:{fit: false}}});
    network.stabilize();
};

// open them back up!
function openClusters(scale) {
    var newClusters = [];
    var declustered = false;
    for (var i = 0; i < clusters.length; i++) {
        if (clusters[i].scale < scale) {
            network.openCluster(clusters[i].id);
            lastClusterZoomLevel = scale;
            declustered = true;
        }
        else {
            newClusters.push(clusters[i])
        }
    }
    clusters = newClusters;
    if (declustered === true) {
        // since we use the scale as a unique identifier, we do NOT want to fit after the stabilization
        network.setOptions({physics:{stabilization:{fit: false}}});
        network.stabilize();
    }
};


function do_fill_yaml_text(yaml_file_str) {
  let yaml_text_element = document.getElementById("yamlTextAreaStr");
  yaml_text_element.value = yaml_file_str;
}

function is_yaml_diagram_page() {
  const myIframe = document.getElementById('myIframe');
  if (myIframe != null) {
    return true
  }
  else {
    return false
  }
}
function get_elem_position(event) {
  /* Return X, Y for clicked mouse element on upload-lsdb page or inside Yaml */
  const myIframe = document.getElementById('myIframe');
  if (myIframe != null) {
    const rect = myIframe.getBoundingClientRect();
    var x = event.pageX - rect.left;
    var y = event.pageY - rect.top;
  }
  else {
    var x = event.pageX;
    var y = event.pageY;
  }
  return {'x': x, 'y': y}
}

function scrollToNetworkCenter() {
  const container = document.getElementById('mynetwork');
  const rect = container.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

  const containerCenterY = rect.top + scrollTop + (rect.height / 2);
  const viewportHeight = window.innerHeight;

  window.scrollTo({
    top: containerCenterY - viewportHeight / 2,
    behavior: 'smooth'
  });
}

function toggleFullscreen() {
  const container = document.getElementById('mynetwork');
  const button = document.getElementById('networkFullScreenBtn');

  const newHeight = isFullscreen ? 900 : window.innerHeight * 0.9;
  const buttonLabel = isFullscreen ? 'Full Screen ⛶' : 'Shrink 🔽';

  container.style.height = `${newHeight}px`;
  network.setOptions({ height: `${newHeight}px` });
  network.redraw();

  button.value = buttonLabel;
  isFullscreen = !isFullscreen;

  // Scroll after resizing
  setTimeout(scrollToNetworkCenter, 300);
}

function init_visjs_graph(nodes_attr_dd_in_ll, edges_attr_dd_in_ll, graph_physics_scale_settings = {}) {

    // create a network
    container = document.getElementById('mynetwork');
    /*
    nodes_attr_dd_in_ll.push({id: 1000, x: x, y: y, label: 'Internet', group: 'internet', value: 1, fixed: true, physics:false});
    nodes_attr_dd_in_ll.push({id: 1001, x: x, y: y + step, label: 'Switch', group: 'switch', value: 1, fixed: true,  physics:false});
    nodes_attr_dd_in_ll.push({id: 1002, x: x, y: y + 2 * step, label: 'Server', group: 'server', value: 1, fixed: true,  physics:false});
    nodes_attr_dd_in_ll.push({id: 1003, x: x, y: y + 3 * step, label: 'Computer', group: 'desktop', value: 1, fixed: true,  physics:false});
    nodes_attr_dd_in_ll.push({id: 1004, x: x, y: y + 4 * step, label: 'Smartphone', group: 'mobile', value: 1, fixed: true,  physics:false});
    */
    //nodes_attr_dd_in_ll.push({ id: 2, font: { multi: true }, label: '<b>This</b> is a\n<i>default</i> <b><i>multi-</i>font</b> <code>label</code>', x: -40, y: -40 });
    nodes = new vis.DataSet(nodes_attr_dd_in_ll);

    // create an array with edges
    /*
    var edges = new vis.DataSet([
        {'from': '10.0.0.1', 'to': '10.0.0.3'},
        {'from': '10.0.0.1', 'to': '10.0.0.2'},
        {'from': '10.0.0.2', 'to': '10.0.0.4', 'weight': 1000, title: 'Cost: 10\nCost: 20'},
        {from: '10.0.0.2', to: '10.0.0.5', color: 'blue', dashes:false, arrows: {to: { enabled: true, type: 'vee'}}, background:{ enabled: true, color: 'rgba(111,111,111,0.5)', size:10, dashes: [20,10], arrows: {to: { enabled: true, type: 'arrow'}}}}
    ]);*/
    edges = new vis.DataSet(edges_attr_dd_in_ll);

    // provide the data in the vis format
    data = {
        nodes: nodes,
        edges: edges
    };
    // https://stackoverflow.com/questions/30045279/vis-js-graph-not-stabilizing-even-after-hours
    options = {
      //height: '900px', // 900px
      height: '900px',
      width: '90%',
      configure: {enabled: false},
      //physics: false, doesn't work
      //physics: {barnesHut: {springLength: 100}},
      nodes: {
        color: 'red',
        size: 7,
        shape: 'dot',
        shapeProperties: {
        interpolation: false    // 'true' for intensive zooming
      }
      },
      edges: {
        color: 'black',
        width: 1,
        smooth: {"enabled": false},
        dashes: false,
        font: {size: 12},
        scaling:{
          min: 6,
          max: 15,
          customScalingFunction: function (min,max,total,value) {
            if (max === min) {
              return 0.5;
            }
            else {
              var scale = 1 / (max - min);
              var returned_val =  Math.max(0,(value - min)*scale);
              // console.log('scale value, receivedvalue', returned_val, value);
              return returned_val;
            }
          }},
        arrows:{to: {scaleFactor : 0.2}, from: {scaleFactor : 0.2}},
        arrowStrikethrough: false
      },
      layout: { randomSeed: 2 }, // This means the layout will be the same every time the nodes are settled.
      interaction: {
        keyboard: {"enabled": false}, // "-" zoom out,clash with Yaml syntax
        hover:true,
        navigationButtons: true,
        selectConnectedEdges: false
      },
      physics: {
        barnesHut: {
          gravitationalConstant: -10000, // 14.12  -5000. with -5000 the network a little bit quicker to stabilize. It's better to sparse networks = whole network inside a window. -12000 for dense (star) topologies
          centralGravity: 0,
          springLength: 150, // 14.12 100 is better to sparse networks = whole network inside a window. 180 for dense (star) topologies
          springConstant: 0.01
        },
        minVelocity: 0.75,
        timestep: 0.30
      },
    };
    // you can extend the options like a normal JSON variable:

    if ( Object.keys(graph_physics_scale_settings).length > 0) {
      // this checks that a dictionary is not empty
      Object.assign(options, graph_physics_scale_settings);

      // update StopStartPhysics button based on saved settings. do_stop_start_physics()
      if (graph_physics_scale_settings.physics.enabled == false) {
        // physics is disabled, so change button view
        if (document.getElementById('btnStopPhysics')) {
          document.getElementById('btnStopPhysics').innerHTML = '<img src=\'/static/start_button.png\'/>Unfreeze network';
        }
      } 
    }
    
    // initialize your network!
    network = new vis.Network(container, data, options);
    // ── COLLAPSING: wire double-click expand/collapse handler ─────────────────
    if (typeof _wireCollapseDoubleClick === 'function') { _wireCollapseDoubleClick(); }
    // set values
    network.on("select", function (params) {
        // console.log('select Event:', params.nodes[0], params.pointer.DOM.x);
        var nodeId = params.nodes[0];
        network.focus(nodeId);
    });
    
    // progress bar
    if (typeof(graph_physics_scale_settings.physics) !== 'undefined' && graph_physics_scale_settings.physics.enabled == false) {
      // disabled physics doesn't have stabilization, so we do not show loading bar
    }
    else {
      show('loadingBar' );
    }
    if (document.getElementById("loadingBar") !== null) {
    document.getElementById("loadingBar").style.opacity = 1;}
    network.on("stabilizationProgress", function (params) { 
      var maxWidth = 496;
      var minWidth = 20;
      var widthFactor = params.iterations / params.total;
      var width = Math.max(minWidth, maxWidth * widthFactor);
      document.getElementById("bar").style.width = width + "px";
      document.getElementById("text").innerText =
      Math.round(widthFactor * 100) + "%";
    });
    network.once("stabilizationIterationsDone", function () {
      document.getElementById("text").innerText = "100%";
      document.getElementById("bar").style.width = "496px";
      // hide loading bar
      document.getElementById("loadingBar").style.opacity = 0;
      // really clean the dom element
      setTimeout(function () {
      document.getElementById("loadingBar").style.display = "none";
      }, 500);
      // when we hide progress bar - set progress to 0% for further use
      document.getElementById("text").innerText = "0%";
      document.getElementById("bar").style.width = "0px";
    });
    // progress bar end

    network.on("selectNode", function (params) {
        // console.log('selectNode Event:', params);

        $( 'div.PopUpFormBackupNonBackupNets' ).fadeToggle();
        //$( 'div.PopUpFormBackupNonBackupNets' ).fadeIn();

        get_node_details(graph_id, params.nodes[0]);
    });

    network.on("selectEdge", function (params) {
      var pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure
      // console.log('selectEdge Event, pressed_button', params.edges[0], pressed_button);
      //edges.setOptions(queue: true);
      var e = edges.get(params.edges[0]);
      var choosed_edge_comment = e.comment;
      // retrieve all items having a property group with value 2
      var painted_edges_w_comments = edges.get({
        filter: function (item) {
          //return (item.comment == "updown_traffic_node");
          return (item.comment);
        }
      });
      console.info('from %s, to: %s comment: %s, edge_attr:,', e.from, e.to, choosed_edge_comment, e);
      if (pressed_button == 'NetworkReactionOnFailure') {
        if (choosed_edge_comment == "updown_traffic_node")
          {/* Add calc netowrk reaction on painted edge

            removed_links_from_spt_path_ll_in_ll = Array();
            removed_edge_id_from_spt_path_ll_in_ll = Array();
          */
          ClearPaintedGraph(); // just clear color without clearing variables
          get_edge_remove_outcome(graph_id, selected_edge_attr = e);
          document.getElementById('node_failure_prediction_description').innerHTML = '';
          hide('node_failure_prediction_description');
          }
        else if (choosed_edge_comment == "deleted_edge")
          {// When press "deleted link" we come back this into the graph and will not treat it as deleted
          ClearPaintedGraph(); // just clear color without clearing variables
          get_edge_remove_outcome(graph_id, selected_edge_attr = e);
          document.getElementById('node_failure_prediction_description').innerHTML = '';
          hide('node_failure_prediction_description');
          }
        else if (typeof e.inside_ecmp_edges_ll !== 'undefined') {
            //edges.remove(e.id);
            //edges.add(e.inside_ecmp_edges_ll);
            unflat_ecmp([e.id]);
            //network.redraw();
            //network.stabilize(); // when we use stabilize - after click on edge - the graph is moved to another place ( on the center ), without such option - it stayes on the same place
          }
        else 
          {
          ClearPaintedGraph(); // when we choosed one edge - get result with a painted graph - then we choosed unpainted edge and withoud Clearing the Graph - we get additional Curvewed lines
          get_edge_remove_outcome(graph_id, selected_edge_attr = e);
          document.getElementById('node_failure_prediction_description').innerHTML = '';
          hide('node_failure_prediction_description');
          }
      }
      else if (pressed_button == "GeneralView") {
        if (choosed_edge_comment == "spt_path_edge" || choosed_edge_comment == 'backup_path_edge')
          {//reset_up_edge_stype(edges)
          let src_node = e.from;
          let dst_node = e.to;
          if (e.arrows.from) {src_node = e.to; dst_node = e.from;}
          
          get_edge_from_spt_outcome(graph_id, src_node, dst_node, e.spt_src_node, e.spt_dst_node, e.id);
          
          }
        else 
          {
          if (typeof e.inside_ecmp_edges_ll !== 'undefined') {
            //edges.remove(e.id);
            //edges.add(e.inside_ecmp_edges_ll);
            unflat_ecmp([e.id]);
            //network.redraw();
            //network.stabilize(); // when we use stabilize - after click on edge - the graph is moved to another place ( on the center ), without such option - it stayes on the same place
          }
          else {
            edges.clear();
            edges.add(edges_attr_dd_in_ll);
            removed_links_from_spt_path_ll_in_ll = Array();
            removed_edge_id_from_spt_path_ll_in_ll = Array();
            // clear old description about SPT paths
            add_spt_description(Array(), clear=true);
            // clear old description
            add_backup_path_description(Array(), clear=true);
          }
          }
      } else if (pressed_button == "None") {
        if (typeof e.inside_ecmp_edges_ll !== 'undefined') {
          unflat_ecmp([e.id]);
        }
      }
      //network.redraw()
    });
    /*
    network.on("showPopup", function (params) {
        console.log('selectNode Event:', params); document.getElementById('eventSpan').innerHTML = '<h2>showPopup event: </h2>' + JSON.stringify(params, null, 4);
    });
    network.on("hidePopup", function () {
        console.log('hidePopup Event');
    });
    
    network.on("hoverNode", function (params) {
        console.log('hoverNode Event:', params);
        //document.getElementById('eventSpan').innerHTML = '<h2>hoverNode event: </h2>' + JSON.stringify(params.node, null, 4);
        //get_node_details(graph_id, params.node);
        //console.log('result', result);
        //nodes.update({id: params.node, label: "backuped nets: " + result.backuped_nets.length + ", not_available_nets: " + result.not_available_nets.length});
    });
    */
   network.on("hoverNode", function (params) {

        pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure
        // show MST path to this hovered node if `Print Minimum Shortest Tree (MST) for the node` checkbox is enabled
        if ((pressed_button == "GeneralView") && (document.getElementById("do_print_MST") !== null && document.getElementById("do_print_MST").checked === true)) {
          // okay, show MST is enabled, but it just allows to build MST from right clicked button. We should checke that radio button is enabled too
          if (document.getElementById('hover_node_MST_in').checked) {
            ResetGraph_and_Variables();
            mst_node_id = params.node;
            accept_node_for_mst_return_mst(direction = 'IN');
          }
          if (document.getElementById('hover_node_MST_from').checked) {
            ResetGraph_and_Variables();
            mst_node_id = params.node;
            accept_node_for_mst_return_mst(direction = 'OUT');
          }
          if (document.getElementById('hover_node_MST_InOutDiff').checked) {
            ResetGraph_and_Variables();
            mst_node_id = params.node;
            accept_node_for_MstInOutDiff_return_diff();
          }
        }
    });
    network.on("hoverEdge", function (params) {
        // console.log('hoverEdge Event:', params);
        var edge_id = params.edge;
        //console.log('hoverEdge Event: EDGE TITLE', edges.get(edge_id));
        get_edge_details(graph_id, edge_id);
    });

    /*
    network.on("blurEdge", function (params) {
        console.log('blurEdge Event:', params);
        //reset_up_edge_stype(edges);
    });*/
    network.on("oncontext", function (params) {
      params.event.preventDefault();
      // console.log('oncontext Event:', params);
      //var pressed_button = document.querySelectorAll("input[name=options]:checked")[0].id; //Genereal View, Network reaction or Diff Graph
      var pressed_button = _pressed_button_name(); // GeneralView, NetworkReactionOnFailure
      var node_id = network.getNodeAt(params.pointer.DOM);
      choosed_edge_id = network.getEdgeAt(params.pointer.DOM);
      spt_choosed_node = node_id;
      node_shutdown_choosed_node_name = node_id;
      console.log('Right Clicked node ID:', node_id);
      console.log('Right Clicked edge ID:', choosed_edge_id);
      console.log('pressed_button:', pressed_button);
      if (node_id === undefined && choosed_edge_id === undefined) {
        $.ajax(alert("Node was not chosen"))
      }
      else if (pressed_button == "GeneralView") {

        if (node_id !== undefined) {
          // show menu `build spt From and To this node only if we click on node, not edge
            position_attr = get_elem_position(params.event);
            const x = position_attr.x;
            const y = position_attr.y;
            $(".custom-menu").finish().toggle(100);
            $(".custom-menu").css({
              top: y + "px",
              left: x + "px"
            });}
        }
      else if (pressed_button == "NetworkReactionOnFailure") {
        if (node_id !== undefined) {
          // right click on node, not a edge
          position_attr = get_elem_position(params.event);
          const x = position_attr.x;
          const y = position_attr.y;
          $('.network-reaction-on-failure-menu').finish().toggle(100);
          $('.network-reaction-on-failure-menu').css({
            top: y + "px",
            left: x + "px"
          });
          }
      }

      if (choosed_edge_id && node_id === undefined) {
        /*
        edge_attr = edges.get(choosed_edge_id)
        from: "10.0.0.7"
        id: "10.0.0.7_to_10.2.2.10"
        igraph_edges_id_ll: (2) [0, 3]
        title: "<p>10.0.0.7-<b>1000</b>->10.2.2.10</p><p>10.2.2.10-<b>1000</b>->10.0.0.7</p>"
        to: "10.2.2.10"
        weight: 1000
        width: 1
        */
        //console.log(edges.get(choosed_edge_id));
        let js_edge_attr;
        let choosed_js_edge_attr = edges.get(choosed_edge_id); // it could be directed painted link or general link

        let parent_js_edge = choosed_js_edge_attr.parent_edge_id;
        // if we click on painted directed link - we will have only 10.0.0.7_to_10.2.2.10_123 as edge ID. We will show menu with only one edge - we should show OSPF cost of all link
        if (typeof parent_js_edge !== 'undefined' ) {
          // we lose info about original undirected link - so we recover it from edges attr
          let edges_copy = new vis.DataSet(edges_attr_dd_in_ll);
          js_edge_attr = edges_copy.get(parent_js_edge); // it's always general link
        }
        else { js_edge_attr = choosed_js_edge_attr}

        if (js_edge_attr) {
          $( 'div.PopUpFormNewOSPFCostSet' ).fadeToggle();
          //get_edge_details_by_igraph_edge_id(js_edge_attr);
          get_edge_details_by_igraph_edge_id(js_edge_attr, choosed_js_edge_attr);
        }
      }
    });

/*
    var custom_menu_container = document.getElementById('option1_in_custom-menu');
    console.log('clicked_doc:', custom_menu_container);
    function onClick (event) {
      //var properties = timeline.getEventProperties(event);
      // properties contains things like node id, group, x, y, time, etc.
      console.log('mouseover properties:',event);
    }
    custom_menu_container.addEventListener('click', onClick);
*/
    
    // If the document is clicked somewhere
    $(document).bind("mousedown", function (e) {
        
        // If the clicked element is not the menu
        if (!$(e.target).parents(".custom-menu").length > 0) {
            
            // Hide it
            $(".custom-menu").hide(100);
        }
    });

    // If the menu element is clicked
    var that = this;
    $(".custom-menu li").off().click(function(){
        
        // This is the triggered action name
        switch($(this).attr("data-action")) {
            
            // A case for each action. Your actions here
            case "_spt_src_node": spt_src_node = spt_choosed_node; accept_node_for_spt_return_spt(); break;
            case "_spt_dst_node": spt_dst_node = spt_choosed_node; accept_node_for_spt_return_spt(); break;
            case "_mst_root_node": mst_node_id = spt_choosed_node; accept_node_for_mst_return_mst(); break;
        }
      
        // Hide it AFTER the action was triggered
        $(".custom-menu").hide(100);
      });

}

function load_networks_table(page = 1, filter_type = 'all') {
    if (typeof graph_id === 'undefined' || !graph_id) {
        console.error("Graph ID not available");
        return;
    }
    
    let containerId = 'subnets_table_container';
    if (filter_type === 'backuped_only') {
        containerId = 'backuped_table_container';
    } else if (filter_type === 'non_backuped_only') {
        containerId = 'non_backuped_table_container';
    }
    
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }
    
    // Show loading indicator
    container.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Loading...</span></div> Loading networks...</div>';
    
    $.ajax({
        url: "/get_networks_list",
        method: "POST",
        data: {
            "graph_id": graph_id,
            "page": page,
            "per_page": 20,
            "filter_type": filter_type
        },
        success: function(response) {
            let html = '<div style="margin-top: 10px;">';
            
            // Table
            html += '<table class="table table-sm table-bordered" style="font-size: 0.9em;">';
            html += '<thead class="thead-light"><tr><th>Network</th><th>Termination Points</th><th>Backup Status</th><th>Cost</th><th>Area</th></tr></thead>';
            html += '<tbody>';
            
            if (response.items && response.items.length > 0) {
                response.items.forEach(function(network) {
                    let termPoints = network.termination_points.map(function(tp) {
                        return tp.hostname + ' (' + tp.rid + ', cost: ' + tp.cost + ')';
                    }).join(', ');
                    
                    let backupStatus = network.is_backuped ? '<span style="color: green;">✓ Backuped</span>' : '<span style="color: red;">✗ Not backuped</span>';
                    
                    html += '<tr>';
                    html += '<td>' + network.subnet + '</td>';
                    html += '<td>' + termPoints + '</td>';
                    html += '<td>' + backupStatus + '</td>';
                    html += '<td>' + network.cost + '</td>';
                    html += '<td>' + network.area + '</td>';
                    html += '</tr>';
                });
            } else {
                html += '<tr><td colspan="5" class="text-center">No networks found</td></tr>';
            }
            
            html += '</tbody></table>';
            
            // Pagination controls
            if (response.pagination && response.pagination.total_pages > 1) {
                let paginationHtml = render_pagination_controls(response.pagination, filter_type, 'networks');
                html += paginationHtml;
            }
            
            // Show count
            if (response.pagination) {
                let start = (response.pagination.page - 1) * response.pagination.per_page + 1;
                let end = Math.min(start + response.pagination.per_page - 1, response.pagination.total);
                html += '<div class="text-muted" style="margin-top: 10px; font-size: 0.85em;">Showing ' + start + '-' + end + ' of ' + response.pagination.total + ' networks</div>';
            }
            
            html += '</div>';
            container.innerHTML = html;
        },
        error: function(xhr, status, error) {
            console.error("Error loading networks:", error);
            container.innerHTML = '<div class="alert alert-danger">Error loading networks. Please try again.</div>';
        }
    });
}

function load_nodes_table(page = 1) {
    if (typeof graph_id === 'undefined' || !graph_id) {
        console.error("Graph ID not available");
        return;
    }
    
    const container = document.getElementById('nodes_table_container');
    if (!container) {
        return;
    }
    
    // Show loading indicator
    container.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Loading...</span></div> Loading nodes...</div>';
    
    $.ajax({
        url: "/get_nodes_list",
        method: "POST",
        data: {
            "graph_id": graph_id,
            "page": page,
            "per_page": 50
        },
        success: function(response) {
            let html = '<div style="margin-top: 10px;">';
            
            // Table
            html += '<table class="table table-sm table-bordered" style="font-size: 0.9em;">';
            html += '<thead class="thead-light"><tr><th>RID/System ID</th><th>Hostname</th><th>Networks Count</th><th>Area(s)</th></tr></thead>';
            html += '<tbody>';
            
            if (response.items && response.items.length > 0) {
                response.items.forEach(function(node) {
                    let nodeId = node.node_id;
                    if (node.is_isis && node.systemid) {
                        nodeId = node.systemid + ' (pseudo-RID: ' + (node.pseudo_rid || 'N/A') + ')';
                    }
                    
                    let areasText = node.areas && node.areas.length > 0 ? node.areas.join(', ') : 'N/A';
                    
                    html += '<tr>';
                    html += '<td>' + nodeId + '</td>';
                    html += '<td>' + node.hostname + '</td>';
                    html += '<td>' + node.networks_count + '</td>';
                    html += '<td>' + areasText + '</td>';
                    html += '</tr>';
                });
            } else {
                html += '<tr><td colspan="4" class="text-center">No nodes found</td></tr>';
            }
            
            html += '</tbody></table>';
            
            // Pagination controls
            if (response.pagination && response.pagination.total_pages > 1) {
                let paginationHtml = render_pagination_controls(response.pagination, null, 'nodes');
                html += paginationHtml;
            }
            
            // Show count
            if (response.pagination) {
                let start = (response.pagination.page - 1) * response.pagination.per_page + 1;
                let end = Math.min(start + response.pagination.per_page - 1, response.pagination.total);
                html += '<div class="text-muted" style="margin-top: 10px; font-size: 0.85em;">Showing ' + start + '-' + end + ' of ' + response.pagination.total + ' nodes</div>';
            }
            
            html += '</div>';
            container.innerHTML = html;
        },
        error: function(xhr, status, error) {
            console.error("Error loading nodes:", error);
            container.innerHTML = '<div class="alert alert-danger">Error loading nodes. Please try again.</div>';
        }
    });
}

function load_areas_table() {
    if (typeof graph_id === 'undefined' || !graph_id) {
        console.error("Graph ID not available");
        return;
    }
    
    const container = document.getElementById('areas_table_container');
    if (!container) {
        return;
    }
    
    // Show loading indicator
    container.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Loading...</span></div> Loading areas...</div>';
    
    $.ajax({
        url: "/get_areas_list",
        method: "POST",
        data: {
            "graph_id": graph_id
        },
        success: function(response) {
            let html = '<div style="margin-top: 10px;">';
            
            // Table
            html += '<table class="table table-sm table-bordered" style="font-size: 0.9em;">';
            html += '<thead class="thead-light"><tr><th>Area ID</th><th>Nodes Count</th><th>Networks Count</th><th>Is Backbone</th></tr></thead>';
            html += '<tbody>';
            
            if (response.items && response.items.length > 0) {
                response.items.forEach(function(area) {
                    let backboneText = area.is_backbone ? '<span style="color: green;">✓ Yes</span>' : 'No';
                    
                    html += '<tr>';
                    html += '<td>' + area.area_id + '</td>';
                    html += '<td>' + area.nodes_count + '</td>';
                    html += '<td>' + area.networks_count + '</td>';
                    html += '<td>' + backboneText + '</td>';
                    html += '</tr>';
                });
            } else {
                html += '<tr><td colspan="4" class="text-center">No areas found</td></tr>';
            }
            
            html += '</tbody></table>';
            html += '</div>';
            container.innerHTML = html;
        },
        error: function(xhr, status, error) {
            console.error("Error loading areas:", error);
            container.innerHTML = '<div class="alert alert-danger">Error loading areas. Please try again.</div>';
        }
    });
}

function render_pagination_controls(pagination, filter_type, table_type) {
    let pageNum = pagination.page;
    let totalPages = pagination.total_pages;
    let uniqueId = 'pagination_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    let html = '<nav aria-label="Page navigation" style="margin-top: 15px;">';
    html += '<ul class="pagination pagination-sm justify-content-center pagination-container" data-pagination-id="' + uniqueId + '" data-filter="' + (filter_type || '') + '" data-table="' + table_type + '">';
    
    // Previous button
    if (pageNum > 1) {
        html += '<li class="page-item"><a class="page-link pagination-link" href="#" data-page="' + (pageNum - 1) + '">Previous</a></li>';
    } else {
        html += '<li class="page-item disabled"><span class="page-link">Previous</span></li>';
    }
    
    // Page numbers (show max 7 pages around current)
    let startPage = Math.max(1, pageNum - 3);
    let endPage = Math.min(totalPages, pageNum + 3);
    
    if (startPage > 1) {
        html += '<li class="page-item"><a class="page-link pagination-link" href="#" data-page="1">1</a></li>';
        if (startPage > 2) {
            html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += '<li class="page-item' + (i === pageNum ? ' active' : '') + '">';
        html += '<a class="page-link pagination-link" href="#" data-page="' + i + '">' + i + '</a>';
        html += '</li>';
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
        }
        html += '<li class="page-item"><a class="page-link pagination-link" href="#" data-page="' + totalPages + '">' + totalPages + '</a></li>';
    }
    
    // Next button
    if (pageNum < totalPages) {
        html += '<li class="page-item"><a class="page-link pagination-link" href="#" data-page="' + (pageNum + 1) + '">Next</a></li>';
    } else {
        html += '<li class="page-item disabled"><span class="page-link">Next</span></li>';
    }
    
    html += '</ul></nav>';
    
    // Attach event listeners after DOM insertion
    setTimeout(function() {
        let container = document.querySelector('[data-pagination-id="' + uniqueId + '"]');
        if (container) {
            let links = container.querySelectorAll('.pagination-link[data-page]');
            let storedFilter = container.getAttribute('data-filter');
            let storedTable = container.getAttribute('data-table');
            
            links.forEach(function(link) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    let page = parseInt(this.getAttribute('data-page'));
                    if (storedTable === 'networks') {
                        load_networks_table(page, storedFilter || 'all');
                    } else if (storedTable === 'nodes') {
                        load_nodes_table(page);
                    }
                });
            });
        }
    }, 100);
    
    return html;
}

// Statistics details event listeners and load functions
function attach_statistics_details_listeners() {
    // Nodes details
    const nodesDetails = document.getElementById('nodes_details');
    if (nodesDetails) {
        nodesDetails.addEventListener('toggle', function() {
            if (this.open && !this.dataset.loaded) {
                load_nodes_table(1);
                this.dataset.loaded = 'true';
            }
        });
    }
    
    // Subnets details
    const subnetsDetails = document.getElementById('subnets_details');
    if (subnetsDetails) {
        subnetsDetails.addEventListener('toggle', function() {
            if (this.open && !this.dataset.loaded) {
                load_networks_table(1, 'all');
                this.dataset.loaded = 'true';
            }
        });
    }
    
    // Backuped details
    const backupedDetails = document.getElementById('backuped_details');
    if (backupedDetails) {
        backupedDetails.addEventListener('toggle', function() {
            if (this.open && !this.dataset.loaded) {
                load_networks_table(1, 'backuped_only');
                this.dataset.loaded = 'true';
            }
        });
    }
    
    // Non Backuped details
    const nonBackupedDetails = document.getElementById('non_backuped_details');
    if (nonBackupedDetails) {
        nonBackupedDetails.addEventListener('toggle', function() {
            if (this.open && !this.dataset.loaded) {
                load_networks_table(1, 'non_backuped_only');
                this.dataset.loaded = 'true';
            }
        });
    }
    
    // Areas details
    const areasDetails = document.getElementById('areas_details');
    if (areasDetails) {
        areasDetails.addEventListener('toggle', function() {
            if (this.open && !this.dataset.loaded) {
                load_areas_table();
                this.dataset.loaded = 'true';
            }
        });
    }
}

/* ============================================================================
 * COUNTRY FILTER SYSTEM
 * Adds a floating "🌍 Country Filter" panel to the Topolograph UI.
 *
 * Features:
 *   • Auto-colours each router node by its country (pushed via push-to-ui.py)
 *   • Three filter modes: ALL / EXCLUDE selected / SHOW ONLY selected
 *   • Handles "UNK" nodes (no hostname mapping) — shown in grey, filterable
 *   • Panel is draggable, collapsible, and persists filter state per session
 * ============================================================================ */

// ── 1. Colour palette (mirrors push-to-ui.py COUNTRY_COLORS) ─────────────────
var COUNTRY_COLOR_PALETTE = {
  ZAF: { background: '#FF8C42', border: '#CC6D28', highlight: { background: '#FFB380', border: '#FF8C42' }, hover: { background: '#FFB380', border: '#FF8C42' } },
  DRC: { background: '#4ECDC4', border: '#3AA39B', highlight: { background: '#7EDAD6', border: '#4ECDC4' }, hover: { background: '#7EDAD6', border: '#4ECDC4' } },
  MOZ: { background: '#45B7D1', border: '#2E95AF', highlight: { background: '#75CDE0', border: '#45B7D1' }, hover: { background: '#75CDE0', border: '#45B7D1' } },
  KEN: { background: '#6BCB77', border: '#4DA85A', highlight: { background: '#95DB9E', border: '#6BCB77' }, hover: { background: '#95DB9E', border: '#6BCB77' } },
  TAN: { background: '#FFD93D', border: '#CCAA1A', highlight: { background: '#FFE675', border: '#FFD93D' }, hover: { background: '#FFE675', border: '#FFD93D' } },
  LES: { background: '#C77DFF', border: '#A055D4', highlight: { background: '#D9A8FF', border: '#C77DFF' }, hover: { background: '#D9A8FF', border: '#C77DFF' } },
  DJB: { background: '#FF6B6B', border: '#D44A4A', highlight: { background: '#FF9898', border: '#FF6B6B' }, hover: { background: '#FF9898', border: '#FF6B6B' } },
  GBR: { background: '#4D96FF', border: '#2070D4', highlight: { background: '#80B5FF', border: '#4D96FF' }, hover: { background: '#80B5FF', border: '#4D96FF' } },
  FRA: { background: '#F77F00', border: '#C46200', highlight: { background: '#FAA84D', border: '#F77F00' }, hover: { background: '#FAA84D', border: '#F77F00' } },
  POR: { background: '#06D6A0', border: '#04A87D', highlight: { background: '#47E6BE', border: '#06D6A0' }, hover: { background: '#47E6BE', border: '#06D6A0' } },
  ETH: { background: '#F4A261', border: '#C17E3E', highlight: { background: '#F8C28C', border: '#F4A261' }, hover: { background: '#F8C28C', border: '#F4A261' } },
  UNK: { background: '#AAAAAA', border: '#888888', highlight: { background: '#CCCCCC', border: '#AAAAAA' }, hover: { background: '#CCCCCC', border: '#AAAAAA' } },
};

function _countryColorFor(code) {
  if (COUNTRY_COLOR_PALETTE[code]) return COUNTRY_COLOR_PALETTE[code];
  // Deterministic fallback via string hash → hue
  var hash = 0;
  for (var i = 0; i < code.length; i++) { hash = (hash * 31 + code.charCodeAt(i)) >>> 0; }
  var hue = hash % 360;
  var bg  = 'hsl(' + hue + ',65%,60%)';
  var bdr = 'hsl(' + hue + ',65%,40%)';
  return { background: bg, border: bdr,
           highlight: { background: bg, border: bdr },
           hover:     { background: bg, border: bdr } };
}

function _looksLikeIpv4(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value || '').trim());
}

function _deriveCountryCodeFromHostname(hostname) {
  var host = String(hostname || '').trim();
  if (!host || _looksLikeIpv4(host)) return 'UNK';

  var lowered = host.toLowerCase();
  var prefixToken = lowered.split('-', 1)[0].trim();
  if (!prefixToken) prefixToken = lowered;

  var letters = prefixToken.match(/[a-z]/g) || [];
  if (letters.length >= 3) {
    return letters.slice(0, 3).join('').toUpperCase();
  }

  var start = lowered.match(/^([a-z]{3})/);
  if (start) return start[1].toUpperCase();

  var compact = lowered.replace(/[^a-z0-9]/g, '');
  if (/^[a-z]{3}/.test(compact)) return compact.slice(0, 3).toUpperCase();

  return 'UNK';
}

function _buildHostnameCsvFromServerMap(hostMap) {
  var rows = ['router_id,hostname,country'];
  Object.keys(hostMap || {}).forEach(function(routerId) {
    var hostname = String(hostMap[routerId] || '').trim();
    if (!routerId || !hostname) return;
    rows.push(routerId + ',' + hostname + ',' + _deriveCountryCodeFromHostname(hostname));
  });
  return rows.length > 1 ? rows.join('\n') : '';
}

function _syncHostnameMappingsFromServer(graphTime) {
  if (!graphTime || typeof fetch !== 'function') return Promise.resolve(false);
  return fetch('/ospf-host-to-dns-mapping', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: 'graph_time=' + encodeURIComponent(graphTime)
  }).then(function(response) {
    if (!response.ok) throw new Error('Failed to load saved hostnames for graph ' + graphTime);
    return response.text();
  }).then(function(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    var hostMap = {};
    Array.from(doc.querySelectorAll('input[id^="comment_"]')).forEach(function(input) {
      var hostname = String(input.value || '').trim();
      var routerId = String(input.id || '').replace(/^comment_/, '').trim();
      if (!routerId || !hostname) return;
      hostMap[routerId] = hostname;
    });
    var csvText = _buildHostnameCsvFromServerMap(hostMap);
    if (!csvText) return false;
    _applyHostnameMapping(csvText, 'saved hostnames for ' + graphTime);
    console.log('[SP3-A] Synced saved hostname mappings from server for graph ' + graphTime);
    return true;
  }).catch(function(err) {
    console.warn('[SP3-A] Could not sync hostname mappings from server', err);
    return false;
  });
}

function _buildCountryAwareNodeTitle(node) {
  var hostname = String(node.hostname || node.name || node.router_id || node.id || '').trim();
  var country = (node.country || node.group || 'UNK').toUpperCase();
  var gwTag = node.is_gateway === true ? ' 🌐' : '';
  var unkNote = country === 'UNK' ? "<br/><i style='color:#f90'>⚠ No hostname mapping in host file</i>" : '';
  return '<b>' + hostname + '</b>' + gwTag + '<br/>Country: <b>' + country + '</b>' + unkNote + '<br/>Gateway: ' + String(node.is_gateway === true);
}

function _buildCountryAwareNodeLabel(node) {
  var country = (node.country || node.group || 'UNK').toUpperCase();
  var routerId = String(node.name || node.router_id || node.id || '').trim();
  var hostname = String(node.hostname || '').trim();

  if (!hostname && node.label) {
    hostname = String(node.label).split('\n')[0].trim();
  }

  var isIpLikeHostname = hostname && /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
  var isRouterIdLike = routerId && /^\d+\.\d+\.\d+\.\d+$/.test(routerId);

  if (!routerId && isIpLikeHostname) {
    routerId = hostname;
  }
  if (!hostname || hostname === routerId || isIpLikeHostname) {
    hostname = '';
  }

  if (hostname && routerId) {
    return hostname + '\n' + routerId + '\n[' + country + ']';
  }
  var fallbackId = routerId || hostname;
  if (fallbackId) {
    return fallbackId + '\n[' + country + ']';
  }
  return '[' + country + ']';
}

function _normalizeCountryNodeLabels() {
  if (typeof nodes === 'undefined' || !nodes) return;
  var updates = [];
  nodes.get().forEach(function(n) {
    var normalized = _buildCountryAwareNodeLabel(n);
    if (normalized && normalized !== n.label) {
      updates.push({ id: n.id, label: normalized });
    }
  });
  if (updates.length > 0) nodes.update(updates);
}

// ── 2. Apply country colours to all nodes that have a `country` attribute ─────
function applyCountryColors() {
  if (typeof nodes === 'undefined' || !nodes) return;
  var inferredUpdates = [];
  nodes.get().forEach(function(n) {
    var existingCountry = (n.country || '').toUpperCase();
    if (existingCountry && existingCountry !== 'UNK') return;
    var hostname = String(n.hostname || '').trim();
    if (!hostname && n.label) hostname = String(n.label).split('\n')[0].trim();
    var derived = _deriveCountryCodeFromHostname(hostname);
    if (derived !== 'UNK') {
      inferredUpdates.push({ id: n.id, country: derived, group: derived, title: _buildCountryAwareNodeTitle({ hostname: hostname || (n.name || n.id), country: derived, is_gateway: n.is_gateway === true }) });
    }
  });
  if (inferredUpdates.length > 0) nodes.update(inferredUpdates);
  _normalizeCountryNodeLabels();
  var allNodes = nodes.get();
  var updates  = [];
  allNodes.forEach(function(n) {
    var code = (n.country || 'UNK').toUpperCase();
    if (n.color && typeof n.color === 'object' && n.color.background) return; // already coloured by push-to-ui
    var col = _countryColorFor(code);
    updates.push({ id: n.id, color: col });
  });
  if (updates.length > 0) nodes.update(updates);
}

// ── 3. Gather distinct country codes present in the current graph ─────────────
function _getCountriesInGraph() {
  if (typeof nodes === 'undefined' || !nodes) return [];
  var seen = {};
  nodes.get().forEach(function(n) {
    var code = (n.country || 'UNK').toUpperCase();
    seen[code] = true;
  });
  return Object.keys(seen).sort();
}

// ── 4. Filter nodes by country ────────────────────────────────────────────────
//  mode: 'all' | 'exclude' | 'show_only'
//  selected: Set of country codes
function filterNodesByCountry(mode, selected) {
  if (typeof nodes === 'undefined' || !nodes) return;
  var allNodes = nodes.get();
  var updates  = [];
  allNodes.forEach(function(n) {
    var code = (n.country || 'UNK').toUpperCase();
    var hidden = false;
    if (mode === 'exclude')   { hidden = selected.has(code); }
    if (mode === 'show_only') { hidden = !selected.has(code); }
    updates.push({ id: n.id, hidden: hidden });
  });
  nodes.update(updates);
  // Also hide edges whose both endpoints are hidden
  _syncEdgeVisibility();
}

function _syncEdgeVisibility() {
  if (typeof edges === 'undefined' || !edges) return;
  var hiddenNodes = new Set();
  nodes.get().forEach(function(n) { if (n.hidden) hiddenNodes.add(n.id); });
  var edgeUpdates = [];
  edges.get().forEach(function(e) {
    var h = hiddenNodes.has(e.from) || hiddenNodes.has(e.to);
    edgeUpdates.push({ id: e.id, hidden: h });
  });
  edges.update(edgeUpdates);
}

function resetCountryFilter() {
  if (typeof nodes === 'undefined' || !nodes) return;
  var updates = nodes.get().map(function(n) { return { id: n.id, hidden: false }; });
  nodes.update(updates);
  var edgeUpd = edges ? edges.get().map(function(e) { return { id: e.id, hidden: false }; }) : [];
  if (edgeUpd.length) edges.update(edgeUpd);
}

// ── 5. Build and inject the Country Filter panel ──────────────────────────────
var _cfPanelBuilt = false;

function buildCountryFilterPanel() {
  // Remove stale panel if graph was reloaded
  var existing = document.getElementById('countryFilterPanel');
  if (existing) existing.remove();
  _cfPanelBuilt = false;

  var countries = _getCountriesInGraph();
  if (countries.length === 0) return;

  // ── Inject CSS once ────────────────────────────────────────────────────────
  if (!document.getElementById('cfPanelStyle')) {
    var style = document.createElement('style');
    style.id  = 'cfPanelStyle';
    style.textContent = [
      '#countryFilterPanel{position:fixed;top:80px;right:16px;z-index:9999;',
      '  background:#1e2330;border:1px solid #3a4560;border-radius:10px;',
      '  box-shadow:0 4px 24px rgba(0,0,0,.55);color:#e0e6f0;',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      '  font-size:13px;min-width:230px;max-width:280px;user-select:none;}',
      '#cfHeader{display:flex;align-items:center;justify-content:space-between;',
      '  padding:10px 14px;cursor:move;border-bottom:1px solid #3a4560;',
      '  border-radius:10px 10px 0 0;background:#262d42;}',
      '#cfHeader h4{margin:0;font-size:14px;font-weight:600;letter-spacing:.5px;}',
      '#cfToggle{background:none;border:none;color:#aab;cursor:pointer;',
      '  font-size:18px;line-height:1;padding:0 0 0 8px;}',
      '#cfBody{padding:10px 14px 12px;}',
      '.cfModeRow{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;}',
      '.cfModeBtn{flex:1;padding:5px 4px;border:1px solid #3a4560;border-radius:6px;',
      '  background:#2a3248;color:#c8d0e8;cursor:pointer;font-size:12px;text-align:center;transition:.15s;}',
      '.cfModeBtn.active{background:#3d6aff;border-color:#3d6aff;color:#fff;font-weight:600;}',
      '.cfCountryList{max-height:260px;overflow-y:auto;margin-bottom:10px;}',
      '.cfCountryItem{display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;}',
      '.cfCountryItem:hover{background:rgba(255,255,255,.04);border-radius:4px;}',
      '.cfSwatch{width:14px;height:14px;border-radius:3px;flex-shrink:0;border:1px solid rgba(255,255,255,.2);}',
      '.cfCheckbox{accent-color:#3d6aff;width:14px;height:14px;cursor:pointer;}',
      '.cfLabel{flex:1;font-size:12px;}',
      '.cfCount{font-size:11px;color:#778;margin-left:auto;}',
      '.cfActionRow{display:flex;gap:6px;margin-top:4px;}',
      '.cfBtn{flex:1;padding:5px 0;border:1px solid #3a4560;border-radius:6px;',
      '  background:#2a3248;color:#c8d0e8;cursor:pointer;font-size:12px;',
      '  text-align:center;transition:.15s;}',
      '.cfBtn:hover{background:#3a4560;}',
      '.cfBtn.apply{background:#3d6aff;border-color:#3d6aff;color:#fff;}',
      '.cfBtn.apply:hover{background:#5580ff;}',
      '.cfInfo{font-size:11px;color:#667;margin-top:6px;text-align:center;}',
    ].join('');
    document.head.appendChild(style);
  }

  // ── Build node count per country ───────────────────────────────────────────
  var countPerCountry = {};
  nodes.get().forEach(function(n) {
    var c = (n.country || 'UNK').toUpperCase();
    countPerCountry[c] = (countPerCountry[c] || 0) + 1;
  });

  // ── Build panel DOM ────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.id  = 'countryFilterPanel';

  var headerHTML = '<div id="cfHeader">' +
    '<h4>🌍 Country Filter</h4>' +
    '<button id="cfToggle" title="Collapse / Expand">−</button></div>';

  var modeHTML = '<div class="cfModeRow">' +
    '<button class="cfModeBtn active" data-mode="all">All</button>' +
    '<button class="cfModeBtn" data-mode="exclude">Exclude</button>' +
    '<button class="cfModeBtn" data-mode="show_only">Show Only</button>' +
    '</div>';

  var listHTML = '<div class="cfCountryList" id="cfCountryList">';
  countries.forEach(function(code) {
    var col    = _countryColorFor(code);
    var bg     = col.background || '#888';
    var cnt    = countPerCountry[code] || 0;
    var label  = code === 'UNK' ? 'Unknown / Unmapped' : code;
    listHTML  += '<label class="cfCountryItem">' +
      '<input type="checkbox" class="cfCheckbox" data-country="' + code + '" checked>' +
      '<span class="cfSwatch" style="background:' + bg + '"></span>' +
      '<span class="cfLabel">' + label + '</span>' +
      '<span class="cfCount">' + cnt + '</span>' +
      '</label>';
  });
  listHTML += '</div>';

  var actionHTML = '<div class="cfActionRow">' +
    '<button class="cfBtn" id="cfSelectAll">All ✓</button>' +
    '<button class="cfBtn" id="cfSelectNone">None</button>' +
    '<button class="cfBtn" id="cfReset">Reset</button>' +
    '<button class="cfBtn apply" id="cfApply">Apply</button>' +
    '</div>' +
    '<div class="cfInfo" id="cfInfo">Mode: show all routers</div>';

  panel.innerHTML = headerHTML +
    '<div id="cfBody">' + modeHTML + listHTML + actionHTML + '</div>';

  document.body.appendChild(panel);

  // ── Collapse / Expand ──────────────────────────────────────────────────────
  var cfBody     = document.getElementById('cfBody');
  var cfToggle   = document.getElementById('cfToggle');
  var _collapsed = false;
  cfToggle.addEventListener('click', function() {
    _collapsed = !_collapsed;
    cfBody.style.display = _collapsed ? 'none' : '';
    cfToggle.textContent = _collapsed ? '+' : '−';
  });

  // ── Mode buttons ───────────────────────────────────────────────────────────
  var _currentMode = 'all';
  document.querySelectorAll('.cfModeBtn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.cfModeBtn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      _currentMode = btn.dataset.mode;
      var info = document.getElementById('cfInfo');
      if (info) {
        var modeLabels = { all: 'show all routers', exclude: 'hide selected countries', show_only: 'show only selected countries' };
        info.textContent = 'Mode: ' + (modeLabels[_currentMode] || _currentMode);
      }
    });
  });

  // ── Select All / None / Reset ──────────────────────────────────────────────
  document.getElementById('cfSelectAll').addEventListener('click', function() {
    document.querySelectorAll('.cfCheckbox').forEach(function(cb) { cb.checked = true; });
  });
  document.getElementById('cfSelectNone').addEventListener('click', function() {
    document.querySelectorAll('.cfCheckbox').forEach(function(cb) { cb.checked = false; });
  });
  document.getElementById('cfReset').addEventListener('click', function() {
    // Reset: check all boxes, switch to 'all' mode, show all nodes
    document.querySelectorAll('.cfCheckbox').forEach(function(cb) { cb.checked = true; });
    document.querySelectorAll('.cfModeBtn').forEach(function(b) { b.classList.remove('active'); });
    var allBtn = document.querySelector('.cfModeBtn[data-mode="all"]');
    if (allBtn) allBtn.classList.add('active');
    _currentMode = 'all';
    var info = document.getElementById('cfInfo');
    if (info) info.textContent = 'Mode: show all routers';
    resetCountryFilter();
  });

  // ── Apply button ───────────────────────────────────────────────────────────
  document.getElementById('cfApply').addEventListener('click', function() {
    var selected = new Set();
    document.querySelectorAll('.cfCheckbox').forEach(function(cb) {
      if (cb.checked) selected.add(cb.dataset.country);
    });
    if (_currentMode === 'all') {
      resetCountryFilter();
    } else {
      filterNodesByCountry(_currentMode, selected);
    }
  });

  // ── Drag to reposition ─────────────────────────────────────────────────────
  var header = document.getElementById('cfHeader');
  var isDragging = false, dragX = 0, dragY = 0;
  header.addEventListener('mousedown', function(e) {
    if (e.target === cfToggle) return;
    isDragging = true;
    dragX = e.clientX - panel.getBoundingClientRect().left;
    dragY = e.clientY - panel.getBoundingClientRect().top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    panel.style.right  = 'auto';
    panel.style.left   = (e.clientX - dragX) + 'px';
    panel.style.top    = (e.clientY - dragY) + 'px';
  });
  document.addEventListener('mouseup', function() { isDragging = false; });

  _cfPanelBuilt = true;
}

// ══════════════════════════════════════════════════════════════════════════════
//  COLLAPSING FEATURE — Country Group Collapse / Expand
//  ─────────────────────────────────────────────────────
//  Scholar's Note: Implements the "information hiding" principle (Parnas 1972)
//  applied to network topology. The collapsed view mirrors BGP's AS-level
//  abstraction of OSPF internals — expose inter-domain structure, hide
//  intra-domain detail on demand.
//
//  ARCHITECTURE: pure vis.DataSet hide/show — no clustering API.
//  • hidden: true  →  UI-only flag; server-side SPT calculations unaffected ✓
//  • Gateway nodes (is_gateway===true) always remain visible when collapsed
//  • Core nodes (!is_gateway) are hidden per-country on collapse
//  • Inter-country edges survive (both endpoints = gateways, always visible)
//  • Intra-country edges to/from core nodes are hidden via _syncEdgeVisibility
//
//  4 VIEW MODES (injected button bar):
//    AS-IS      → plain grey topology, all nodes visible, no colours
//    GATEWAY    → only is_gateway===true nodes visible (inter-country graph)
//    ENRICHED   → all nodes + country colours (default / current behaviour)
//    COLLAPSING → hybrid: per-country expand/collapse with Country Groups panel
// ══════════════════════════════════════════════════════════════════════════════

// ── Global state ─────────────────────────────────────────────────────────────
var _collapseState  = {};         // { ZAF: true,  DRC: false, … }
var _collapseHidden = {};         // { ZAF: {nodeIds:Set, edgeIds:Set}, … }
var _viewMode       = 'enriched'; // 'asis' | 'gateway' | 'enriched' | 'collapsing'
var _cpPanelBuilt   = false;      // Country Groups panel built flag
var _vmBarBuilt     = false;      // View Mode button bar built flag

// ── A. Helper utilities ───────────────────────────────────────────────────────

/**
 * Returns {gateways:[nodeObj,…], cores:[nodeObj,…], all:[nodeObj,…]}
 * for a given country code.
 * Gateway = node.is_gateway === true (set by push-to-ui.py)
 */
function _getCountryNodesByType(code) {
  if (typeof nodes === 'undefined' || !nodes) return { gateways: [], cores: [], all: [] };
  var all      = nodes.get().filter(function(n) {
    return (n.country || 'UNK').toUpperCase() === code.toUpperCase();
  });
  var gateways = all.filter(function(n) { return n.is_gateway === true; });
  var cores    = all.filter(function(n) { return n.is_gateway !== true; });
  return { gateways: gateways, cores: cores, all: all };
}

/**
 * IP Fabric "Persistent Path Overlay" implementation.
 *
 * Returns {toHide:[id,…], intraCost:N} for edges whose collapse behaviour
 * must be decided when country `countryCode` is collapsed.
 *
 * RULES (matching IP Fabric / Blue Planet Selective Collapse behaviour):
 *   • Intra-country edges  (both endpoints same country as `countryCode`)
 *     → added to `toHide`; their OSPF cost is summed into `intraCost`.
 *   • Cross-country edges  (one endpoint belongs to a DIFFERENT country)
 *     → NOT hidden.  The inter-AS link remains visible at the gateway
 *     boundary ("pinned to group boundary" in IP Fabric terminology).
 *
 * Scholar's Note: This implements Parnas' information-hiding principle
 * while preserving the topological invariant that every inter-domain
 * link cost is still observable from the collapsed view — exactly the
 * "abstraction without information loss" property described by IP Fabric.
 *
 * @param {Set}    coreNodeIdSet  vis.js node IDs of core (non-gateway) nodes
 * @param {string} countryCode    ISO country code being collapsed (for cross-country check)
 * @returns {{ toHide: number[], intraCost: number }}
 */
function _collapseEdgeIds(coreNodeIdSet, countryCode) {
  if (typeof edges === 'undefined' || !edges) return { toHide: [], intraCost: 0 };
  var toHide    = [];
  var intraCost = 0;
  var cc = countryCode ? countryCode.toUpperCase() : null;

  edges.get().forEach(function(e) {
    // Only process edges that touch at least one core node
    if (!coreNodeIdSet.has(e.from) && !coreNodeIdSet.has(e.to)) return;

    // ── Persistent Path Overlay: keep cross-country edges visible ─────────
    if (cc && typeof nodes !== 'undefined' && nodes) {
      var srcNode = nodes.get(e.from);
      var dstNode = nodes.get(e.to);
      var srcC = srcNode && srcNode.country ? srcNode.country.toUpperCase() : null;
      var dstC = dstNode && dstNode.country ? dstNode.country.toUpperCase() : null;
      // If the two endpoints belong to DIFFERENT countries, this is an
      // inter-domain link — leave it visible regardless of core status.
      if (srcC && dstC && srcC !== dstC) return;
    }

    // Intra-country edge → hide it and accumulate OSPF cost
    // _edgeCost handles e.cost / e.weight / e.value / title-regex fallback
    toHide.push(e.id);
    intraCost += _edgeCost(e);
  });

  return { toHide: toHide, intraCost: intraCost };
}

/**
 * Adds/removes the visual "collapsed" indicator on gateway nodes.
 *
 * IP Fabric "Cost Aggregation" feature:
 *   When collapsed, the badge includes the summed intra-country OSPF cost
 *   so that operators can reason about hidden path cost without expanding
 *   the group — "abstraction without information loss" (IP Fabric §4.2).
 *
 *   Badge format (collapsed):
 *     <hostname>\n<IP>\n▲ N hidden | ∑cost: X
 *
 *   When expanded: badge is removed, original label fully restored.
 *
 * @param {string}  countryCode   ISO country code (e.g. 'ZAF')
 * @param {boolean} isCollapsed   true = add badge, false = remove badge
 * @param {number}  hiddenCount   number of hidden core routers
 * @param {number}  [intraCost]   summed OSPF cost of hidden intra-country edges (optional)
 */
function _markGatewayCollapsed(countryCode, isCollapsed, hiddenCount, intraCost) {
  if (typeof nodes === 'undefined' || !nodes) return;
  var gws = _getCountryNodesByType(countryCode).gateways;
  var updates = gws.map(function(n) {
    if (isCollapsed) {
      // CL-F3 + IP Fabric Cost Aggregation:
      // Badge = "▲ N hidden" base + optional "| ∑cost: X" when cost is known
      var origLabel  = (n._origLabel !== undefined) ? n._origLabel : (n.label || '');
      var costSuffix = (typeof intraCost === 'number' && intraCost > 0)
                       ? (' | \u03a3cost: ' + intraCost)   // Σ (sigma) unicode
                       : '';
      var badge      = (hiddenCount > 0)
                       ? ('\n\u25b2 ' + hiddenCount + ' hidden' + costSuffix)
                       : '';
      var tooltip    = (n._origTitle || n.title || n.label || '') +
                       '\n[' + countryCode + ': ' + hiddenCount + ' core router' +
                       (hiddenCount !== 1 ? 's' : '') + ' hidden';
      if (typeof intraCost === 'number' && intraCost > 0) {
        tooltip += ' | intra-country \u03a3OSPF cost: ' + intraCost;
      }
      tooltip += ' — dbl-click to expand]';
      return {
        id:              n.id,
        _origLabel:      origLabel,
        _origIntraCost:  intraCost,   // store for tooltip on re-collapse
        label:           origLabel + badge,
        borderWidth:     3,
        shapeProperties: { borderDashes: [6, 3] },
        title:           tooltip
      };
    } else {
      // CL-F3: restore original label, clear badge
      return {
        id:              n.id,
        label:           (n._origLabel !== undefined) ? n._origLabel : (n.label || ''),
        _origLabel:      undefined,
        _origIntraCost:  undefined,
        borderWidth:     1,
        shapeProperties: { borderDashes: false },
        title:           n._origTitle || n.title || n.label || ''
      };
    }
  });
  if (updates.length) nodes.update(updates);
}

// ── B. Core collapse / expand functions ───────────────────────────────────────

/**
 * Collapse country: hide all core (non-gateway) routers and their edges.
 * Inter-country edges (gateway→gateway) are unaffected.
 * Does nothing if country has no core routers.
 */
function collapseCountry(code) {
  code = code.toUpperCase();
  if (typeof nodes === 'undefined' || !nodes) return;

  var split    = _getCountryNodesByType(code);
  var gateways = split.gateways;
  var cores    = split.cores;

  // UNK / gateway-less countries cannot be meaningfully collapsed:
  // there is no boundary gateway node to pin the badge to.
  // Skip silently so nodes do not vanish without a visual indicator.
  if (gateways.length === 0 && cores.length > 0) {
    console.warn('[COLLAPSE] Skipping ' + code + ' — no gateway nodes (UNK/unmapped country).' +
                 ' Use the ⚠ UNK button to highlight these nodes.');
    return;
  }

  if (cores.length === 0) {
    // No core routers — mark as collapsed for UI consistency but nothing to hide
    _collapseState[code]  = true;
    _collapseHidden[code] = { nodeIds: new Set(), edgeIds: new Set() };
    _updateCollapsePanel();
    return;
  }

  var coreIds      = new Set(cores.map(function(n) { return n.id; }));
  // ── IP Fabric Persistent Path Overlay + Cost Aggregation ──────────────
  // _collapseEdgeIds now filters out cross-country edges (kept visible)
  // and returns the summed intra-country OSPF cost for the badge.
  var edgeResult   = _collapseEdgeIds(coreIds, code);
  var edgeIds      = edgeResult.toHide;
  var intraCost    = edgeResult.intraCost;
  var edgeIdSet    = new Set(edgeIds);

  // Disable physics briefly to prevent layout jump
  if (typeof network !== 'undefined' && network) {
    network.setOptions({ physics: { enabled: false } });
  }

  // Hide core nodes
  nodes.update(cores.map(function(n) { return { id: n.id, hidden: true }; }));

  // Hide INTRA-country edges only (cross-country edges remain visible
  // per IP Fabric Persistent Path Overlay — their costs stay readable)
  if (edgeIds.length) {
    edges.update(edgeIds.map(function(id) { return { id: id, hidden: true }; }));
  }

  // Visual badge on gateway nodes — includes ∑cost for Cost Aggregation
  _markGatewayCollapsed(code, true, cores.length, intraCost);

  // Record state
  _collapseState[code]  = true;
  _collapseHidden[code] = { nodeIds: coreIds, edgeIds: edgeIdSet, intraCost: intraCost };

  _updateCollapsePanel();
}

/**
 * Expand country: restore all previously hidden core routers and their edges.
 */
function expandCountry(code) {
  code = code.toUpperCase();
  if (typeof nodes === 'undefined' || !nodes) return;

  var hidden = _collapseHidden[code];
  if (!hidden) { _collapseState[code] = false; _updateCollapsePanel(); return; }

  if (typeof network !== 'undefined' && network) {
    network.setOptions({ physics: { enabled: false } });
  }

  // Restore core nodes
  if (hidden.nodeIds.size) {
    var nodeUpd = [];
    hidden.nodeIds.forEach(function(id) { nodeUpd.push({ id: id, hidden: false }); });
    nodes.update(nodeUpd);
  }

  // Restore edges
  if (hidden.edgeIds.size) {
    var edgeUpd = [];
    hidden.edgeIds.forEach(function(id) { edgeUpd.push({ id: id, hidden: false }); });
    edges.update(edgeUpd);
  }

  // Remove gateway badge
  _markGatewayCollapsed(code, false, 0);

  _collapseState[code] = false;
  delete _collapseHidden[code];

  _updateCollapsePanel();
}

/** Toggle collapse/expand for a country. */
function toggleCollapseCountry(code) {
  code = code.toUpperCase();
  if (_collapseState[code]) {
    expandCountry(code);
  } else {
    collapseCountry(code);
  }
  // CL-F1: persist collapse state to localStorage after every toggle
  if (typeof _persistCollapseState === 'function') { _persistCollapseState(); }
}

/** Collapse every country that has core routers. */
function collapseAllCountries() {
  var countries = _getCountriesInGraph();
  countries.forEach(function(code) { collapseCountry(code); });
}

/** Expand every currently-collapsed country. */
function expandAllCountries() {
  var toExpand = Object.keys(_collapseState).filter(function(c) { return _collapseState[c]; });
  toExpand.forEach(function(code) { expandCountry(code); });
}

// ── C. View Mode (4-button bar) ───────────────────────────────────────────────

/** Show/hide the Country Filter panel (#countryFilterPanel). */
function _showCfPanel() {
  var p = document.getElementById('countryFilterPanel');
  if (p) p.style.display = '';
}
function _hideCfPanel() {
  var p = document.getElementById('countryFilterPanel');
  if (p) p.style.display = 'none';
}

/** Show/hide the Country Groups panel (#countryCollapsePanel). */
function _showCpPanel() {
  var p = document.getElementById('countryCollapsePanel');
  if (p) p.style.display = '';
}
function _hideCpPanel() {
  var p = document.getElementById('countryCollapsePanel');
  if (p) p.style.display = 'none';
}

/**
 * Switch the active view mode and update the topology accordingly.
 *   'asis'       → grey, all nodes, no country colours
 *   'gateway'    → only is_gateway===true nodes visible
 *   'enriched'   → all nodes + country colours  (default)
 *   'collapsing' → hybrid per-country expand/collapse
 */
function setViewMode(mode) {
  _viewMode = mode;

  // Update button active state
  document.querySelectorAll('.vmBtn').forEach(function(b) {
    b.classList.remove('active');
  });
  var activeBtn = document.querySelector('.vmBtn[data-mode="' + mode + '"]');
  if (activeBtn) activeBtn.classList.add('active');

  if (typeof nodes === 'undefined' || !nodes) return;
  _normalizeCountryNodeLabels();

  if (mode === 'asis') {
    expandAllCountries();
    resetCountryFilter();
    // Grey all nodes (remove country colours)
    var greyUpd = nodes.get().map(function(n) {
      return { id: n.id, color: { background: '#cccccc', border: '#999999',
        highlight: { background: '#dddddd', border: '#aaaaaa' },
        hover:     { background: '#dddddd', border: '#aaaaaa' } } };
    });
    nodes.update(greyUpd);
    _hideCfPanel();
    _hideCpPanel();

  } else if (mode === 'gateway') {
    expandAllCountries();
    resetCountryFilter();
    applyCountryColors();
    // Hide non-gateway nodes, but KEEP UNK nodes visible so operators can classify them
    var gwUpd = nodes.get().map(function(n) {
      var isUnk = (n.country || '').toUpperCase() === 'UNK';
      return { id: n.id, hidden: n.is_gateway !== true && !isUnk };
    });
    nodes.update(gwUpd);
    _syncEdgeVisibility();
    _hideCfPanel();
    _hideCpPanel();
    // GW-F2: always apply cost-based edge colouring in GATEWAY mode
    if (typeof _applyGatewayCostStyle === 'function') { _applyGatewayCostStyle(); }

  } else if (mode === 'enriched') {
    expandAllCountries();
    resetCountryFilter();
    applyCountryColors();
    _hideCpPanel();
    _showCfPanel();

  } else if (mode === 'collapsing') {
    expandAllCountries();
    resetCountryFilter();
    applyCountryColors();
    _hideCfPanel();
    // Build or show the Country Groups panel
    if (!_cpPanelBuilt) {
      buildCollapsePanel();
      // CL-F1: after panel builds, restore persisted collapse state
      if (typeof _restoreCollapseState === 'function') { _restoreCollapseState(); }
    } else {
      _showCpPanel();
      _updateCollapsePanel();
      // CL-F1: restore persisted state on each mode re-entry
      if (typeof _restoreCollapseState === 'function') { _restoreCollapseState(); }
    }
  }
}

/**
 * Inject the 4-mode View Mode button bar into the page.
 * Called once after graph load (in the same setTimeout as buildCountryFilterPanel).
 * Bar is inserted before #mynetwork, after the last .btn-group toolbar div.
 */
function buildViewModeButtons() {
  // Remove stale bar on graph reload
  var old = document.getElementById('viewModeBar');
  if (old) old.remove();
  _vmBarBuilt = false;

  // Inject CSS once
  if (!document.getElementById('vmBarStyle')) {
    var style      = document.createElement('style');
    style.id       = 'vmBarStyle';
    style.textContent = [
      '#viewModeBar{display:inline-flex;gap:5px;margin:4px 0 4px 8px;',
      '  vertical-align:middle;flex-wrap:wrap;align-items:center;}',
      '.vmBtn{padding:4px 12px;border:1px solid #6c757d;border-radius:4px;',
      '  background:#fff;color:#495057;cursor:pointer;font-size:12px;',
      '  font-weight:500;transition:.15s;white-space:nowrap;}',
      '.vmBtn:hover{background:#e9ecef;border-color:#495057;}',
      '.vmBtn.active{background:#0d6efd;border-color:#0a58ca;color:#fff;font-weight:600;}',
      '#vmBarLabel{font-size:11px;color:#6c757d;align-self:center;',
      '  padding-right:4px;white-space:nowrap;}',
      /* AS-F1 / AS-F3 / AS-F4 / GW-F1 tool buttons */
      '.vmToolBtn{padding:3px 9px;border:1px solid #adb5bd;border-radius:4px;',
      '  background:#f8f9fa;color:#495057;cursor:pointer;font-size:11px;',
      '  transition:.15s;white-space:nowrap;}',
      '.vmToolBtn:hover{background:#e9ecef;}',
      '.vmToolBtn.active{background:#fd7e14;border-color:#e76500;color:#fff;}',
      '.vmSep{color:#ccc;padding:0 2px;align-self:center;}',
      '.vmCostLabel{font-size:11px;cursor:pointer;display:inline-flex;align-items:center;',
      '  gap:3px;padding:3px 8px;border:1px solid #adb5bd;border-radius:4px;',
      '  background:#f8f9fa;color:#495057;white-space:nowrap;}',
    ].join('');
    document.head.appendChild(style);
  }

  var bar = document.createElement('div');
  bar.id  = 'viewModeBar';
  bar.innerHTML =
    '<span id="vmBarLabel">View:</span>' +
    '<button class="vmBtn" data-mode="asis"       title="Raw topology — no country colours">AS-IS</button>' +
    '<button class="vmBtn" data-mode="gateway"    title="Show only gateway routers (inter-country view)">GATEWAY</button>' +
    '<button class="vmBtn active" data-mode="enriched"   title="All routers with country colours (default)">ENRICHED</button>' +
    '<button class="vmBtn" data-mode="collapsing" title="Hybrid: collapse/expand core routers per country (double-click gateway to toggle)">COLLAPSING ▼</button>' +
    /* ── Tool buttons (Sprint 0–2 features) ─────────────────────────── */
    '<span class="vmSep">│</span>' +
    '<label class="vmCostLabel" id="lblCostLabels" title="Toggle OSPF cost labels on every edge (AS-F1)">' +
    '<input type="checkbox" id="chkCostLabels" onchange="_applyCostLabels(this.checked)"> Costs</label>' +
    '<button class="vmToolBtn" id="btnAsymmetric"    title="Highlight asymmetric OSPF links — edges where A→B cost ≠ B→A cost (AS-F3)" onclick="_toggleAsymmetricHighlight()">⚡ Asymm</button>' +
    '<button class="vmToolBtn" id="btnDegreeHeatmap" title="Node degree heatmap — high fan-out nodes highlighted in red (AS-F4)" onclick="_toggleDegreeHeatmap()">🌡 Heatmap</button>' +
    '<button class="vmToolBtn" id="btnMatrix"        title="Cross-country connectivity matrix (GW-F1)" onclick="_toggleConnectivityMatrix()">📊 Matrix</button>' +
    '<button class="vmToolBtn" id="btnRedundancy"    title="Apply gateway redundancy score overlay (GW-F4)" onclick="applyRedundancyScore()">🛡 Redundancy</button>' +
    /* ── Sprint 3 features ───────────────────────────────────────────── */
    '<span class="vmSep">│</span>' +
    '<button class="vmToolBtn" id="btnUnkHighlight"  title="Highlight unclassified nodes (no country assigned). Upload a hostname file to classify them." onclick="_toggleUnkHighlight()">⚠ UNK</button>' +
    '<button class="vmToolBtn" id="btnHostnameUpload" title="Upload OSPF database + hostname mapping CSV to classify nodes" onclick="buildHostnameUploadPanel()">📂 Host File</button>' +
    '<button class="vmToolBtn" id="btnCostMatrix"    title="OSPF Cost Matrix — country-to-country Dijkstra shortest paths, heat-map, Excel export" onclick="buildOspfCostMatrix()">🗺 Cost Matrix</button>' +
    '<button class="vmToolBtn" id="btnWhatIf"        title="OSPF What-If analysis — change edge cost, see impact on all paths" onclick="buildOspfWhatIf()">🔬 What-If</button>';

  // Wire click handlers
  bar.querySelectorAll('.vmBtn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      setViewMode(btn.dataset.mode);
    });
  });

  // Insert: try after the last .btn-group in the page, else before #mynetwork
  var toolbarGroups = document.querySelectorAll('#togg_buttons2, .btn-group');
  var lastGroup = toolbarGroups.length ? toolbarGroups[toolbarGroups.length - 1] : null;
  var network_div = document.getElementById('mynetwork');
  if (lastGroup && lastGroup.parentNode) {
    lastGroup.parentNode.insertBefore(bar, lastGroup.nextSibling);
  } else if (network_div && network_div.parentNode) {
    network_div.parentNode.insertBefore(bar, network_div);
  } else {
    document.body.appendChild(bar);
  }

  // EN-F5: wire node-click inspector (must be re-wired each time bar is rebuilt)
  if (typeof _initNodeInspector === 'function') { _initNodeInspector(); }

  _vmBarBuilt  = true;
  _viewMode    = 'enriched'; // reset to default on each graph load
}

// ── D. Country Groups Panel (COLLAPSING mode side-panel) ──────────────────────

/**
 * Build and inject the "Country Groups" floating panel.
 * Modelled after buildCountryFilterPanel — same dark theme, draggable header.
 */
function buildCollapsePanel() {
  // Remove stale panel on graph reload
  var existing = document.getElementById('countryCollapsePanel');
  if (existing) existing.remove();
  _cpPanelBuilt = false;

  var countries = _getCountriesInGraph();
  if (countries.length === 0) return;

  // ── Inject CSS once ──────────────────────────────────────────────────────────
  if (!document.getElementById('cpPanelStyle')) {
    var style      = document.createElement('style');
    style.id       = 'cpPanelStyle';
    style.textContent = [
      '#countryCollapsePanel{position:fixed;top:80px;right:270px;z-index:9998;',
      '  background:#1e2330;border:1px solid #3a4560;border-radius:10px;',
      '  box-shadow:0 4px 24px rgba(0,0,0,.55);color:#e0e6f0;',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      '  font-size:13px;min-width:250px;max-width:300px;user-select:none;}',
      '#cpHeader{display:flex;align-items:center;justify-content:space-between;',
      '  padding:10px 14px;cursor:move;border-bottom:1px solid #3a4560;',
      '  border-radius:10px 10px 0 0;background:#262d42;}',
      '#cpHeader h4{margin:0;font-size:14px;font-weight:600;letter-spacing:.5px;}',
      '#cpToggle{background:none;border:none;color:#aab;cursor:pointer;',
      '  font-size:18px;line-height:1;padding:0 0 0 8px;}',
      '#cpBody{padding:10px 14px 12px;}',
      '.cpBulkRow{display:flex;gap:8px;margin-bottom:10px;}',
      '.cpBulkBtn{flex:1;padding:5px 4px;border:1px solid #3a4560;border-radius:6px;',
      '  background:#2a3248;color:#c8d0e8;cursor:pointer;font-size:12px;',
      '  text-align:center;transition:.15s;}',
      '.cpBulkBtn:hover{background:#3a4560;}',
      '.cpBulkBtn.danger{border-color:#3d6aff;color:#88aaff;}',
      '.cpCountryList{max-height:320px;overflow-y:auto;margin-bottom:6px;}',
      '.cpRow{display:flex;align-items:center;gap:8px;padding:5px 4px;',
      '  cursor:pointer;border-radius:5px;transition:.12s;}',
      '.cpRow:hover{background:rgba(255,255,255,.06);}',
      '.cpSwatch{width:13px;height:13px;border-radius:3px;flex-shrink:0;',
      '  border:1px solid rgba(255,255,255,.2);}',
      '.cpCode{font-weight:600;font-size:12px;width:36px;flex-shrink:0;}',
      '.cpStats{font-size:11px;color:#778;flex:1;}',
      '.cpToggleBtn{font-size:14px;flex-shrink:0;background:none;border:none;',
      '  color:#c8d0e8;cursor:pointer;padding:0 2px;line-height:1;}',
      '.cpRow.collapsed .cpToggleBtn{color:#ffaa44;}',
      '.cpRow.collapsed .cpCode{color:#ffaa44;}',
      '.cpInfo{font-size:11px;color:#667;margin-top:4px;text-align:center;}',
      /* CL-F4 / CL-F1 footer action buttons */
      '.cpFooterRow{display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid #2a3248;}',
      '.cpFooterBtn{flex:1;padding:4px 6px;border:1px solid #3a4560;border-radius:5px;',
      '  background:#2a3248;color:#88aaff;cursor:pointer;font-size:11px;',
      '  text-align:center;transition:.15s;}',
      '.cpFooterBtn:hover{background:#3a4560;}',
    ].join('');
    document.head.appendChild(style);
  }

  // ── Build per-country stats ───────────────────────────────────────────────────
  var countryStats = {};
  countries.forEach(function(code) {
    var split = _getCountryNodesByType(code);
    countryStats[code] = {
      total:    split.all.length,
      gateways: split.gateways.length,
      cores:    split.cores.length,
    };
  });

  // ── Panel DOM ─────────────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.id  = 'countryCollapsePanel';

  var headerHTML =
    '<div id="cpHeader">' +
    '<h4>🗂 Country Groups</h4>' +
    '<button id="cpToggle" title="Collapse / Expand panel">−</button></div>';

  var bulkHTML =
    '<div class="cpBulkRow">' +
    '<button class="cpBulkBtn" id="cpCollapseAll">Collapse All</button>' +
    '<button class="cpBulkBtn" id="cpExpandAll">Expand All</button>' +
    '</div>';

  // Separate collapsible countries (has ≥1 gateway) from UNK/unmapped (no gateway)
  var collapsibleCodes = countries.filter(function(c) { return countryStats[c].gateways > 0; });
  var unkCodes         = countries.filter(function(c) { return countryStats[c].gateways === 0; });

  var listHTML = '<div class="cpCountryList" id="cpCountryList">';
  collapsibleCodes.forEach(function(code) {
    var col   = _countryColorFor(code);
    var bg    = col.background || '#888';
    var stats = countryStats[code];
    var hasCores = stats.cores > 0;
    listHTML +=
      '<div class="cpRow" id="cpRow_' + code + '" data-country="' + code + '">' +
      '<span class="cpSwatch" style="background:' + bg + '"></span>' +
      '<span class="cpCode">' + code + '</span>' +
      '<span class="cpStats">' + stats.total + ' total' +
        (hasCores ? ' · ' + stats.gateways + 'gw · ' + stats.cores + 'core' : ' · all gw') +
      '</span>' +
      '<button class="cpToggleBtn" title="Toggle collapse/expand">▶</button>' +
      '</div>';
  });

  // UNK / unmapped countries (no gateway — cannot be collapsed to a boundary node)
  if (unkCodes.length > 0) {
    var totalUnk = unkCodes.reduce(function(s, c) { return s + countryStats[c].total; }, 0);
    listHTML +=
      '<div style="border-top:1px solid #2a3248;margin-top:6px;padding-top:6px;">' +
      '<div style="font-size:10px;color:#778;margin-bottom:4px;padding:0 4px;">⚠ Unclassified (no gateway — use ⚠ UNK button to highlight)</div>';
    unkCodes.forEach(function(code) {
      var col   = _countryColorFor(code);
      var bg    = col.background || '#AAAAAA';
      var stats = countryStats[code];
      listHTML +=
        '<div class="cpRow" id="cpRow_' + code + '" data-country="' + code + '" style="opacity:0.6;cursor:default;" title="No gateway nodes — cannot collapse">' +
        '<span class="cpSwatch" style="background:' + bg + '"></span>' +
        '<span class="cpCode" style="color:#aaa;">' + code + '</span>' +
        '<span class="cpStats">' + stats.total + ' nodes · no gw</span>' +
        '<span style="font-size:11px;color:#556;padding:0 2px;">—</span>' +
        '</div>';
    });
    listHTML += '</div>';
  }
  listHTML += '</div>';

  var infoHTML = '<div class="cpInfo" id="cpInfo">All expanded · dbl-click any node to toggle</div>';

  // CL-F4: "Link Costs" table button | CL-F1: "Save State" button
  var footerHTML =
    '<div class="cpFooterRow">' +
    '<button class="cpFooterBtn" id="btnCostTable" title="Inter-country OSPF cost table (CL-F4)"' +
    ' onclick="buildInterCountryCostTable()">🔗 Link Costs</button>' +
    '<button class="cpFooterBtn" id="btnSaveState" title="Save collapse state to localStorage (CL-F1)"' +
    ' onclick="_persistCollapseState();var _s=this;_s.textContent=\'✓ Saved\';' +
    'setTimeout(function(){_s.textContent=\'💾 Save State\';},1500)">💾 Save State</button>' +
    '</div>';

  panel.innerHTML = headerHTML +
    '<div id="cpBody">' + bulkHTML + listHTML + infoHTML + footerHTML + '</div>';

  document.body.appendChild(panel);

  // ── Panel collapse/expand (the panel itself, not countries) ──────────────────
  var cpBody    = document.getElementById('cpBody');
  var cpToggle  = document.getElementById('cpToggle');
  var _panelMin = false;
  cpToggle.addEventListener('click', function() {
    _panelMin = !_panelMin;
    cpBody.style.display    = _panelMin ? 'none' : '';
    cpToggle.textContent    = _panelMin ? '+' : '−';
  });

  // ── Bulk buttons ─────────────────────────────────────────────────────────────
  document.getElementById('cpCollapseAll').addEventListener('click', function() {
    collapseAllCountries();
  });
  document.getElementById('cpExpandAll').addEventListener('click', function() {
    expandAllCountries();
  });

  // ── Country row click → toggle ────────────────────────────────────────────────
  document.querySelectorAll('.cpRow').forEach(function(row) {
    row.addEventListener('click', function() {
      var code = row.dataset.country;
      toggleCollapseCountry(code);
    });
  });

  // ── Drag-to-reposition ────────────────────────────────────────────────────────
  var header   = document.getElementById('cpHeader');
  var isDragging = false, dragX = 0, dragY = 0;
  header.addEventListener('mousedown', function(e) {
    if (e.target === cpToggle) return;
    isDragging = true;
    dragX = e.clientX - panel.getBoundingClientRect().left;
    dragY = e.clientY - panel.getBoundingClientRect().top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    panel.style.right = 'auto';
    panel.style.left  = (e.clientX - dragX) + 'px';
    panel.style.top   = (e.clientY - dragY) + 'px';
  });
  document.addEventListener('mouseup', function() { isDragging = false; });

  _cpPanelBuilt = true;
  _updateCollapsePanel();
}

/**
 * Refresh Country Groups panel rows to reflect current _collapseState.
 * Called after every collapseCountry / expandCountry / bulk operation.
 */
function _updateCollapsePanel() {
  var list = document.getElementById('cpCountryList');
  if (!list) return;

  var collapsedCount = 0;
  list.querySelectorAll('.cpRow').forEach(function(row) {
    var code      = row.dataset.country;
    var btn       = row.querySelector('.cpToggleBtn');
    var isCollapsed = !!_collapseState[code];
    if (isCollapsed) collapsedCount++;
    row.classList.toggle('collapsed', isCollapsed);
    if (btn) btn.textContent = isCollapsed ? '▼' : '▶';
  });

  var info = document.getElementById('cpInfo');
  if (info) {
    var total = list.querySelectorAll('.cpRow').length;
    if (collapsedCount === 0) {
      info.textContent = 'All expanded · dbl-click any node to toggle';
    } else if (collapsedCount === total) {
      info.textContent = 'All collapsed · gateway-only view';
    } else {
      info.textContent = collapsedCount + '/' + total + ' collapsed (hybrid mode)';
    }
  }
}

// ── E. Double-click handler (wired in init_visjs_graph) ───────────────────────
// Call this function once after network is created.
// Separated so it can be called from within init_visjs_graph without
// polluting the existing event handler block.

function _wireCollapseDoubleClick() {
  if (typeof network === 'undefined' || !network) return;
  network.on('doubleClick', function(params) {
    // Only act in COLLAPSING mode
    if (_viewMode !== 'collapsing') return;
    if (!params.nodes || params.nodes.length !== 1) return;
    var node = nodes.get(params.nodes[0]);
    if (!node || !node.country) return;
    toggleCollapseCountry(node.country.toUpperCase());
  });
}

// ── F. Reset helper (call on graph reload to clear stale state) ───────────────
function _resetCollapseState() {
  _collapseState  = {};
  _collapseHidden = {};
  _viewMode       = 'enriched';
  _cpPanelBuilt   = false;
  _vmBarBuilt     = false;
  _inspectorWired = false;
  _costLabelsOn   = false;
  _degreeHeatmapOn = false;
  _asymmetricOn   = false;
  _matrixVisible  = false;
  _edgeOrigLabels = {};
  _nodeOrigColors = {};
}

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE BLOCK — Multi-mode Enhancement Sprint
// Sprint 0 : AS-F1 (cost labels), GW-F2 (gateway cost colouring), EN-F1 (edge types)
// Sprint 1 : AS-F3 (asymmetric), AS-F4 (heatmap), EN-F4 (UNK panel), EN-F5 (inspector)
// Sprint 2 : GW-F1 (connectivity matrix), GW-F4 (redundancy score)
// Sprint 3 : CL-F1 (persist state), CL-F4 (cost table)
// Injected after _resetCollapseState — no other file changes required.
// ═════════════════════════════════════════════════════════════════════════════

// ── Shared module-level state ─────────────────────────────────────────────────
var _costLabelsOn    = false;
var _edgeOrigLabels  = {};   // edge id → original label string
var _degreeHeatmapOn = false;
var _nodeOrigColors  = {};   // node id → original color object
var _asymmetricOn    = false;
var _matrixVisible   = false;
var _inspectorWired  = false;
var _LS_KEY          = 'topolograph_collapse_v1';

// ── Helper: resolve current graph_time for localStorage keying ────────────────
function _getGraphTime() {
  if (typeof graph_time !== 'undefined' && graph_time) return String(graph_time);
  var params = new URLSearchParams(window.location.search);
  var gt = params.get('graph_time') || params.get('graphtime') || params.get('gt');
  if (gt) return gt;
  var sel = document.querySelector('select');
  if (sel && sel.value && /^\d+$/.test(sel.value)) return sel.value;
  return 'default';
}

// ── Helper: get readable label for a node id ──────────────────────────────────
function _nodeLabel(nodeId) {
  if (typeof nodes === 'undefined' || !nodes) return String(nodeId);
  var n = nodes.get(nodeId);
  return n ? (n.hostname || n.label || String(nodeId)) : String(nodeId);
}

// ── Helper: linear interpolation between two hex colours ──────────────────────
function _lerpColor(c1, c2, t) {
  function parse(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function(c) { return c + c; }).join('');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
  var a = parse(c1), b = parse(c2);
  var r = clamp(a[0] + (b[0]-a[0])*t);
  var g = clamp(a[1] + (b[1]-a[1])*t);
  var bl = clamp(a[2] + (b[2]-a[2])*t);
  return '#' + r.toString(16).padStart(2,'0') + g.toString(16).padStart(2,'0') + bl.toString(16).padStart(2,'0');
}

// ── Helper: extract numeric OSPF cost from an edge object ─────────────────────
function _edgeCost(e) {
  var cost = e.cost || e.weight || e.value || 0;
  if (!cost && e.title) {
    var m = String(e.title).match(/cost[:\s]*(\d+)/i);
    if (m) cost = parseInt(m[1], 10);
  }
  if (!cost && e.label) {
    var lbl = String(e.label).trim();
    if (/^\d+$/.test(lbl)) cost = parseInt(lbl, 10);
  }
  return isNaN(cost) ? 0 : cost;
}

// ── CL-F1: Persist / restore collapse state via localStorage ─────────────────

function _persistCollapseState() {
  try {
    var gt    = _getGraphTime();
    var store = {};
    try { store = JSON.parse(localStorage.getItem(_LS_KEY) || '{}'); } catch(e2) {}
    store[gt] = _collapseState;
    localStorage.setItem(_LS_KEY, JSON.stringify(store));
    console.log('[CL-F1] Collapse state saved for graph_time=' + gt,
                Object.keys(_collapseState).filter(function(k){ return _collapseState[k]; }));
  } catch(e) { console.warn('[CL-F1] localStorage write failed:', e); }
}

function _restoreCollapseState() {
  try {
    var gt    = _getGraphTime();
    var store = {};
    try { store = JSON.parse(localStorage.getItem(_LS_KEY) || '{}'); } catch(e2) {}
    var saved = store[gt];
    if (!saved) { console.log('[CL-F1] No saved state for graph_time=' + gt); return; }
    Object.keys(saved).forEach(function(code) {
      if (saved[code] && !_collapseState[code]) { collapseCountry(code); }
    });
    if (typeof _updateCollapsePanel === 'function') { _updateCollapsePanel(); }
    console.log('[CL-F1] Collapse state restored for graph_time=' + gt);
  } catch(e) { console.warn('[CL-F1] Restore failed:', e); }
}

// ── AS-F1: OSPF cost labels on/off toggle ────────────────────────────────────

function _applyCostLabels(show) {
  if (typeof edges === 'undefined' || !edges) return;
  _costLabelsOn = !!show;
  var allEdges  = edges.get();
  var updates   = [];
  allEdges.forEach(function(e) {
    if (!(e.id in _edgeOrigLabels)) { _edgeOrigLabels[e.id] = e.label || ''; }
    updates.push({ id: e.id, label: show ? _edgeOrigLabels[e.id] : '' });
  });
  if (updates.length) edges.update(updates);
  console.log('[AS-F1] Cost labels', show ? 'ON (' + updates.length + ' edges)' : 'OFF');
}

// ── GW-F2: Gateway mode — auto-colour edges by OSPF cost (green→red) ─────────

function _applyGatewayCostStyle() {
  if (typeof edges === 'undefined' || !edges) return;
  var allEdges = edges.get();
  var costs    = allEdges.map(function(e) { return _edgeCost(e); });
  var nonZero  = costs.filter(Boolean);
  var maxCost  = nonZero.length ? Math.max.apply(null, nonZero) : 1;
  var minCost  = nonZero.length ? Math.min.apply(null, nonZero) : 0;
  var range    = maxCost - minCost || 1;
  var updates  = allEdges.map(function(e, i) {
    var t   = (costs[i] - minCost) / range;
    var col = _lerpColor('#27ae60', '#e74c3c', t);   // green(cheap) → red(expensive)
    return { id: e.id, color: { color: col, highlight: col, hover: col },
             width: 1 + Math.round(t * 2) };
  });
  if (updates.length) edges.update(updates);
  console.log('[GW-F2] Gateway cost colouring applied, range=[' + minCost + '..' + maxCost + ']');
}

// ── EN-F1: Enriched mode — distinguish intra vs cross-country edges ───────────

function _applyEnrichedEdgeStyle(show) {
  if (typeof edges === 'undefined' || !edges) return;
  if (typeof nodes === 'undefined' || !nodes) return;
  if (!show) {
    edges.update(edges.get().map(function(e) {
      return { id: e.id, color: undefined, dashes: false, width: 1 };
    }));
    return;
  }
  var nodeCountry = {};
  nodes.get().forEach(function(n) {
    nodeCountry[n.id] = (n.country || n.group || 'UNK').toUpperCase();
  });
  var updates = edges.get().map(function(e) {
    var intra = nodeCountry[e.from] === nodeCountry[e.to] && nodeCountry[e.from] !== 'UNK';
    return {
      id:     e.id,
      color:  intra ? { color:'#95d5b2', highlight:'#74c69d', hover:'#74c69d' }
                    : { color:'#e76f51', highlight:'#f4a261', hover:'#f4a261' },
      dashes: !intra,
      width:  intra ? 1 : 2,
    };
  });
  edges.update(updates);
  console.log('[EN-F1] Enriched edge style applied');
}

// ── AS-F4: Node degree heatmap ────────────────────────────────────────────────

function _toggleDegreeHeatmap() {
  _degreeHeatmapOn = !_degreeHeatmapOn;
  var btn = document.getElementById('btnDegreeHeatmap');
  if (btn) btn.classList.toggle('active', _degreeHeatmapOn);
  applyDegreeHeatmap(_degreeHeatmapOn);
}

function applyDegreeHeatmap(enable) {
  if (typeof nodes === 'undefined' || !nodes) return;
  if (typeof edges === 'undefined' || !edges) return;
  if (!enable) {
    var resets = [];
    nodes.get().forEach(function(n) {
      if (n.id in _nodeOrigColors) { resets.push({ id: n.id, color: _nodeOrigColors[n.id] }); }
    });
    if (resets.length) nodes.update(resets);
    _nodeOrigColors = {};
    return;
  }
  var degree = {};
  nodes.get().forEach(function(n) { degree[n.id] = 0; });
  edges.get().forEach(function(e) {
    if (degree[e.from] !== undefined) degree[e.from]++;
    if (degree[e.to]   !== undefined) degree[e.to]++;
  });
  var vals   = Object.values(degree);
  var maxDeg = Math.max.apply(null, vals) || 1;
  var minDeg = Math.min.apply(null, vals) || 0;
  var range  = maxDeg - minDeg || 1;
  var updates = [];
  nodes.get().forEach(function(n) {
    _nodeOrigColors[n.id] = n.color || null;
    var t   = (degree[n.id] - minDeg) / range;
    var col = _lerpColor('#3498db', '#e74c3c', t);   // blue(leaf) → red(hub)
    updates.push({ id: n.id, color: { background: col, border: col,
      highlight: { background: col, border: '#fff' },
      hover:     { background: col, border: '#fff' } } });
  });
  nodes.update(updates);
  console.log('[AS-F4] Degree heatmap ON, range=[' + minDeg + '..' + maxDeg + ']');
}

// ── AS-F3: Asymmetric link detection ─────────────────────────────────────────

function _toggleAsymmetricHighlight() {
  _asymmetricOn = !_asymmetricOn;
  var btn = document.getElementById('btnAsymmetric');
  if (btn) btn.classList.toggle('active', _asymmetricOn);
  if (_asymmetricOn) {
    var result = detectAsymmetricLinks();
    _buildAsymmetricPanel(result);
  } else {
    _clearAsymmetricHighlight();
    var pan = document.getElementById('asymPanel');
    if (pan) pan.remove();
  }
}

function detectAsymmetricLinks() {
  if (typeof edges === 'undefined' || !edges) return [];
  var edgeMap = {};
  edges.get().forEach(function(e) {
    edgeMap[e.from + '-' + e.to] = { id: e.id, from: e.from, to: e.to, cost: _edgeCost(e) };
  });
  var asymmetric = [], seen = {};
  edges.get().forEach(function(e) {
    var fwd = e.from + '-' + e.to, rev = e.to + '-' + e.from;
    if (seen[fwd] || seen[rev]) return;
    seen[fwd] = seen[rev] = true;
    if (edgeMap[fwd] && edgeMap[rev] && edgeMap[fwd].cost !== edgeMap[rev].cost) {
      asymmetric.push({ from: e.from, to: e.to,
        fwdCost: edgeMap[fwd].cost, revCost: edgeMap[rev].cost,
        fwdId: edgeMap[fwd].id,   revId:  edgeMap[rev].id });
    }
  });
  if (asymmetric.length) {
    var asymIds = [];
    asymmetric.forEach(function(a) { asymIds.push(a.fwdId, a.revId); });
    edges.update(edges.get().map(function(e) {
      var hi = asymIds.indexOf(e.id) !== -1;
      return { id: e.id,
        color: hi ? { color:'#f72585', highlight:'#f72585' }
                  : { color:'rgba(150,150,150,0.25)' },
        width: hi ? 3 : 1 };
    }));
  }
  console.log('[AS-F3] Asymmetric links found: ' + asymmetric.length);
  return asymmetric;
}

function _clearAsymmetricHighlight() {
  if (typeof edges === 'undefined' || !edges) return;
  edges.update(edges.get().map(function(e) { return { id: e.id, color: undefined, width: 1 }; }));
}

function _buildAsymmetricPanel(asymmetric) {
  var old = document.getElementById('asymPanel');
  if (old) old.remove();
  if (!asymmetric.length) {
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#1e7e34;' +
      'color:#fff;padding:10px 18px;border-radius:8px;z-index:9999;font-size:13px;';
    toast.textContent = '✓ No asymmetric OSPF links detected';
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 3000);
    return;
  }
  var rows = asymmetric.slice(0, 20).map(function(a) {
    return '<tr><td style="padding:3px 8px;font-size:11px;white-space:nowrap;">' +
      _nodeLabel(a.from) + ' ↔ ' + _nodeLabel(a.to) + '</td>' +
      '<td style="padding:3px 8px;color:#f72585;font-size:11px;white-space:nowrap;">' +
      a.fwdCost + ' / ' + a.revCost + '</td></tr>';
  }).join('');
  var panel = document.createElement('div');
  panel.id  = 'asymPanel';
  panel.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;' +
    'background:#1e2330;border:1px solid #f72585;border-radius:10px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,.55);color:#e0e6f0;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'font-size:12px;min-width:280px;max-width:360px;';
  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;' +
    'padding:10px 14px;border-bottom:1px solid #f72585;background:#262d42;border-radius:10px 10px 0 0;">' +
    '<b>⚡ Asymmetric Links (' + asymmetric.length + ')</b>' +
    '<button onclick="document.getElementById(\'asymPanel\').remove();_clearAsymmetricHighlight();' +
    '_asymmetricOn=false;var b=document.getElementById(\'btnAsymmetric\');if(b)b.classList.remove(\'active\');"' +
    ' style="background:none;border:none;color:#aab;cursor:pointer;font-size:16px;">×</button></div>' +
    '<div style="padding:10px 14px;max-height:300px;overflow-y:auto;">' +
    '<table style="width:100%;border-collapse:collapse;">' +
    '<thead><tr><th style="text-align:left;font-size:10px;color:#778;padding:3px 8px;">Link</th>' +
    '<th style="text-align:left;font-size:10px;color:#778;padding:3px 8px;">Fwd / Rev</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    (asymmetric.length > 20 ? '<div style="color:#778;text-align:center;margin-top:4px;font-size:10px;">…and ' +
      (asymmetric.length-20) + ' more</div>' : '') + '</div>';
  document.body.appendChild(panel);
}

// ── EN-F5: Node properties inspector (click to inspect) ───────────────────────

function _initNodeInspector() {
  if (_inspectorWired || typeof network === 'undefined' || !network) return;
  _inspectorWired = true;
  if (!document.getElementById('niPanelStyle')) {
    var style = document.createElement('style');
    style.id  = 'niPanelStyle';
    style.textContent =
      '#niPanel{position:fixed;bottom:20px;left:20px;z-index:9997;' +
      'background:#1e2330;border:1px solid #3a4560;border-radius:10px;' +
      'box-shadow:0 4px 24px rgba(0,0,0,.55);color:#e0e6f0;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'font-size:12px;min-width:220px;max-width:300px;display:none;}' +
      '#niPanel table{width:100%;border-collapse:collapse;}' +
      '#niPanel td{padding:3px 10px;vertical-align:top;}' +
      '#niPanel td:first-child{color:#778;white-space:nowrap;width:90px;}' +
      '#niPanel td:last-child{color:#e0e6f0;word-break:break-all;}';
    document.head.appendChild(style);
  }
  if (!document.getElementById('niPanel')) {
    var panel = document.createElement('div');
    panel.id  = 'niPanel';
    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;' +
      'padding:8px 12px;border-bottom:1px solid #3a4560;background:#262d42;border-radius:10px 10px 0 0;">' +
      '<b style="font-size:12px;">🔍 Node Properties</b>' +
      '<button onclick="document.getElementById(\'niPanel\').style.display=\'none\';"' +
      ' style="background:none;border:none;color:#aab;cursor:pointer;font-size:15px;">×</button></div>' +
      '<div id="niBody" style="padding:8px 0;"></div>';
    document.body.appendChild(panel);
  }
  network.on('click', function(params) {
    if (params.nodes && params.nodes.length === 1) {
      var n = nodes.get(params.nodes[0]);
      if (n) _showNodeInspector(n);
    } else {
      var p = document.getElementById('niPanel');
      if (p) p.style.display = 'none';
    }
  });
  console.log('[EN-F5] Node inspector wired');
}

function _showNodeInspector(node) {
  var panel = document.getElementById('niPanel');
  var body  = document.getElementById('niBody');
  if (!panel || !body) return;
  var edgeCnt = 0;
  if (typeof edges !== 'undefined' && edges) {
    edges.get().forEach(function(e) { if (e.from === node.id || e.to === node.id) edgeCnt++; });
  }
  var rows = [
    _niRow('Router ID',  node.name || node.label || '-'),
    _niRow('Hostname',   node.hostname || '-'),
    _niRow('Country',    node.country  || node.group || '-'),
    _niRow('Gateway',    node.is_gateway ? '✓ Yes' : 'No'),
    _niRow('Degree',     edgeCnt + ' edge' + (edgeCnt !== 1 ? 's' : '')),
    _niRow('Node ID',    node.id),
  ];
  body.innerHTML = '<table>' + rows.join('') + '</table>';
  panel.style.display = 'block';
}

function _niRow(label, val) {
  return '<tr><td>' + label + '</td><td>' +
    (val !== undefined && val !== null ? String(val) : '—') + '</td></tr>';
}

// ── EN-F4: UNK (unmapped) nodes panel ────────────────────────────────────────

function _buildUnkPanel() {
  var old = document.getElementById('unkPanel');
  if (old) old.remove();
  if (typeof nodes === 'undefined' || !nodes) return;
  var unkNodes = nodes.get().filter(function(n) {
    return (n.country || n.group || '').toUpperCase() === 'UNK';
  });
  if (!unkNodes.length) { console.log('[EN-F4] No UNK nodes'); return; }
  var rows = unkNodes.slice(0, 20).map(function(n) {
    return '<li style="margin:2px 0;font-size:11px;">' +
      (n.hostname || n.label || n.name || String(n.id)) + '</li>';
  }).join('');
  var panel = document.createElement('div');
  panel.id  = 'unkPanel';
  panel.style.cssText = 'position:fixed;top:80px;left:20px;z-index:9996;' +
    'background:#1e2330;border:1px solid #f4a261;border-radius:10px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,.55);color:#e0e6f0;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'font-size:12px;min-width:200px;max-width:280px;';
  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;' +
    'padding:8px 12px;border-bottom:1px solid #f4a261;background:#262d42;border-radius:10px 10px 0 0;">' +
    '<b>⚠ Unknown Nodes (' + unkNodes.length + ')</b>' +
    '<button onclick="document.getElementById(\'unkPanel\').remove();"' +
    ' style="background:none;border:none;color:#aab;cursor:pointer;font-size:15px;">×</button></div>' +
    '<div style="padding:10px 14px;">' +
    '<p style="font-size:11px;color:#f4a261;margin:0 0 8px;">No hostname mapping in host file:</p>' +
    '<ul style="margin:0;padding-left:16px;max-height:180px;overflow-y:auto;">' + rows + '</ul>' +
    (unkNodes.length > 20 ? '<div style="color:#778;text-align:center;margin-top:4px;font-size:10px;">…and ' +
      (unkNodes.length-20) + ' more</div>' : '') +
    '<button onclick="_downloadUnkCsv()" style="margin-top:10px;width:100%;padding:5px;' +
    'background:#2a3248;border:1px solid #3a4560;border-radius:5px;' +
    'color:#88aaff;cursor:pointer;font-size:11px;">⬇ Download CSV</button></div>';
  document.body.appendChild(panel);
  console.log('[EN-F4] UNK panel: ' + unkNodes.length + ' unmapped nodes');
}

function _downloadUnkCsv() {
  if (typeof nodes === 'undefined' || !nodes) return;
  var unkNodes = nodes.get().filter(function(n) {
    return (n.country || n.group || '').toUpperCase() === 'UNK';
  });
  var csv = 'router_id,label\n' + unkNodes.map(function(n) {
    return (n.name || n.label || String(n.id)) + ',' + (n.label || '');
  }).join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url; a.download = 'unk-nodes.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── GW-F1: Cross-country connectivity matrix ──────────────────────────────────

function _toggleConnectivityMatrix() {
  _matrixVisible = !_matrixVisible;
  var btn = document.getElementById('btnMatrix');
  if (btn) btn.classList.toggle('active', _matrixVisible);
  if (_matrixVisible) {
    buildConnectivityMatrix();
  } else {
    var pan = document.getElementById('matrixPanel');
    if (pan) pan.remove();
    if (typeof edges !== 'undefined' && edges) {
      edges.update(edges.get().map(function(e) {
        return { id: e.id, color: undefined, width: undefined };
      }));
    }
  }
}

function buildConnectivityMatrix() {
  var old = document.getElementById('matrixPanel');
  if (old) old.remove();
  if (typeof nodes === 'undefined' || !nodes) return;
  if (typeof edges === 'undefined' || !edges) return;
  var countrySet = {};
  nodes.get().forEach(function(n) {
    var c = (n.country || n.group || 'UNK').toUpperCase();
    if (c !== 'UNK') countrySet[c] = true;
  });
  var countries = Object.keys(countrySet).sort();
  if (!countries.length) return;
  var nodeCountry = {};
  nodes.get().forEach(function(n) {
    nodeCountry[n.id] = (n.country || n.group || 'UNK').toUpperCase();
  });
  var matrix = {}, pairEdges = {};
  countries.forEach(function(a) {
    countries.forEach(function(b) { matrix[a+'|'+b] = 0; pairEdges[a+'|'+b] = []; });
  });
  edges.get().forEach(function(e) {
    var ca = nodeCountry[e.from] || 'UNK', cb = nodeCountry[e.to] || 'UNK';
    if (ca === 'UNK' || cb === 'UNK' || ca === cb) return;
    [ca+'|'+cb, cb+'|'+ca].forEach(function(k) {
      if (matrix[k] !== undefined) { matrix[k]++; pairEdges[k].push(e.id); }
    });
  });
  var maxVal = Math.max.apply(null, Object.values(matrix).concat([0]));
  var headerCells = countries.map(function(c) {
    return '<th style="padding:3px 6px;font-size:10px;color:#9ba8c0;white-space:nowrap;">' + c + '</th>';
  }).join('');
  var bodyRows = countries.map(function(r) {
    var cells = countries.map(function(col) {
      if (r === col) return '<td style="background:#2a3248;padding:3px 6px;"></td>';
      var cnt = matrix[r+'|'+col] || 0;
      var t   = maxVal > 0 ? cnt / maxVal : 0;
      var bg  = cnt === 0 ? '#1a2035' : _lerpColor('#1a5276','#27ae60',t);
      var fg  = cnt === 0 ? '#3a4560' : '#fff';
      var ej  = JSON.stringify(pairEdges[r+'|'+col] || []);
      return '<td style="padding:3px 6px;text-align:center;background:' + bg +
        ';color:' + fg + ';cursor:' + (cnt?'pointer':'default') + ';font-size:11px;"' +
        (cnt ? ' onclick="_highlightEdges(' + ej + ')" title="' + r + '→' + col + ': ' + cnt + ' link(s)"' : '') +
        '>' + (cnt || '') + '</td>';
    }).join('');
    return '<tr><td style="padding:3px 6px;font-size:10px;color:#9ba8c0;font-weight:600;' +
      'white-space:nowrap;background:#262d42;">' + r + '</td>' + cells + '</tr>';
  }).join('');
  var panel = document.createElement('div');
  panel.id  = 'matrixPanel';
  panel.style.cssText = 'position:fixed;top:140px;left:20px;z-index:9997;' +
    'background:#1e2330;border:1px solid #3a4560;border-radius:10px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,.55);color:#e0e6f0;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'font-size:12px;max-width:90vw;';
  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;' +
    'padding:8px 14px;border-bottom:1px solid #3a4560;background:#262d42;border-radius:10px 10px 0 0;">' +
    '<b>📊 Cross-Country Connectivity (' + countries.length + '×' + countries.length + ')</b>' +
    '<button onclick="document.getElementById(\'matrixPanel\').remove();_matrixVisible=false;' +
    'var b=document.getElementById(\'btnMatrix\');if(b)b.classList.remove(\'active\');"' +
    ' style="background:none;border:none;color:#aab;cursor:pointer;font-size:16px;">×</button></div>' +
    '<div style="padding:10px;overflow-x:auto;">' +
    '<table style="border-collapse:collapse;">' +
    '<thead><tr><th style="padding:3px 6px;background:#262d42;"></th>' + headerCells + '</tr></thead>' +
    '<tbody>' + bodyRows + '</tbody></table>' +
    '<div style="font-size:10px;color:#667;margin-top:6px;">Click a cell to highlight those links on the graph (auto-reset after 3 s).</div>' +
    '</div>';
  document.body.appendChild(panel);
  console.log('[GW-F1] Connectivity matrix: ' + countries.length + '×' + countries.length);
}

function _highlightEdges(edgeIds) {
  if (typeof edges === 'undefined' || !edges) return;
  if (!Array.isArray(edgeIds)) return;
  edges.update(edges.get().map(function(e) {
    var hi = edgeIds.indexOf(e.id) !== -1;
    return { id: e.id,
      color: hi ? { color:'#f1c40f', highlight:'#f1c40f' }
                : { color:'rgba(150,150,150,0.2)' },
      width: hi ? 3 : 1 };
  }));
  setTimeout(function() {
    if (typeof edges !== 'undefined' && edges) {
      edges.update(edges.get().map(function(e) { return { id: e.id, color: undefined, width: undefined }; }));
    }
  }, 3000);
}

// ── GW-F4: Gateway redundancy score ──────────────────────────────────────────

function applyRedundancyScore() {
  if (typeof nodes === 'undefined' || !nodes) return;
  if (typeof edges === 'undefined' || !edges) return;
  var gwNodes = nodes.get().filter(function(n) { return n.is_gateway; });
  if (!gwNodes.length) {
    console.warn('[GW-F4] No gateway nodes found — run push-to-ui.py first');
    return;
  }
  var gwCountry = {};
  gwNodes.forEach(function(n) { gwCountry[n.id] = (n.country || n.group || 'UNK').toUpperCase(); });
  var countryGWs = {};  // country → [nodeId,...]
  gwNodes.forEach(function(n) {
    var c = gwCountry[n.id];
    if (!countryGWs[c]) countryGWs[c] = [];
    countryGWs[c].push(n.id);
  });
  // gwForeignLinks[gwId] = { foreignCountry: count }
  var gwForeignLinks = {};
  gwNodes.forEach(function(n) { gwForeignLinks[n.id] = {}; });
  edges.get().forEach(function(e) {
    var ca = gwCountry[e.from], cb = gwCountry[e.to];
    if (!ca || !cb || ca === cb) return;
    if (gwForeignLinks[e.from] !== undefined) {
      gwForeignLinks[e.from][cb] = (gwForeignLinks[e.from][cb] || 0) + 1;
    }
    if (gwForeignLinks[e.to] !== undefined) {
      gwForeignLinks[e.to][ca] = (gwForeignLinks[e.to][ca] || 0) + 1;
    }
  });
  var spofs = [], updates = [];
  gwNodes.forEach(function(n) {
    var myC = gwCountry[n.id];
    var myGWs = countryGWs[myC] || [];
    var foreignCs = Object.keys(gwForeignLinks[n.id] || {});
    var isSPOF = false;
    foreignCs.forEach(function(fc) {
      var others = myGWs.filter(function(id) {
        return id !== n.id && gwForeignLinks[id] && gwForeignLinks[id][fc];
      });
      if (!others.length) {
        isSPOF = true;
        spofs.push({ gateway: n.id, country: myC, foreignCountry: fc });
      }
    });
    var R    = foreignCs.length;
    var col, bw, suffix;
    if (isSPOF) {
      col    = { background:'#e74c3c', border:'#c0392b',
                 highlight:{ background:'#ff6b6b', border:'#e74c3c' },
                 hover:    { background:'#ff6b6b', border:'#e74c3c' } };
      bw     = 4; suffix = '\n⚠ SPOF — sole gateway to ' + foreignCs.join(', ');
    } else if (R >= 3) {
      col    = { background:'#27ae60', border:'#1e8449',
                 highlight:{ background:'#58d68d', border:'#27ae60' },
                 hover:    { background:'#58d68d', border:'#27ae60' } };
      bw     = 2; suffix = '\n✓ Resilient (R=' + R + ')';
    } else {
      col    = { background:'#f39c12', border:'#d68910',
                 highlight:{ background:'#f8c471', border:'#f39c12' },
                 hover:    { background:'#f8c471', border:'#f39c12' } };
      bw     = 2; suffix = '\n~ Dual-homed (R=' + R + ')';
    }
    updates.push({ id: n.id, color: col, borderWidth: bw,
                   title: (n.title || n.label || '') + suffix });
  });
  if (updates.length) nodes.update(updates);
  _buildRedundancyPanel(spofs);
  console.log('[GW-F4] Redundancy applied. SPOFs: ' + spofs.length + '/' + gwNodes.length + ' gateways');
}

function _buildRedundancyPanel(spofs) {
  var old = document.getElementById('redundancyPanel');
  if (old) old.remove();
  var borderCol = spofs.length ? '#e74c3c' : '#27ae60';
  var spofHTML;
  if (!spofs.length) {
    spofHTML = '<p style="color:#27ae60;margin:0;font-size:12px;">✓ No SPOF gateways detected</p>';
  } else {
    spofHTML = '<p style="color:#e74c3c;margin:0 0 6px;font-size:12px;">⚠ ' + spofs.length + ' SPOF condition(s):</p>' +
      '<ul style="margin:0;padding-left:16px;max-height:160px;overflow-y:auto;">' +
      spofs.slice(0,15).map(function(s) {
        return '<li style="font-size:11px;margin:2px 0;">' +
          _nodeLabel(s.gateway) + ' (' + s.country + ' → ' + s.foreignCountry + ')</li>';
      }).join('') + '</ul>' +
      (spofs.length > 15 ? '<div style="color:#778;text-align:center;font-size:10px;">…and ' + (spofs.length-15) + ' more</div>' : '');
  }
  var panel = document.createElement('div');
  panel.id  = 'redundancyPanel';
  panel.style.cssText = 'position:fixed;bottom:20px;right:300px;z-index:9997;' +
    'background:#1e2330;border:1px solid ' + borderCol + ';border-radius:10px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,.55);color:#e0e6f0;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'font-size:12px;min-width:220px;max-width:320px;';
  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;' +
    'padding:8px 12px;border-bottom:1px solid ' + borderCol + ';background:#262d42;border-radius:10px 10px 0 0;">' +
    '<b>🛡 Gateway Redundancy</b>' +
    '<button onclick="document.getElementById(\'redundancyPanel\').remove();"' +
    ' style="background:none;border:none;color:#aab;cursor:pointer;font-size:15px;">×</button></div>' +
    '<div style="padding:10px 14px;">' + spofHTML + '</div>' +
    '<div style="padding:4px 14px 10px;font-size:10px;color:#667;">' +
    '<span style="color:#e74c3c;">■</span> SPOF &nbsp;' +
    '<span style="color:#f39c12;">■</span> Dual &nbsp;' +
    '<span style="color:#27ae60;">■</span> Resilient (R≥3)</div>';
  document.body.appendChild(panel);
}

// ── CL-F4: Inter-country OSPF cost table ─────────────────────────────────────

function buildInterCountryCostTable() {
  var old = document.getElementById('costTablePanel');
  if (old) old.remove();
  if (typeof nodes === 'undefined' || !nodes) return;
  if (typeof edges === 'undefined' || !edges) return;
  var nodeCountry = {};
  nodes.get().forEach(function(n) {
    nodeCountry[n.id] = (n.country || n.group || 'UNK').toUpperCase();
  });
  var pairCosts = {};   // "A|B" → [cost,...]
  edges.get().forEach(function(e) {
    var ca = nodeCountry[e.from] || 'UNK', cb = nodeCountry[e.to] || 'UNK';
    if (ca === 'UNK' || cb === 'UNK' || ca === cb) return;
    var key = [ca, cb].sort().join('|');
    if (!pairCosts[key]) pairCosts[key] = [];
    pairCosts[key].push(_edgeCost(e));
  });
  var tableRows = Object.keys(pairCosts).sort().map(function(key) {
    var parts = key.split('|');
    var costs = pairCosts[key];
    var minC  = Math.min.apply(null, costs);
    var maxC  = Math.max.apply(null, costs);
    var avgC  = Math.round(costs.reduce(function(a,b){return a+b;},0)/costs.length);
    var fc    = costs.length === 1 ? 'color:#e74c3c;' : costs.length === 2 ? 'color:#f39c12;' : 'color:#27ae60;';
    return '<tr><td style="padding:3px 10px;font-weight:600;font-size:11px;">' + parts[0] + '</td>' +
      '<td style="padding:3px 4px;font-size:11px;">↔</td>' +
      '<td style="padding:3px 10px;font-weight:600;font-size:11px;">' + parts[1] + '</td>' +
      '<td style="padding:3px 10px;font-size:11px;">' + minC + '</td>' +
      '<td style="padding:3px 10px;font-size:11px;">' + maxC + '</td>' +
      '<td style="padding:3px 10px;font-size:11px;">' + avgC + '</td>' +
      '<td style="padding:3px 10px;font-size:11px;' + fc + '">' + costs.length + '</td></tr>';
  }).join('');
  if (!tableRows) {
    tableRows = '<tr><td colspan="7" style="padding:10px;text-align:center;color:#778;">No inter-country edges found</td></tr>';
  }
  var panel = document.createElement('div');
  panel.id  = 'costTablePanel';
  panel.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:9997;' +
    'background:#1e2330;border:1px solid #3a4560;border-radius:10px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,.55);color:#e0e6f0;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'font-size:12px;max-width:500px;overflow-x:auto;';
  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;' +
    'padding:8px 14px;border-bottom:1px solid #3a4560;background:#262d42;border-radius:10px 10px 0 0;">' +
    '<b>🔗 Inter-Country Link Costs</b>' +
    '<button onclick="document.getElementById(\'costTablePanel\').remove();"' +
    ' style="background:none;border:none;color:#aab;cursor:pointer;font-size:16px;">×</button></div>' +
    '<div style="padding:10px;overflow-x:auto;">' +
    '<table style="border-collapse:collapse;width:100%;">' +
    '<thead><tr style="border-bottom:1px solid #3a4560;">' +
    '<th style="padding:3px 10px;text-align:left;font-size:10px;color:#9ba8c0;">From</th><th></th>' +
    '<th style="padding:3px 10px;text-align:left;font-size:10px;color:#9ba8c0;">To</th>' +
    '<th style="padding:3px 10px;text-align:right;font-size:10px;color:#9ba8c0;">Min</th>' +
    '<th style="padding:3px 10px;text-align:right;font-size:10px;color:#9ba8c0;">Max</th>' +
    '<th style="padding:3px 10px;text-align:right;font-size:10px;color:#9ba8c0;">Avg</th>' +
    '<th style="padding:3px 10px;text-align:right;font-size:10px;color:#9ba8c0;">Links</th>' +
    '</tr></thead><tbody>' + tableRows + '</tbody></table>' +
    '<div style="font-size:10px;color:#667;margin-top:6px;">' +
    '<span style="color:#e74c3c;">■</span> SPOF (1) &nbsp;' +
    '<span style="color:#f39c12;">■</span> Dual (2) &nbsp;' +
    '<span style="color:#27ae60;">■</span> Resilient (3+)</div></div>';
  document.body.appendChild(panel);
  console.log('[CL-F4] Cost table: ' + Object.keys(pairCosts).length + ' country pairs');
}

// ══════════════════════════════════════════════════════════════════════════════
//  SPRINT 3 — FEATURES A / B / C
//  A: Unclassified-Node Highlight + Hostname Upload & Classification
//  B: OSPF Cost Matrix (Dijkstra APSP, heat-map, Excel export, cascade edit)
//  C: OSPF What-If / Impact Analysis
//
//  Scholar's Note (Parnas/Dijkstra synthesis):
//    Feature A implements query-filter orthogonality — the UNK highlight
//    is a pure view-layer concern, independent of topology data.
//    Feature B applies Dijkstra's shortest-path principle at the COUNTRY
//    level, aggregating node-level SPF results into a policy-visible matrix.
//    Feature C implements incremental SPF — only re-runs Dijkstra from
//    sources reachable through the changed edge, giving O(k·(V+E)logV)
//    instead of O(V·(V+E)logV) for large networks.
// ══════════════════════════════════════════════════════════════════════════════

// ── Sprint 3: shared state ────────────────────────────────────────────────────
var _unkHighlightActive  = false;   // A: UNK orange highlight toggle
var _unkOrigColors       = {};      // A: saved node colors before highlight
var _hostnameMap         = {};      // A: {router_id → {hostname, country}}
var _matrixData          = null;    // B: last computed matrix { countries, dist }
var _whatIfEdgeId        = null;    // C: currently selected edge for what-if
var _whatIfOrigCost      = null;    // C: original cost of selected edge

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE A — Unclassified-Node Highlight + Hostname Upload
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Toggle orange highlight on all nodes whose country = 'UNK'.
 * Works in any view mode — purely a vis.js DataSet color overlay.
 */
function _toggleUnkHighlight() {
  var btn = document.getElementById('btnUnkHighlight');
  _unkHighlightActive = !_unkHighlightActive;
  if (btn) btn.classList.toggle('active', _unkHighlightActive);

  if (typeof nodes === 'undefined' || !nodes) return;

  if (_unkHighlightActive) {
    // Save original colors and paint UNK nodes orange
    _unkOrigColors = {};
    var updates = [];
    nodes.get().forEach(function(n) {
      var country = (n.country || n.group || '').toUpperCase();
      if (country === 'UNK') {
        _unkOrigColors[n.id] = { color: n.color, borderWidth: n.borderWidth, size: n.size };
        updates.push({
          id: n.id,
          color: { background: '#f4a261', border: '#e76500', highlight: { background: '#ff8c42', border: '#cc5500' } },
          borderWidth: 4,
          size: (n.size || 15) * 1.4
        });
      }
    });
    if (updates.length) nodes.update(updates);

    // Show UNK badge count in button label
    var unkCount = updates.length;
    if (btn) btn.textContent = '\u26a0 UNK (' + unkCount + ')';
    if (unkCount === 0) {
      if (btn) btn.textContent = '\u26a0 UNK (0)';
      btn && btn.classList.remove('active');
      _unkHighlightActive = false;
      console.log('[SP3-A] No UNK nodes in current graph');
    } else {
      console.log('[SP3-A] Highlighted ' + unkCount + ' UNK nodes');
    }
  } else {
    // Restore original colors
    var restores = [];
    Object.keys(_unkOrigColors).forEach(function(id) {
      var orig = _unkOrigColors[id];
      restores.push({ id: id, color: orig.color || undefined, borderWidth: orig.borderWidth || 1, size: orig.size || 15 });
    });
    if (restores.length) nodes.update(restores);
    _unkOrigColors = {};
    if (btn) btn.textContent = '\u26a0 UNK';
    console.log('[SP3-A] UNK highlight cleared');
  }
}

/**
 * Build the Hostname Upload panel.
 * Accepts a CSV file: router_id,hostname,country  (header optional)
 * or a two-column file: hostname_prefix,country  (prefix-based mapping)
 *
 * After upload the vis.js node DataSet is updated in-place — nodes whose
 * router_id is in the file get the mapped country; all others become 'UNK'.
 * Country colours are re-applied and the UNK panel is refreshed.
 */
function buildHostnameUploadPanel() {
  var old = document.getElementById('hostnameUploadPanel');
  if (old) { old.remove(); return; }

  var panel = document.createElement('div');
  panel.id  = 'hostnameUploadPanel';
  panel.style.cssText =
    'position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:10000;' +
    'background:#1e2330;border:1px solid #3a4560;border-radius:12px;' +
    'box-shadow:0 8px 36px rgba(0,0,0,.7);color:#e0e6f0;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'font-size:13px;min-width:480px;max-width:600px;';

  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;' +
    'padding:10px 16px;border-bottom:1px solid #3a4560;background:#262d42;border-radius:12px 12px 0 0;">' +
    '<b>📂 Upload Hostname / Country Mapping</b>' +
    '<button onclick="document.getElementById(\'hostnameUploadPanel\').remove();" ' +
    'style="background:none;border:none;color:#aab;cursor:pointer;font-size:18px;">×</button></div>' +

    '<div style="padding:16px;">' +
    (function() {
      var nodeTotal = (typeof nodes!=='undefined'&&nodes) ? nodes.get().length : 0;
      var unkTotal  = (typeof nodes!=='undefined'&&nodes) ?
        nodes.get().filter(function(n){return(n.country||n.group||'').toUpperCase()==='UNK';}).length : 0;
      return '<div style="background:#141824;border-radius:6px;padding:6px 12px;margin-bottom:10px;' +
        'display:flex;gap:16px;font-size:11px;">' +
        '<span style="color:#9ba8c0;">Graph nodes: <b style="color:#e0e6f0;">' + nodeTotal + '</b></span>' +
        '<span style="color:#9ba8c0;">Classified: <b style="color:#27ae60;">' + (nodeTotal-unkTotal) + '</b></span>' +
        '<span style="color:#9ba8c0;">Unclassified (UNK): <b style="color:' + (unkTotal>0?'#f4a261':'#27ae60') + ';">' + unkTotal + '</b></span>' +
        '</div>';
    })() +
    '<p style="color:#9ba8c0;margin:0 0 10px;font-size:12px;">' +
    'Upload a CSV to assign countries to routers.<br>' +
    'Routers NOT in the file will be labelled <span style="color:#f4a261;font-weight:600;">UNK</span>.</p>' +

    '<div style="background:#141824;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:11px;color:#778;">' +
    '<b style="color:#9ba8c0;">Accepted formats:</b><br>' +
    '<code style="color:#7ec8e3;">router_id, hostname, country</code>&nbsp;&nbsp;(country column ignored; derived from hostname)<br>' +
    '<code style="color:#7ec8e3;">router_id, hostname</code>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(standard host CSV; country auto-derived)<br>' +
    '<code style="color:#7ec8e3;">router_id hostname</code>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(standard host TXT; country auto-derived)<br>' +
    'First line may be a header row — it is auto-detected.</div>' +

    /* Drag-drop upload zone */
    '<div id="hostDropZone" ' +
    'style="border:2px dashed #3a4560;border-radius:8px;padding:18px 12px;margin-bottom:10px;' +
    'text-align:center;cursor:pointer;transition:.2s;background:#141824;" ' +
    'ondragover="event.preventDefault();this.style.borderColor=\'#7ec8ff\';this.style.background=\'#1a2a40\';" ' +
    'ondragleave="this.style.borderColor=\'#3a4560\';this.style.background=\'#141824\';" ' +
    'ondrop="event.preventDefault();this.style.borderColor=\'#3a4560\';this.style.background=\'#141824\';' +
    'var f=event.dataTransfer.files[0];if(f){var r=new FileReader();r.onload=function(e){_applyHostnameMapping(e.target.result,f.name);};r.readAsText(f);}" ' +
    'onclick="document.getElementById(\'hostFilePicker\').click();">' +
    '<div style="font-size:22px;margin-bottom:4px;">📄</div>' +
    '<div style="font-size:12px;color:#9ba8c0;">Drag & drop CSV here</div>' +
    '<div style="font-size:11px;color:#445;margin-top:2px;">or click to choose file</div>' +
    '<input type="file" id="hostFilePicker" accept=".csv,.txt" style="display:none;">' +
    '</div>' +

    '<div id="hostFileStatus" style="min-height:24px;font-size:12px;color:#9ba8c0;margin-bottom:12px;"></div>' +

    '<div style="background:#141824;border-radius:8px;padding:8px 12px;margin-bottom:12px;">' +
    '<b style="color:#9ba8c0;font-size:11px;">Manual single-node reclassify:</b>' +
    '<div style="display:flex;gap:8px;margin-top:6px;">' +
    '<input id="hostManualId" type="text" placeholder="Router ID (e.g. 18.18.18.3)" ' +
    'style="flex:2;background:#1e2330;border:1px solid #3a4560;border-radius:4px;color:#e0e6f0;padding:4px 8px;font-size:12px;">' +
    '<input id="hostManualCountry" type="text" placeholder="Country (e.g. ZAF)" ' +
    'style="flex:1;background:#1e2330;border:1px solid #3a4560;border-radius:4px;color:#e0e6f0;padding:4px 8px;font-size:12px;">' +
    '<button onclick="_applyManualNodeCountry()" ' +
    'style="padding:4px 12px;background:#0d6efd;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:12px;">Apply</button>' +
    '</div></div>' +

    '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
    '<button onclick="_showUnkNodesList()" ' +
    'style="padding:6px 14px;background:#2a3248;border:1px solid #3a4560;border-radius:6px;color:#88aaff;cursor:pointer;font-size:12px;">📋 List UNK Nodes</button>' +
    '<button onclick="_downloadUnkCsv()" ' +
    'style="padding:6px 14px;background:#2a3248;border:1px solid #3a4560;border-radius:6px;color:#88aaff;cursor:pointer;font-size:12px;">⬇ Export UNK CSV</button>' +
    '</div></div>';

  document.body.appendChild(panel);

  // Wire the file picker
  var picker = document.getElementById('hostFilePicker');
  if (picker) {
    picker.addEventListener('change', function(evt) {
      var file = evt.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(e) {
        _applyHostnameMapping(e.target.result, file.name);
      };
      reader.readAsText(file);
    });
  }
}

/**
 * Parse and apply hostname/country CSV to the vis.js nodes.
 * Supports 2-col (id,country), 3-col (id,hostname,country), prefix mapping.
 * After reclassification:
 *   • Country colours are re-applied via applyCountryColors()
 *   • UNK badge count is updated
 *   • localStorage persists the mapping for the session
 */
function _applyHostnameMapping(csvText, filename) {
  var status = document.getElementById('hostFileStatus');
  function setStatus(msg, color) {
    if (status) status.innerHTML = '<span style="color:' + (color||'#9ba8c0') + ';">' + msg + '</span>';
  }

  if (!csvText || !csvText.trim()) { setStatus('Empty file.', '#e74c3c'); return; }

  var lines = csvText.trim().split(/\r?\n/).filter(function(l) { return l.trim(); });
  if (!lines.length) { setStatus('No data rows found.', '#e74c3c'); return; }

  var idToHostname = {};

  for (var i = 0; i < lines.length; i++) {
    var rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('#')) continue;

    var cols = rawLine.indexOf(',') >= 0
      ? rawLine.split(',').map(function(c) { return c.trim(); })
      : rawLine.split(/\s+/, 2).map(function(c) { return c.trim(); });

    if (cols.length < 2) continue;

    var c0 = (cols[0] || '').trim();
    var c1 = (cols[1] || '').trim();
    var c2 = (cols[2] || '').trim();
    var c0l = c0.toLowerCase();
    var c1l = c1.toLowerCase();

    if (c0l === 'router_id' || c0l === 'device_ip_address' || c0l === 'hostname_prefix' ||
        c0l === 'hostname' || c0l === 'id' || c1l === 'hostname' || c1l === 'device_name' || c1l === 'country') {
      continue;
    }

    if (_looksLikeIpv4(c0) && c1) {
      idToHostname[c0] = c1;
    } else if (c2 && _looksLikeIpv4(c1)) {
      idToHostname[c1] = c2;
    }
  }

  // Apply to vis.js nodes
  if (typeof nodes === 'undefined' || !nodes) { setStatus('Graph not loaded.', '#e74c3c'); return; }

  var updated = 0, unkCount = 0, matched = 0;
  var allNodes = nodes.get();
  var updates  = [];

  allNodes.forEach(function(n) {
    var nodeId   = String(n.name || n.router_id || n.label || n.id || '').trim();
    var currentHostname = String(n.hostname || '').trim();
    var hostname = idToHostname[nodeId] || currentHostname;
    var country  = hostname ? _deriveCountryCodeFromHostname(hostname) : 'UNK';
    if (!country) country = 'UNK';

    if (country) {
      if (country !== 'UNK' || hostname) matched++;
      var nextLabel = _buildCountryAwareNodeLabel({
        id: n.id,
        name: n.name,
        router_id: n.router_id,
        hostname: hostname,
        label: n.label,
        country: country,
        group: country
      });
      var nextTitle = _buildCountryAwareNodeTitle({
        id: n.id,
        name: n.name,
        router_id: n.router_id,
        hostname: hostname || n.name || n.id,
        country: country,
        is_gateway: n.is_gateway === true
      });
      if ((n.country || 'UNK').toUpperCase() !== country ||
          (hostname && hostname !== currentHostname) ||
          (n.group || 'UNK').toUpperCase() !== country ||
          n.label !== nextLabel ||
          n.title !== nextTitle) {
        updates.push({ id: n.id, hostname: hostname || currentHostname, country: country, group: country, label: nextLabel, title: nextTitle });
        updated++;
      }
    }

    if (country === 'UNK') {
      unkCount++;
    }
  });

  if (updates.length) nodes.update(updates);

  // Persist to _hostnameMap for reference
  _hostnameMap = idToHostname;
  try { localStorage.setItem('_topolograph_hostname_map', JSON.stringify(idToHostname)); } catch(e2) {}

  // Re-apply country colours
  if (typeof applyCountryColors === 'function') applyCountryColors();

  setStatus(
    '\u2705 Applied <b>' + filename + '</b>: ' + matched + ' mapped, ' +
    '<span style="color:#f4a261;">' + unkCount + ' UNK</span>, ' + updated + ' updated.',
    '#27ae60'
  );
  console.log('[SP3-A] Hostname mapping applied: ' + matched + ' matched, ' + unkCount + ' UNK, ' + updated + ' node updates');

  // Refresh UNK button label
  var unkBtn = document.getElementById('btnUnkHighlight');
  if (unkBtn) unkBtn.textContent = '\u26a0 UNK' + (unkCount > 0 ? ' (' + unkCount + ')' : '');
}

function _reapplySavedHostnameMapping() {
  if (typeof nodes === 'undefined' || !nodes) return false;
  try {
    var raw = localStorage.getItem('_topolograph_hostname_map');
    if (!raw) return false;
    var saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return false;
    var lines = [];
    Object.keys(saved).forEach(function(routerId) {
      var hostname = String(saved[routerId] || '').trim();
      if (routerId && hostname) lines.push(routerId + ',' + hostname);
    });
    if (!lines.length) return false;
    _applyHostnameMapping('router_id,hostname\n' + lines.join('\n'), 'saved browser mapping');
    return true;
  } catch (err) {
    console.warn('[SP3-A] Could not reapply saved hostname mapping', err);
    return false;
  }
}

/** Manually reclassify a single node from the upload panel. */
function _applyManualNodeCountry() {
  var idEl  = document.getElementById('hostManualId');
  var cEl   = document.getElementById('hostManualCountry');
  if (!idEl || !cEl) return;
  var rid     = (idEl.value || '').trim();
  var country = (cEl.value || '').trim().toUpperCase();
  if (!rid || !country) { alert('Both Router ID and Country are required.'); return; }
  if (typeof nodes === 'undefined' || !nodes) return;

  var n = nodes.get().find(function(n) { return (n.name || n.label || String(n.id)) === rid; });
  if (!n) { alert('Router ID not found: ' + rid); return; }
  nodes.update([{ id: n.id, country: country }]);
  if (typeof applyCountryColors === 'function') applyCountryColors();
  var status = document.getElementById('hostFileStatus');
  if (status) status.innerHTML = '<span style="color:#27ae60;">\u2705 ' + rid + ' → ' + country + '</span>';
  console.log('[SP3-A] Manual reclassify: ' + rid + ' → ' + country);
}

/** Show the UNK nodes list panel (re-uses existing _buildUnkPanel). */
function _showUnkNodesList() { _buildUnkPanel(); }

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE B — OSPF Cost Matrix
//  Dijkstra APSP → country-level NxN heat-map + Excel export + cascade edit
//  Scalability: adjacency-list per-source Dijkstra, O((V+E)logV) per source
//  For country-level matrix: only run from gateway nodes (≤28 sources) even
//  for large networks — reduces complexity to O(G·(V+E)logV) where G<<V.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Minimal binary min-heap for Dijkstra.
 * Stores {dist, nodeId} pairs; O(log n) push/pop.
 */
function _MinHeap() {
  this._h = [];
}
_MinHeap.prototype.push = function(item) {
  this._h.push(item);
  this._siftUp(this._h.length - 1);
};
_MinHeap.prototype.pop = function() {
  var top = this._h[0];
  var last = this._h.pop();
  if (this._h.length > 0) { this._h[0] = last; this._siftDown(0); }
  return top;
};
_MinHeap.prototype.isEmpty = function() { return this._h.length === 0; };
_MinHeap.prototype._siftUp = function(i) {
  var h = this._h;
  while (i > 0) {
    var p = (i - 1) >> 1;
    if (h[p].dist <= h[i].dist) break;
    var tmp = h[p]; h[p] = h[i]; h[i] = tmp; i = p;
  }
};
_MinHeap.prototype._siftDown = function(i) {
  var h = this._h, n = h.length;
  while (true) {
    var l = 2*i+1, r = 2*i+2, s = i;
    if (l < n && h[l].dist < h[s].dist) s = l;
    if (r < n && h[r].dist < h[s].dist) s = r;
    if (s === i) break;
    var tmp = h[s]; h[s] = h[i]; h[i] = tmp; i = s;
  }
};

/**
 * Single-source Dijkstra on an adjacency list.
 * adjList: Map<nodeId → [{to: nodeId, cost: number}]>
 * Returns Map<nodeId → shortestDist>
 */
function _dijkstraSingle(srcId, adjList) {
  var dist = new Map();
  var heap = new _MinHeap();
  dist.set(srcId, 0);
  heap.push({ dist: 0, id: srcId });

  while (!heap.isEmpty()) {
    var u = heap.pop();
    if (u.dist > (dist.get(u.id) || Infinity)) continue;  // stale entry
    var nbrs = adjList.get(u.id) || [];
    for (var i = 0; i < nbrs.length; i++) {
      var v    = nbrs[i].to;
      var nd   = u.dist + nbrs[i].cost;
      if (nd < (dist.get(v) !== undefined ? dist.get(v) : Infinity)) {
        dist.set(v, nd);
        heap.push({ dist: nd, id: v });
      }
    }
  }
  return dist;
}

/**
 * Build adjacency list from vis.js edges DataSet.
 * Uses _edgeCost() for robust cost extraction.
 * Optionally apply an override: {edgeId → newCost} for what-if simulations.
 */
function _buildAdjList(overrides) {
  overrides = overrides || {};
  var adj = new Map();
  if (typeof edges === 'undefined' || !edges) return adj;
  edges.get().forEach(function(e) {
    if (e.hidden === true) return;            // respect current visibility
    var cost = overrides.hasOwnProperty(e.id) ? overrides[e.id] : _edgeCost(e);
    if (cost <= 0) cost = 1;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push({ to: e.to, cost: cost });
    // OSPF edges are directional — vis.js may store both directions separately
    // If both directions exist they'll each be in the DataSet independently.
    // We don't add the reverse here to preserve directed OSPF semantics.
  });
  return adj;
}

/**
 * Compute the country-level cost matrix:
 *   For each ordered pair (countryA, countryB),
 *   find the minimum shortest-path cost from any node in A to any node in B.
 *
 * For scalability: only run Dijkstra from GATEWAY nodes in each country.
 * Gateway nodes are the border points visible in every view mode.
 *
 * Returns:
 *   { countries: [sorted string list], dist: {countryA: {countryB: minCost}} }
 */
function _computeCountryMatrix(adjListOverride) {
  if (typeof nodes === 'undefined' || !nodes) return null;
  var adj = adjListOverride || _buildAdjList();

  // Build country → gateway node IDs mapping
  var countryGWs = {};
  var countryAllNodes = {};
  nodes.get().forEach(function(n) {
    var c = (n.country || n.group || 'UNK').toUpperCase();
    if (!countryAllNodes[c]) countryAllNodes[c] = [];
    countryAllNodes[c].push(n.id);
    if (n.is_gateway === true || !n.is_gateway) {   // include all if no is_gateway set
      if (!countryGWs[c]) countryGWs[c] = [];
      countryGWs[c].push(n.id);
    }
  });

  // UNK is treated as a proper country group (isolated clusters → N/R values, which is informative)
  var countries = Object.keys(countryGWs).sort();

  // Per-country: for each gateway in this country, run Dijkstra; union results
  var countryDist = {};  // { country → Map<nodeId → minDist> }

  countries.forEach(function(c) {
    var gws = countryGWs[c] || [];
    var merged = new Map();
    gws.forEach(function(gwId) {
      var d = _dijkstraSingle(gwId, adj);
      d.forEach(function(dist, nodeId) {
        if (!merged.has(nodeId) || dist < merged.get(nodeId)) {
          merged.set(nodeId, dist);
        }
      });
    });
    countryDist[c] = merged;
  });

  // Aggregate to country-level NxN matrix
  var matDist = {};
  countries.forEach(function(src) {
    matDist[src] = {};
    var srcDist = countryDist[src];
    countries.forEach(function(dst) {
      if (src === dst) { matDist[src][dst] = 0; return; }
      var minCost = Infinity;
      (countryAllNodes[dst] || []).forEach(function(dstNodeId) {
        if (srcDist.has(dstNodeId) && srcDist.get(dstNodeId) < minCost) {
          minCost = srcDist.get(dstNodeId);
        }
      });
      matDist[src][dst] = (minCost === Infinity) ? null : minCost;
    });
  });

  return { countries: countries, dist: matDist };
}

/**
 * Build and show the OSPF Cost Matrix panel.
 * Hot paths: lazy compute on open; refresh on cost change.
 */
function buildOspfCostMatrix() {
  var old = document.getElementById('ospfCostMatrixPanel');
  if (old) { old.remove(); _matrixData = null; return; }

  _matrixData = _computeCountryMatrix();
  if (!_matrixData) return;

  var countries = _matrixData.countries;
  var dist      = _matrixData.dist;

  // Find min/max for heat-map colour scaling (exclude 0-diagonal)
  var allCosts = [];
  countries.forEach(function(src) {
    countries.forEach(function(dst) {
      if (src !== dst && dist[src][dst] !== null) allCosts.push(dist[src][dst]);
    });
  });
  var minCost = allCosts.length ? Math.min.apply(null, allCosts) : 0;
  var maxCost = allCosts.length ? Math.max.apply(null, allCosts) : 1;

  function cellColor(val) {
    if (val === null) return '#2a2a3a';
    if (val === 0)    return '#1e2330';
    var t = (val - minCost) / Math.max(1, maxCost - minCost);
    return _lerpColor('#27ae60', '#e74c3c', t);
  }

  // Build table HTML
  var colHeaders = '<th style="padding:4px 8px;background:#262d42;font-size:10px;color:#9ba8c0;"></th>' +
    countries.map(function(c) {
      return '<th style="padding:4px 6px;background:#262d42;font-size:10px;color:#9ba8c0;' +
        'white-space:nowrap;">' + c + '</th>';
    }).join('');

  var rows = countries.map(function(src) {
    var cells = countries.map(function(dst) {
      var val = dist[src][dst];
      var bg  = cellColor(val);
      var txt = (val === null) ? 'N/R' : (val === 0) ? '—' : String(val);
      var fgColor = (val === null) ? '#445' : (val === 0) ? '#3a4a5a' : '#fff';
      return '<td data-src="' + src + '" data-dst="' + dst + '" ' +
        'style="padding:4px 7px;text-align:center;font-size:11px;font-weight:600;' +
        'background:' + bg + ';color:' + fgColor + ';cursor:pointer;' +
        'border:1px solid rgba(255,255,255,.04);" ' +
        'title="' + src + ' → ' + dst + ': ' + txt + ' (click to highlight path)" ' +
        'onclick="_matrixCellClick(\'' + src + '\',\'' + dst + '\')">' + txt + '</td>';
    }).join('');
    return '<tr><td style="padding:4px 8px;background:#262d42;font-size:10px;color:#9ba8c0;' +
      'font-weight:600;white-space:nowrap;">' + src + '</td>' + cells + '</tr>';
  }).join('');

  var panel = document.createElement('div');
  panel.id  = 'ospfCostMatrixPanel';
  panel.style.cssText =
    'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:9998;' +
    'background:#1e2330;border:1px solid #3a4560;border-radius:12px;' +
    'box-shadow:0 8px 40px rgba(0,0,0,.75);color:#e0e6f0;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'font-size:12px;max-width:90vw;max-height:85vh;overflow:auto;';

  // Current view mode badge
  var curMode = (typeof _viewMode !== 'undefined' ? _viewMode : 'enriched').toUpperCase();
  var modeBadge = '<span style="font-size:10px;background:#0d3a6e;border:1px solid #1a5faa;' +
    'border-radius:4px;padding:2px 7px;margin-left:8px;color:#7ec8ff;font-weight:600;">' + curMode + '</span>';

  // Gradient legend bar (visual colour scale from min to max)
  var legendStops = '';
  for (var ls = 0; ls <= 100; ls += 10) {
    legendStops += '<span style="display:inline-block;width:9%;height:10px;background:' +
      _lerpColor('#27ae60','#e74c3c', ls/100) + ';"></span>';
  }
  var legendBar =
    '<div style="padding:8px 14px 6px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #262d42;">' +
    '<span style="font-size:10px;color:#9ba8c0;white-space:nowrap;">Cost range:</span>' +
    '<span style="color:#27ae60;font-size:10px;font-weight:700;">' + minCost + '</span>' +
    '<div style="display:inline-flex;border-radius:3px;overflow:hidden;flex:1;max-width:200px;">' + legendStops + '</div>' +
    '<span style="color:#e74c3c;font-size:10px;font-weight:700;">' + maxCost + '</span>' +
    '<span style="font-size:10px;color:#556;margin-left:8px;">∞ = no path &nbsp;&nbsp; — = same country</span>' +
    '</div>';

  panel.innerHTML =
    /* ── Sticky header ── */
    '<div style="display:flex;align-items:center;justify-content:space-between;' +
    'padding:10px 16px;border-bottom:1px solid #3a4560;background:#262d42;border-radius:12px 12px 0 0;' +
    'position:sticky;top:0;z-index:1;">' +
    '<span><b>🗺 OSPF Cost Matrix</b>' + modeBadge + '</span>' +
    '<div style="display:flex;gap:6px;align-items:center;">' +
    '<span style="font-size:10px;color:#556;">' + countries.length + '×' + countries.length + '</span>' +
    '<button onclick="_exportMatrixToExcel()" title="Download as Excel (.xlsx)" ' +
    'style="padding:4px 12px;background:#27ae60;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:11px;">⬇ Excel</button>' +
    '<button onclick="_refreshCostMatrix()" title="Recompute matrix from current graph" ' +
    'style="padding:4px 10px;background:#2a3248;border:1px solid #3a4560;border-radius:6px;color:#88aaff;cursor:pointer;font-size:11px;">↺</button>' +
    '<button onclick="document.getElementById(\'ospfCostMatrixPanel\').remove();_matrixData=null;" ' +
    'style="background:none;border:none;color:#aab;cursor:pointer;font-size:18px;padding:0 4px;">×</button>' +
    '</div></div>' +
    legendBar +
    /* ── Subtitle ── */
    '<div style="padding:6px 14px 4px;font-size:10px;color:#4a5568;">' +
    'Click any cell to highlight the shortest path on the topology. ' +
    'Dijkstra APSP from gateway nodes per country.</div>' +
    /* ── Matrix table ── */
    '<div style="overflow:auto;padding:0 12px 12px;">' +
    '<table style="border-collapse:collapse;"><thead><tr>' + colHeaders + '</tr></thead><tbody>' +
    rows + '</tbody></table></div>';

  document.body.appendChild(panel);
  console.log('[SP3-B] Cost Matrix: ' + countries.length + 'x' + countries.length + ' countries');
}

/**
 * Refresh the cost matrix panel in-place (after cost changes).
 * FIX: buildOspfCostMatrix() is a TOGGLE (closes if already open).
 * We must first explicitly remove the old panel, then call build to create fresh.
 * This ensures ↺ button and _applyWhatIf() actually REBUILD rather than CLOSE the panel.
 */
function _refreshCostMatrix() {
  var old = document.getElementById('ospfCostMatrixPanel');
  if (old) { old.remove(); _matrixData = null; }   // close old without early-return
  buildOspfCostMatrix();                             // panel gone → build creates fresh
  console.log('[SP3-B] Cost Matrix refreshed (rebuild)');
}

/**
 * Cell click handler — highlight the shortest-path edges between
 * countries src and dst on the vis.js topology.
 */
function _matrixCellClick(srcCountry, dstCountry) {
  if (srcCountry === dstCountry) return;
  if (typeof nodes === 'undefined' || !nodes) return;

  var adj = _buildAdjList();

  // Gather source nodes (gateways in srcCountry)
  var srcNodes = nodes.get().filter(function(n) {
    return (n.country || n.group || '').toUpperCase() === srcCountry;
  }).map(function(n) { return n.id; });

  // Gather destination nodes
  var dstNodeSet = new Set(nodes.get().filter(function(n) {
    return (n.country || n.group || '').toUpperCase() === dstCountry;
  }).map(function(n) { return n.id; }));

  // Run Dijkstra with predecessor tracking from each srcNode, pick best
  var bestDist = Infinity, bestPrev = null;
  srcNodes.forEach(function(srcId) {
    var distMap = new Map();
    var prev    = new Map();
    var heap    = new _MinHeap();
    distMap.set(srcId, 0);
    heap.push({ dist: 0, id: srcId });
    while (!heap.isEmpty()) {
      var u = heap.pop();
      if (u.dist > (distMap.get(u.id) || Infinity)) continue;
      (adj.get(u.id) || []).forEach(function(nb) {
        var nd = u.dist + nb.cost;
        if (nd < (distMap.get(nb.to) !== undefined ? distMap.get(nb.to) : Infinity)) {
          distMap.set(nb.to, nd);
          prev.set(nb.to, u.id);
          heap.push({ dist: nd, id: nb.to });
        }
      });
    }
    // Find closest dstNode
    dstNodeSet.forEach(function(dstId) {
      var d = distMap.get(dstId);
      if (d !== undefined && d < bestDist) { bestDist = d; bestPrev = { prev: prev, endId: dstId }; }
    });
  });

  if (!bestPrev) { console.log('[SP3-B] No path found ' + srcCountry + '→' + dstCountry); return; }

  // Reconstruct path
  var path = [];
  var cur  = bestPrev.endId;
  var prev2 = bestPrev.prev;
  while (prev2.has(cur)) { path.unshift(cur); cur = prev2.get(cur); }
  path.unshift(cur);

  // Find edges along path
  var pathEdgeIds = [];
  var pathSet = new Set(path);
  if (typeof edges !== 'undefined' && edges) {
    edges.get().forEach(function(e) {
      if (pathSet.has(e.from) && pathSet.has(e.to)) pathEdgeIds.push(e.id);
    });
  }

  _highlightEdges(pathEdgeIds);
  console.log('[SP3-B] Path ' + srcCountry + '→' + dstCountry + ': cost=' + bestDist + ' hops=' + (path.length-1));
}

/**
 * Export the current matrix to Excel (.xlsx) using SheetJS (xlsx.js CDN).
 * Loads CDN script on demand — no bundling required.
 */
function _exportMatrixToExcel() {
  if (!_matrixData) { alert('No matrix data. Open the Cost Matrix first.'); return; }

  function doExport() {
    var XLSX = window.XLSX;
    if (!XLSX) { alert('SheetJS failed to load. Check internet connection.'); return; }
    var countries = _matrixData.countries;
    var dist      = _matrixData.dist;

    // Build data array (header row + one row per source country)
    var data = [['From \\ To'].concat(countries)];
    countries.forEach(function(src) {
      var row = [src];
      countries.forEach(function(dst) {
        var v = dist[src][dst];
        row.push(v === null ? 'N/A' : v);
      });
      data.push(row);
    });

    var ws = XLSX.utils.aoa_to_sheet(data);

    // Style header row (sheetjs CE only supports basic styles)
    var range = XLSX.utils.decode_range(ws['!ref']);
    ws['!cols'] = [{ wch: 8 }].concat(countries.map(function() { return { wch: 8 }; }));

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'OSPF Cost Matrix');

    // Second sheet: metadata
    var meta = [
      ['OSPF Cost Matrix Export'],
      ['Generated', new Date().toISOString()],
      ['Countries', countries.length],
      ['Algorithm', 'Dijkstra APSP (country-level, gateway sources)'],
      ['Source', 'topolograph — ' + window.location.host],
    ];
    var ws2 = XLSX.utils.aoa_to_sheet(meta);
    XLSX.utils.book_append_sheet(wb, ws2, 'Metadata');

    XLSX.writeFile(wb, 'ospf-cost-matrix-' + new Date().toISOString().slice(0,10) + '.xlsx');
    console.log('[SP3-B] Excel export complete');
  }

  if (window.XLSX) {
    doExport();
  } else {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload  = doExport;
    script.onerror = function() { alert('Could not load SheetJS from CDN.'); };
    document.head.appendChild(script);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE C — OSPF What-If / Impact Analysis
//  Select any edge → propose new cost → see before/after SPF diff
//  Scalability: only re-run Dijkstra from sources reachable through the changed
//  edge (incremental SPF heuristic — same spirit as OSPF PRC/partial SPF).
// ═══════════════════════════════════════════════════════════════════════════════

function buildOspfWhatIf() {
  var old = document.getElementById('ospfWhatIfPanel');
  if (old) { old.remove(); return; }

  if (typeof edges === 'undefined' || !edges) return;

  // Build edge list for picker (sorted by cost desc)
  var edgeList = edges.get().slice().sort(function(a, b) {
    return _edgeCost(b) - _edgeCost(a);
  });

  var nodeCountry = {};
  if (typeof nodes !== 'undefined' && nodes) {
    nodes.get().forEach(function(n) {
      nodeCountry[n.id] = (n.country || n.group || 'UNK').toUpperCase();
    });
  }

  function edgeLabel(e) {
    var srcC = nodeCountry[e.from] || '?', dstC = nodeCountry[e.to] || '?';
    var srcLbl = (typeof nodes !== 'undefined' && nodes) ? (nodes.get(e.from) || {}).label || e.from : e.from;
    var dstLbl = (typeof nodes !== 'undefined' && nodes) ? (nodes.get(e.to)   || {}).label || e.to   : e.to;
    return srcC + ':' + srcLbl + ' → ' + dstC + ':' + dstLbl + '  (cost: ' + _edgeCost(e) + ')';
  }

  var optionsHtml = edgeList.map(function(e) {
    return '<option value="' + e.id + '">' + edgeLabel(e) + '</option>';
  }).join('');

  var panel = document.createElement('div');
  panel.id  = 'ospfWhatIfPanel';
  panel.style.cssText =
    'position:fixed;top:70px;left:50%;transform:translateX(20%);z-index:9997;' +
    'background:#1e2330;border:1px solid #3a4560;border-radius:12px;' +
    'box-shadow:0 8px 36px rgba(0,0,0,.7);color:#e0e6f0;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'font-size:12px;width:500px;max-height:85vh;overflow-y:auto;';

  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;' +
    'padding:10px 16px;border-bottom:1px solid #3a4560;background:#262d42;border-radius:12px 12px 0 0;' +
    'position:sticky;top:0;z-index:1;">' +
    '<span><b>🔬 What-If / Impact Analysis</b>' +
    '<span style="font-size:10px;background:#3a1a0e;border:1px solid #8b3a0e;' +
    'border-radius:4px;padding:2px 7px;margin-left:8px;color:#ff8c42;font-weight:600;">' +
    (typeof _viewMode!=='undefined'?_viewMode:'ENRICHED').toUpperCase() + '</span></span>' +
    '<button onclick="document.getElementById(\'ospfWhatIfPanel\').remove();" ' +
    'style="background:none;border:none;color:#aab;cursor:pointer;font-size:18px;">×</button></div>' +

    '<div style="padding:14px;">' +
    '<p style="color:#9ba8c0;margin:0 0 12px;font-size:11px;">' +
    'Select an OSPF link, propose a new cost, and see which country-to-country paths are affected. ' +
    'Works across all view modes (AS-IS, ENRICHED, GATEWAY, CURRENT, COLLAPSING).</p>' +

    '<label style="font-size:11px;color:#9ba8c0;">Select Edge:</label>' +
    '<select id="wiEdgePicker" style="width:100%;margin:4px 0 10px;padding:5px 8px;' +
    'background:#141824;border:1px solid #3a4560;border-radius:6px;color:#e0e6f0;font-size:11px;">' +
    optionsHtml + '</select>' +

    '<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:10px;">' +
    '<div style="flex:1;"><label style="font-size:11px;color:#9ba8c0;">Current Cost</label>' +
    '<input id="wiOldCost" type="number" readonly ' +
    'style="width:100%;padding:5px 8px;background:#141824;border:1px solid #3a4560;' +
    'border-radius:6px;color:#778;font-size:12px;"></div>' +
    '<div style="flex:1;"><label style="font-size:11px;color:#9ba8c0;">New Cost <span style="color:#445;font-weight:400;">(Enter ↵)</span></label>' +
    '<input id="wiNewCost" type="number" min="1" onkeydown="if(event.key===\'Enter\')_runWhatIfAnalysis();" ' +
    'style="width:100%;padding:5px 8px;background:#141824;border:1px solid #3a4560;' +
    'border-radius:6px;color:#e0e6f0;font-size:12px;"></div>' +
    '<button onclick="_runWhatIfAnalysis()" ' +
    'style="padding:5px 14px;background:#0d6efd;border:none;border-radius:6px;' +
    'color:#fff;cursor:pointer;font-size:12px;height:32px;">Analyse</button>' +
    '</div>' +

    '<div id="wiImpactResult" style="min-height:60px;font-size:11px;"></div>' +

    '<div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end;">' +
    '<button id="wiApplyBtn" onclick="_applyWhatIf()" disabled ' +
    'style="padding:5px 14px;background:#e74c3c;border:none;border-radius:6px;' +
    'color:#fff;cursor:pointer;font-size:12px;opacity:.4;">⚡ Apply Change</button>' +
    '<button onclick="_exportWhatIfReport()" ' +
    'style="padding:5px 14px;background:#2a3248;border:1px solid #3a4560;border-radius:6px;' +
    'color:#88aaff;cursor:pointer;font-size:12px;">⬇ Export Report</button>' +
    '</div></div>';

  document.body.appendChild(panel);

  // Wire picker → populate current cost
  var picker = document.getElementById('wiEdgePicker');
  var oldCostEl = document.getElementById('wiOldCost');
  function syncCost() {
    var eid = picker.value;
    var e   = edges.get(eid);
    if (e) {
      _whatIfEdgeId   = eid;
      _whatIfOrigCost = _edgeCost(e);
      if (oldCostEl) oldCostEl.value = _whatIfOrigCost;
    }
  }
  if (picker) { picker.addEventListener('change', syncCost); syncCost(); }
  console.log('[SP3-C] What-If panel built: ' + edgeList.length + ' edges');
}

/** Stored impact result for export */
var _whatIfLastResult = null;

/**
 * Run the what-if analysis:
 *   1. Compute current country matrix (baseline)
 *   2. Apply the proposed cost override to the adjacency list
 *   3. Re-compute country matrix with override
 *   4. Diff the two matrices → list affected country pairs + Δcost
 *   5. Show risk score (# of affected pairs)
 */
function _runWhatIfAnalysis() {
  var picker  = document.getElementById('wiEdgePicker');
  var newCostEl = document.getElementById('wiNewCost');
  var resultEl  = document.getElementById('wiImpactResult');
  var applyBtn  = document.getElementById('wiApplyBtn');
  if (!picker || !newCostEl || !resultEl) return;

  var edgeId  = picker.value;
  var newCost = parseInt(newCostEl.value, 10);
  if (!edgeId || isNaN(newCost) || newCost < 1) {
    resultEl.innerHTML = '<span style="color:#e74c3c;">Please select an edge and enter a valid cost (≥1).</span>';
    return;
  }

  resultEl.innerHTML = '<span style="color:#9ba8c0;">⏳ Running Dijkstra…</span>';

  // Run async to let browser render the "running" message
  setTimeout(function() {
    var baseline  = _computeCountryMatrix();
    var override  = {};
    override[edgeId] = newCost;
    var adjOver   = _buildAdjList(override);
    var proposed  = _computeCountryMatrix(adjOver);

    if (!baseline || !proposed) {
      resultEl.innerHTML = '<span style="color:#e74c3c;">Graph not ready.</span>';
      return;
    }

    var countries = baseline.countries;
    var affected  = [];
    var oldEdgeCost = _whatIfOrigCost || _edgeCost(edges.get(edgeId));

    countries.forEach(function(src) {
      countries.forEach(function(dst) {
        if (src === dst) return;
        var before = baseline.dist[src] && baseline.dist[src][dst];
        var after  = proposed.dist[src]  && proposed.dist[src][dst];
        if (before !== after) {
          var delta = (after !== null && before !== null) ? (after - before) : null;
          affected.push({
            src: src, dst: dst, before: before, after: after,
            delta: delta, better: (delta !== null && delta < 0)
          });
        }
      });
    });

    // Risk score (from the IBM / Juniper change-impact model):
    // score = (#affected_pairs / total_pairs) * 100
    var totalPairs = countries.length * (countries.length - 1);
    var riskPct    = totalPairs > 0 ? Math.round(100 * affected.length / totalPairs) : 0;
    var riskColor  = riskPct < 20 ? '#27ae60' : riskPct < 50 ? '#f39c12' : '#e74c3c';
    var riskLabel  = riskPct < 20 ? 'LOW' : riskPct < 50 ? 'MEDIUM' : 'HIGH';

    _whatIfLastResult = {
      edgeId: edgeId, oldCost: oldEdgeCost, newCost: newCost,
      affected: affected, riskPct: riskPct, countries: countries,
      generatedAt: new Date().toISOString()
    };
    _whatIfEdgeId   = edgeId;

    var rows = '';
    if (!affected.length) {
      rows = '<tr><td colspan="5" style="padding:8px;text-align:center;color:#27ae60;">' +
        'No country-pair paths affected by this cost change.</td></tr>';
    } else {
      rows = affected.slice(0, 30).map(function(r) {
        var dStr = r.delta !== null ? (r.delta > 0 ? '+'+r.delta : String(r.delta)) : 'N/A→finite';
        var dColor = r.better ? '#27ae60' : '#e74c3c';
        var bStr = r.before !== null ? r.before : '∞';
        var aStr = r.after  !== null ? r.after  : '∞';
        return '<tr>' +
          '<td style="padding:3px 8px;font-size:10px;font-weight:600;">' + r.src + '</td>' +
          '<td style="padding:3px 4px;font-size:10px;">→</td>' +
          '<td style="padding:3px 8px;font-size:10px;font-weight:600;">' + r.dst + '</td>' +
          '<td style="padding:3px 8px;font-size:10px;">' + bStr + ' → ' + aStr + '</td>' +
          '<td style="padding:3px 8px;font-size:10px;color:' + dColor + ';font-weight:600;">' + dStr + '</td>' +
          '</tr>';
      }).join('');
      if (affected.length > 30) {
        rows += '<tr><td colspan="5" style="padding:4px 8px;color:#556;font-size:10px;text-align:center;">' +
          '…and ' + (affected.length - 30) + ' more pairs affected</td></tr>';
      }
    }

    resultEl.innerHTML =
      '<div style="display:flex;gap:12px;margin-bottom:8px;align-items:center;">' +
      '<div style="flex:1;background:#141824;border-radius:6px;padding:6px 10px;">' +
      '<div style="font-size:10px;color:#9ba8c0;">Edge cost change</div>' +
      '<div style="font-size:13px;font-weight:700;">' + oldEdgeCost + ' → ' + newCost +
      ' <span style="font-size:10px;color:' + (newCost < oldEdgeCost ? '#27ae60' : '#e74c3c') + ';">' +
      (newCost < oldEdgeCost ? '▼' : '▲') + Math.abs(newCost-oldEdgeCost) + '</span></div></div>' +
      '<div style="flex:1;background:#141824;border-radius:6px;padding:6px 10px;">' +
      '<div style="font-size:10px;color:#9ba8c0;">Affected country pairs</div>' +
      '<div style="font-size:13px;font-weight:700;">' + affected.length + ' / ' + totalPairs + '</div></div>' +
      '<div style="flex:1;background:#141824;border-radius:6px;padding:6px 10px;">' +
      '<div style="font-size:10px;color:#9ba8c0;">Risk Score</div>' +
      '<div style="font-size:13px;font-weight:700;color:' + riskColor + ';">' + riskPct + '% ' + riskLabel + '</div></div>' +
      '</div>' +
      '<table style="border-collapse:collapse;width:100%;background:#141824;border-radius:6px;overflow:hidden;">' +
      '<thead><tr style="background:#262d42;">' +
      '<th style="padding:3px 8px;font-size:10px;color:#9ba8c0;text-align:left;">From</th>' +
      '<th></th>' +
      '<th style="padding:3px 8px;font-size:10px;color:#9ba8c0;text-align:left;">To</th>' +
      '<th style="padding:3px 8px;font-size:10px;color:#9ba8c0;">Before → After</th>' +
      '<th style="padding:3px 8px;font-size:10px;color:#9ba8c0;">Δ</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';

    // Enable Apply button
    if (applyBtn) { applyBtn.disabled = false; applyBtn.style.opacity = '1'; }
    console.log('[SP3-C] What-If: ' + affected.length + ' affected pairs, risk=' + riskPct + '%');
  }, 10);
}

/**
 * Apply the what-if cost change permanently to the vis.js edge DataSet.
 * This is REVERSIBLE by clicking What-If again and setting back the old cost.
 */
function _applyWhatIf() {
  if (!_whatIfEdgeId || !_whatIfLastResult) { alert('Run analysis first.'); return; }
  var newCost = _whatIfLastResult.newCost;
  var eId     = _whatIfEdgeId;

  if (typeof edges === 'undefined' || !edges) return;
  var e = edges.get(eId);
  if (!e) { alert('Edge not found.'); return; }

  // Apply cost — update whichever field the edge uses
  var update = { id: eId };
  if (typeof e.cost !== 'undefined')   update.cost   = newCost;
  if (typeof e.weight !== 'undefined') update.weight = newCost;
  if (typeof e.value  !== 'undefined') update.value  = newCost;
  // Update the title/label for visible display
  var newLabel = String(newCost);
  if (typeof e.label  !== 'undefined') update.label  = newLabel;
  edges.update([update]);

  // Refresh Cost Matrix if open
  if (document.getElementById('ospfCostMatrixPanel')) {
    _refreshCostMatrix();
  }

  // Re-apply cost labels if active
  var chk = document.getElementById('chkCostLabels');
  if (chk && chk.checked) _applyCostLabels(true);

  var resultEl = document.getElementById('wiImpactResult');
  if (resultEl) {
    var notice = document.createElement('div');
    notice.style.cssText = 'background:#1a3a1a;border:1px solid #27ae60;border-radius:6px;' +
      'padding:6px 10px;margin-top:8px;font-size:11px;color:#27ae60;';
    notice.textContent = '\u2705 Cost change applied to graph. Edge ' + eId +
      ' cost is now ' + newCost + '. Cost Matrix refreshed.';
    resultEl.appendChild(notice);
  }

  var applyBtn = document.getElementById('wiApplyBtn');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.style.opacity = '.4'; }
  console.log('[SP3-C] Applied: edge ' + eId + ' cost → ' + newCost);
}

/**
 * Export the what-if impact report as CSV.
 */
function _exportWhatIfReport() {
  if (!_whatIfLastResult) { alert('Run analysis first.'); return; }
  var r = _whatIfLastResult;
  var lines = [
    'OSPF What-If Impact Report',
    'Generated,' + r.generatedAt,
    'Edge ID,' + r.edgeId,
    'Old Cost,' + r.oldCost,
    'New Cost,' + r.newCost,
    'Risk %,' + r.riskPct,
    '',
    'From,To,Before,After,Delta'
  ].concat(r.affected.map(function(a) {
    return [a.src, a.dst, a.before, a.after, a.delta].join(',');
  }));
  var csv  = lines.join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'ospf-whatif-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  console.log('[SP3-C] What-If report exported');
}
