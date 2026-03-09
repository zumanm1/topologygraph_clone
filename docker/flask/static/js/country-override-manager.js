(function() {
  'use strict';

  const API_BASE = '/layout-api/country-overrides';
  let currentEditPrefix = null;

  function showStatus(message, isError) {
    const statusDiv = document.getElementById('countryOverrideStatus');
    if (!statusDiv) return;
    
    statusDiv.innerHTML = '<div class="alert alert-' + (isError ? 'danger' : 'success') + ' alert-dismissible fade show" role="alert">' +
      message +
      '<button type="button" class="close" data-dismiss="alert"><span>&times;</span></button>' +
      '</div>';
    
    if (!isError) {
      setTimeout(function() {
        const alert = statusDiv.querySelector('.alert');
        if (alert) alert.remove();
      }, 5000);
    }
  }

  function formatDate(isoString) {
    if (!isoString) return 'N/A';
    try {
      const date = new Date(isoString);
      return date.toLocaleString();
    } catch (e) {
      return isoString;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function loadCountryOverrides() {
    const tbody = document.getElementById('countryOverrideTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Loading...</td></tr>';

    fetch(API_BASE, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    })
    .then(function(response) {
      if (!response.ok) throw new Error('Failed to load overrides');
      return response.json();
    })
    .then(function(data) {
      const overrides = data.overrides || [];
      
      if (overrides.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No country overrides defined. Click "Add Override" to create one.</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      overrides.forEach(function(override) {
        const row = document.createElement('tr');
        row.innerHTML = 
          '<td><code>' + escapeHtml(override.prefix) + '</code></td>' +
          '<td><strong>' + escapeHtml(override.country_code) + '</strong></td>' +
          '<td>' + escapeHtml(override.notes || '') + '</td>' +
          '<td><small>' + formatDate(override.updated_at) + '</small></td>' +
          '<td>' +
            '<button class="btn btn-sm btn-outline-primary mr-1" onclick="editCountryOverride(\'' + escapeHtml(override.prefix) + '\')">Edit</button>' +
            '<button class="btn btn-sm btn-outline-danger" onclick="deleteCountryOverride(\'' + escapeHtml(override.prefix) + '\')">Delete</button>' +
          '</td>';
        tbody.appendChild(row);
      });
    })
    .catch(function(error) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error loading overrides: ' + escapeHtml(error.message) + '</td></tr>';
    });
  }

  window.showCountryOverrideModal = function(prefix, countryCode, notes) {
    currentEditPrefix = prefix || null;
    
    const modal = document.getElementById('countryOverrideModal');
    const title = document.getElementById('countryOverrideModalTitle');
    const prefixInput = document.getElementById('overridePrefix');
    const codeInput = document.getElementById('overrideCountryCode');
    const notesInput = document.getElementById('overrideNotes');
    const errorDiv = document.getElementById('countryOverrideFormError');

    if (currentEditPrefix) {
      title.textContent = 'Edit Country Override';
      prefixInput.value = prefix || '';
      prefixInput.disabled = true;
      codeInput.value = countryCode || '';
      notesInput.value = notes || '';
    } else {
      title.textContent = 'Add Country Override';
      prefixInput.value = '';
      prefixInput.disabled = false;
      codeInput.value = '';
      notesInput.value = '';
    }

    errorDiv.style.display = 'none';
    errorDiv.textContent = '';

    if (typeof $ !== 'undefined' && $.fn.modal) {
      $(modal).modal('show');
    }
  };

  window.editCountryOverride = function(prefix) {
    fetch(API_BASE + '/' + encodeURIComponent(prefix), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    })
    .then(function(response) {
      if (!response.ok) throw new Error('Failed to load override');
      return response.json();
    })
    .then(function(override) {
      showCountryOverrideModal(override.prefix, override.country_code, override.notes);
    })
    .catch(function(error) {
      showStatus('Error loading override: ' + error.message, true);
    });
  };

  window.saveCountryOverride = function() {
    const prefixInput = document.getElementById('overridePrefix');
    const codeInput = document.getElementById('overrideCountryCode');
    const notesInput = document.getElementById('overrideNotes');
    const errorDiv = document.getElementById('countryOverrideFormError');

    const prefix = (prefixInput.value || '').trim().toLowerCase();
    const countryCode = (codeInput.value || '').trim().toUpperCase();
    const notes = (notesInput.value || '').trim();

    errorDiv.style.display = 'none';

    if (!prefix || !/^[a-z0-9][a-z0-9-]*$/.test(prefix)) {
      errorDiv.textContent = 'Invalid prefix. Use lowercase letters, numbers, and hyphens only.';
      errorDiv.style.display = 'block';
      return;
    }

    if (!countryCode || !/^[A-Z]{3}$/.test(countryCode)) {
      errorDiv.textContent = 'Invalid country code. Must be exactly 3 uppercase letters.';
      errorDiv.style.display = 'block';
      return;
    }

    const payload = {
      prefix: prefix,
      country_code: countryCode,
      notes: notes || null
    };

    const isEdit = !!currentEditPrefix;
    const url = isEdit ? API_BASE + '/' + encodeURIComponent(currentEditPrefix) : API_BASE;
    const method = isEdit ? 'PUT' : 'POST';

    fetch(url, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    })
    .then(function(response) {
      if (!response.ok) {
        return response.json().then(function(data) {
          throw new Error(data.detail || 'Failed to save override');
        });
      }
      return response.json();
    })
    .then(function() {
      const modal = document.getElementById('countryOverrideModal');
      if (typeof $ !== 'undefined' && $.fn.modal) {
        $(modal).modal('hide');
      }
      showStatus(isEdit ? 'Override updated successfully' : 'Override created successfully', false);
      loadCountryOverrides();
    })
    .catch(function(error) {
      errorDiv.textContent = error.message;
      errorDiv.style.display = 'block';
    });
  };

  window.deleteCountryOverride = function(prefix) {
    currentEditPrefix = prefix;
    const deleteModal = document.getElementById('deleteCountryOverrideModal');
    const deletePrefixSpan = document.getElementById('deleteOverridePrefix');
    
    if (deletePrefixSpan) {
      deletePrefixSpan.textContent = prefix;
    }

    if (typeof $ !== 'undefined' && $.fn.modal) {
      $(deleteModal).modal('show');
    }
  };

  window.confirmDeleteCountryOverride = function() {
    if (!currentEditPrefix) return;

    fetch(API_BASE + '/' + encodeURIComponent(currentEditPrefix), {
      method: 'DELETE',
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    })
    .then(function(response) {
      if (!response.ok) throw new Error('Failed to delete override');
      return response.json();
    })
    .then(function() {
      const modal = document.getElementById('deleteCountryOverrideModal');
      if (typeof $ !== 'undefined' && $.fn.modal) {
        $(modal).modal('hide');
      }
      showStatus('Override deleted successfully', false);
      loadCountryOverrides();
      currentEditPrefix = null;
    })
    .catch(function(error) {
      showStatus('Error deleting override: ' + error.message, true);
    });
  };

  window.exportCountryOverrides = function() {
    window.location.href = API_BASE + '/export/csv';
  };

  window.importCountryOverridesCsv = function(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      const csvText = e.target.result;
      parseCsvAndImport(csvText);
    };
    reader.onerror = function() {
      showStatus('Error reading CSV file', true);
    };
    reader.readAsText(file);

    input.value = '';
  };

  function parseCsvAndImport(csvText) {
    const lines = csvText.split('\n');
    const overrides = [];
    let hasHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',').map(function(p) { return p.trim().replace(/^"|"$/g, ''); });

      if (i === 0 && (parts[0].toLowerCase() === 'prefix' || parts[0].toLowerCase() === 'hostname_prefix')) {
        hasHeader = true;
        continue;
      }

      if (parts.length < 2) continue;

      const prefix = parts[0].toLowerCase();
      const countryCode = parts[1].toUpperCase();
      const notes = parts[2] || null;

      if (!/^[a-z0-9][a-z0-9-]*$/.test(prefix)) {
        showStatus('Invalid prefix in CSV: ' + prefix, true);
        return;
      }

      if (!/^[A-Z]{3}$/.test(countryCode)) {
        showStatus('Invalid country code in CSV: ' + countryCode, true);
        return;
      }

      overrides.push({ prefix: prefix, country_code: countryCode, notes: notes });
    }

    if (overrides.length === 0) {
      showStatus('No valid overrides found in CSV', true);
      return;
    }

    fetch(API_BASE + '/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ overrides: overrides })
    })
    .then(function(response) {
      if (!response.ok) throw new Error('Failed to import overrides');
      return response.json();
    })
    .then(function(result) {
      const msg = 'Import completed: ' + result.created + ' created, ' + result.updated + ' updated';
      showStatus(msg + (result.errors && result.errors.length ? ' (with ' + result.errors.length + ' errors)' : ''), result.errors && result.errors.length > 0);
      loadCountryOverrides();
    })
    .catch(function(error) {
      showStatus('Error importing CSV: ' + error.message, true);
    });
  }

  window.loadCountryOverrides = loadCountryOverrides;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadCountryOverrides);
  } else {
    loadCountryOverrides();
  }

})();
