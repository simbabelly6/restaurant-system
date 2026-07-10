/* ===== CUSTOMER INTERFACE (call.html) ===== */

let cooldownTimer = null;
let cooldownSeconds = 0;

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.logo) {
      const logo = document.getElementById('callLogo');
      logo.src = data.logo;
      logo.style.display = 'block';
      document.getElementById('callLogoPlaceholder').style.display = 'none';
    }
    if (data.accent_color) {
      document.documentElement.style.setProperty('--accent', data.accent_color);
    }
    if (data.primary_color) {
      document.documentElement.style.setProperty('--primary', data.primary_color);
    }
    if (data.name && document.querySelector('.call-welcome')) {
      document.querySelector('.call-welcome').textContent = 'Welcome to ' + data.name + '!';
    }
  } catch (e) {}
}

async function sendRequest(type) {
  const table = document.getElementById('tableNumber').textContent;
  try {
    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, type })
    });
    const data = await res.json();
    if (res.ok) {
      showSuccess();
    } else if (res.status === 429) {
      const remaining = data.remaining || 30;
      showCooldown(remaining);
    } else {
      alert(data.error || 'Error sending request');
    }
  } catch (e) {
    alert('Connection error. Please try again.');
  }
}

function showSuccess() {
  document.getElementById('requestScreen').style.display = 'none';
  document.getElementById('successScreen').classList.add('active');
  startCooldown(30);
}

function startCooldown(seconds) {
  cooldownSeconds = seconds;
  document.getElementById('countdownSeconds').textContent = cooldownSeconds;
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    cooldownSeconds--;
    document.getElementById('countdownSeconds').textContent = cooldownSeconds;
    if (cooldownSeconds <= 0) {
      clearInterval(cooldownTimer);
      resetCallScreen();
    }
  }, 1000);
}

function showCooldown(seconds) {
  document.getElementById('requestScreen').style.display = 'none';
  document.getElementById('successScreen').classList.add('active');
  document.querySelector('.success-title').textContent = 'Please wait';
  document.querySelector('.success-subtitle').textContent = 'You can request again shortly.';
  startCooldown(seconds);
}

function resetCallScreen() {
  document.getElementById('requestScreen').style.display = 'block';
  document.getElementById('successScreen').classList.remove('active');
  document.querySelector('.success-title').textContent = 'Your request has been sent.';
  document.querySelector('.success-subtitle').textContent = 'A waiter will assist you shortly.';
}

/* ===== WAITER DASHBOARD (dashboard.html) ===== */

let socket = null;

function initDashboard() {
  loadRequests();
  loadStats();
  connectSocket();
  playNotificationSound();
}

function connectSocket() {
  socket = io();
  socket.on('connect', () => {});
  socket.on('new_request', (data) => {
    addRequestRow(data);
    updateStats();
    showNotification(data);
    highlightRow(data.id);
    playNotificationSound();
  });
  socket.on('update_request', (data) => {
    updateRequestRow(data);
    updateStats();
  });
  socket.on('remove_request', (data) => {
    const row = document.querySelector(`tr[data-id="${data.id}"]`);
    if (row) row.remove();
    updateStats();
    updateEmptyState();
  });
}

async function loadRequests() {
  try {
    const res = await fetch('/api/requests');
    const data = await res.json();
    const tbody = document.getElementById('requestsBody');
    tbody.innerHTML = '';
    data.forEach(r => addRequestRow(r));
    updateStats();
    updateEmptyState();
  } catch (e) {}
}

function addRequestRow(r) {
  const tbody = document.getElementById('requestsBody');
  const existing = tbody.querySelector(`tr[data-id="${r.id}"]`);
  if (existing) {
    updateRequestRow(r);
    return;
  }
  const tr = document.createElement('tr');
  tr.setAttribute('data-id', r.id);
  tr.setAttribute('data-status', r.status);
  const typeLabels = { waiter: '👨 Waiter', bill: '💳 Bill', water: '🥤 Water', cutlery: '🍴 Cutlery' };
  const statusLabels = { waiting: 'Waiting', in_progress: 'In Progress', completed: 'Completed' };
  tr.innerHTML = `
    <td><span class="table-number-badge">${r.table_number}</span></td>
    <td><span class="request-type-badge">${typeLabels[r.request_type] || r.request_type}</span></td>
    <td>${formatTime(r.created_at)}</td>
    <td class="waiting-time">${r.waiting_time || '0s'}</td>
    <td><span class="status-badge ${r.status}"><span class="status-dot ${r.status}"></span>${statusLabels[r.status] || r.status}</span></td>
    <td style="display:flex;gap:4px;">
      ${r.status === 'waiting' ? `<button class="btn btn-sm btn-primary" onclick="acceptRequest(${r.id})">Accept</button>` : ''}
      ${r.status !== 'completed' ? `<button class="btn btn-sm btn-outline" onclick="completeRequest(${r.id})">Complete</button>` : ''}
      <button class="btn btn-sm btn-danger" onclick="dismissRequest(${r.id})">Dismiss</button>
    </td>
  `;
  tbody.prepend(tr);
  updateEmptyState();
}

function updateRequestRow(r) {
  const tr = document.querySelector(`tr[data-id="${r.id}"]`);
  if (!tr) return;
  tr.setAttribute('data-status', r.status);
  const statusLabels = { waiting: 'Waiting', in_progress: 'In Progress', completed: 'Completed' };
  const badge = tr.querySelector('.status-badge');
  if (badge) {
    badge.className = `status-badge ${r.status}`;
    badge.innerHTML = `<span class="status-dot ${r.status}"></span>${statusLabels[r.status] || r.status}`;
  }
  if (r.waiting_time) {
    const wt = tr.querySelector('.waiting-time');
    if (wt) wt.textContent = r.waiting_time;
  }
  const actionsTd = tr.querySelector('td:last-child');
  if (actionsTd) {
    if (r.status === 'waiting') {
      actionsTd.innerHTML = `<button class="btn btn-sm btn-primary" onclick="acceptRequest(${r.id})">Accept</button> <button class="btn btn-sm btn-outline" onclick="completeRequest(${r.id})">Complete</button> <button class="btn btn-sm btn-danger" onclick="dismissRequest(${r.id})">Dismiss</button>`;
    } else if (r.status === 'in_progress') {
      actionsTd.innerHTML = `<button class="btn btn-sm btn-outline" onclick="completeRequest(${r.id})">Complete</button> <button class="btn btn-sm btn-danger" onclick="dismissRequest(${r.id})">Dismiss</button>`;
    } else {
      actionsTd.innerHTML = `<button class="btn btn-sm btn-danger" onclick="dismissRequest(${r.id})">Dismiss</button>`;
    }
  }
  updateEmptyState();
}

function highlightRow(id) {
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (tr) {
    tr.classList.add('highlight');
    setTimeout(() => tr.classList.remove('highlight'), 2000);
  }
}

async function acceptRequest(id) {
  try {
    await fetch('/api/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
  } catch (e) {}
}

async function completeRequest(id) {
  try {
    await fetch('/api/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
  } catch (e) {}
}

async function dismissRequest(id) {
  try {
    await fetch('/api/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
  } catch (e) {}
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function updateEmptyState() {
  const tbody = document.getElementById('requestsBody');
  const empty = document.getElementById('emptyState');
  if (empty) {
    empty.style.display = tbody.children.length === 0 ? 'flex' : 'none';
  }
  const count = document.getElementById('requestCount');
  if (count) {
    count.textContent = tbody.children.length + ' active';
  }
}

async function updateStats() {
  try {
    const res = await fetch('/api/statistics');
    const data = await res.json();
    document.getElementById('statActive').textContent = data.active_requests;
    document.getElementById('statProgress').textContent = data.active_requests;
    document.getElementById('statCompleted').textContent = data.completed_today;
    document.getElementById('statToday').textContent = data.requests_today;
  } catch (e) {}
}

function showNotification(data) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const typeLabels = { waiter: '👨 Waiter', bill: '💳 Bill', water: '🥤 Water', cutlery: '🍴 Cutlery' };
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-title">🔔 New Request - Table ${data.table_number}</div>
    <div class="toast-body">${typeLabels[data.request_type] || data.request_type} • ${data.waiting_time || 'just now'}</div>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(`Table ${data.table_number}`, {
      body: `${typeLabels[data.request_type] || data.request_type} needs assistance`,
      icon: '/favicon.ico'
    });
  }
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = 'sine';
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);

    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1200;
      osc2.type = 'sine';
      gain2.gain.value = 0.3;
      osc2.start();
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc2.stop(ctx.currentTime + 0.3);
    }, 150);
  } catch (e) {}
}

if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

/* ===== ADMIN PANEL (admin.html) ===== */

let currentPage = 1;

function initAdmin() {
  loadTables();
  loadSettingsAdmin();
  loadHistory();
  loadStatsCharts();
}

function showTab(name) {
  document.querySelectorAll('.admin-tab').forEach(t => t.style.display = 'none');
  document.getElementById('tab' + name.charAt(0).toUpperCase() + name.slice(1)).style.display = 'block';
  document.querySelectorAll('.admin-tabs button').forEach(b => b.className = 'btn btn-sm btn-outline');
  const tabs = { tables: 0, settings: 1, history: 2, stats: 3 };
  document.querySelectorAll('.admin-tabs button')[tabs[name]].className = 'btn btn-sm btn-primary';
}

async function loadTables() {
  try {
    const res = await fetch('/api/tables');
    const data = await res.json();
    const list = document.getElementById('tableList');
    const count = document.getElementById('tableCount');
    list.innerHTML = '';
    count.textContent = data.length + ' tables';
    data.forEach(t => {
      const div = document.createElement('div');
      div.className = 'table-item';
      div.innerHTML = `
        <span class="table-num">${t.table_number}</span>
        <div class="table-actions">
          <button onclick="previewQR(${t.table_number})" title="Preview QR">📱</button>
          <button onclick="downloadQR(${t.table_number})" title="Download QR">⬇️</button>
          <button onclick="deleteTable(${t.id})" title="Delete" style="color:var(--danger);">✕</button>
        </div>
      `;
      list.appendChild(div);
    });
  } catch (e) {}
}

async function addSingleTable() {
  const input = document.getElementById('singleTableNum');
  const num = parseInt(input.value, 10);
  if (!num || num < 1) return alert('Enter a valid table number');
  try {
    const res = await fetch('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_number: num })
    });
    if (res.ok) {
      input.value = '';
      loadTables();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to add table');
    }
  } catch (e) { alert('Connection error'); }
}

async function addBatchTables() {
  const start = parseInt(document.getElementById('batchStart').value, 10);
  const end = parseInt(document.getElementById('batchEnd').value, 10);
  if (!start || !end || start > end) return alert('Enter valid range');
  try {
    const res = await fetch('/api/tables/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end })
    });
    if (res.ok) {
      document.getElementById('batchStart').value = '';
      document.getElementById('batchEnd').value = '';
      loadTables();
    }
  } catch (e) {}
}

async function deleteTable(id) {
  if (!confirm('Delete this table?')) return;
  try {
    await fetch('/api/tables/' + id, { method: 'DELETE' });
    loadTables();
  } catch (e) {}
}

async function previewQR(table) {
  const div = document.getElementById('qrPreview');
  div.style.display = 'block';
  document.getElementById('qrPreviewImg').src = '/api/qrcode/' + table + '?t=' + Date.now();
  document.getElementById('qrPreviewLabel').textContent = 'Table ' + table;
  document.getElementById('qrDownloadLink').href = '/api/qrcode/' + table + '/download';
  document.getElementById('qrDownloadLink').setAttribute('download', 'table-' + table + '.png');
}

async function downloadQR(table) {
  window.open('/api/qrcode/' + table + '/download', '_blank');
}

async function downloadAllQR() {
  window.open('/api/qrcodes/zip', '_blank');
}

async function printAllQR() {
  window.open('/api/qrcodes/print', '_blank');
}

async function loadSettingsAdmin() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    document.getElementById('restName').value = data.name || '';
    document.getElementById('restAddress').value = data.address || '';
    document.getElementById('primaryColor').value = data.primary_color || '#2d3436';
    document.getElementById('accentColor').value = data.accent_color || '#00b894';
    if (data.logo) {
      document.getElementById('logoPreview').innerHTML = `<img src="${data.logo}" style="max-height:80px;border-radius:8px;">`;
    }
  } catch (e) {}
}

async function saveSettings() {
  const name = document.getElementById('restName').value;
  const address = document.getElementById('restAddress').value;
  const primary_color = document.getElementById('primaryColor').value;
  const accent_color = document.getElementById('accentColor').value;

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, address, primary_color, accent_color })
    });
    alert('Settings saved!');
  } catch (e) {}

  const fileInput = document.getElementById('logoUpload');
  if (fileInput.files.length > 0) {
    const formData = new FormData();
    formData.append('logo', fileInput.files[0]);
    try {
      const res = await fetch('/api/upload/logo', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.logo) {
        document.getElementById('logoPreview').innerHTML = `<img src="${data.logo}?t=${Date.now()}" style="max-height:80px;border-radius:8px;">`;
      }
    } catch (e) {}
  }
}

async function loadHistory(page) {
  if (page) currentPage = page;
  const search = document.getElementById('histSearch').value;
  const type = document.getElementById('histType').value;
  const dateFrom = document.getElementById('histDateFrom').value;
  const dateTo = document.getElementById('histDateTo').value;

  try {
    const params = new URLSearchParams({ page: currentPage, limit: 50 });
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    const res = await fetch('/api/history?' + params.toString());
    const data = await res.json();
    const tbody = document.getElementById('historyBody');
    tbody.innerHTML = '';

    data.requests.forEach(r => {
      const tr = document.createElement('tr');
      const typeLabels = { waiter: '👨 Waiter', bill: '💳 Bill', water: '🥤 Water', cutlery: '🍴 Cutlery' };
      tr.innerHTML = `
        <td>#${r.id}</td>
        <td><strong>${r.table_number}</strong></td>
        <td>${typeLabels[r.request_type] || r.request_type}</td>
        <td><span class="status-badge ${r.status}"><span class="status-dot ${r.status}"></span>${r.status}</span></td>
        <td>${formatTime(r.created_at)}</td>
        <td>${r.accepted_at ? formatTime(r.accepted_at) : '-'}</td>
        <td>${r.completed_at ? formatTime(r.completed_at) : '-'}</td>
      `;
      tbody.appendChild(tr);
    });

    const totalPages = Math.ceil(data.total / data.limit);
    const pagination = document.getElementById('historyPagination');
    pagination.innerHTML = '';
    for (let i = 1; i <= totalPages && i <= 10; i++) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm ' + (i === currentPage ? 'btn-primary' : 'btn-outline');
      btn.textContent = i;
      btn.onclick = () => loadHistory(i);
      pagination.appendChild(btn);
    }
  } catch (e) {}
}

async function exportCSV() {
  const dateFrom = document.getElementById('histDateFrom').value;
  const dateTo = document.getElementById('histDateTo').value;
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  window.open('/api/export/csv?' + params.toString(), '_blank');
}

async function exportPDF() {
  const dateFrom = document.getElementById('histDateFrom').value;
  const dateTo = document.getElementById('histDateTo').value;
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  window.open('/api/export/pdf?' + params.toString(), '_blank');
}

/* ===== STATISTICS CHARTS ===== */

async function loadStatsCharts() {
  try {
    const res = await fetch('/api/statistics');
    const data = await res.json();

    document.getElementById('statRequestsToday').textContent = data.requests_today;
    document.getElementById('statAvgResponse').textContent = formatDuration(data.average_response_time);
    document.getElementById('statActiveReqs').textContent = data.active_requests;
    document.getElementById('statCompletedReqs').textContent = data.completed_today;

    renderBarChart('chartHourly', data.requests_per_hour, 'hour', 'count', 'Requests');
    renderBarChart('chartWaitTime', data.wait_time_by_hour, 'hour', 'avg_wait', 'Avg Wait (s)');
    renderBarChart('chartDaily', data.daily_activity, 'day', 'count', 'Requests');
    renderServiceChart('chartServices', data.most_requested);
  } catch (e) {}
}

function renderBarChart(containerId, data, labelKey, valueKey, label) {
  const container = document.getElementById(containerId);
  if (!container || !data || data.length === 0) {
    if (container) container.innerHTML = '<p style="color:var(--gray);font-size:13px;">No data available</p>';
    return;
  }
  container.innerHTML = '';
  const maxVal = Math.max(...data.map(d => d[valueKey]), 1);

  data.forEach(d => {
    const pct = (d[valueKey] / maxVal) * 100;
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.innerHTML = `
      <span class="label">${d[labelKey]}</span>
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="bar-value">${d[valueKey]}</span>
    `;
    container.appendChild(bar);
  });
}

function renderServiceChart(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container || !data || data.length === 0) {
    if (container) container.innerHTML = '<p style="color:var(--gray);font-size:13px;">No data available</p>';
    return;
  }
  container.innerHTML = '';
  const typeLabels = { waiter: '👨 Waiter', bill: '💳 Bill', water: '🥤 Water', cutlery: '🍴 Cutlery' };
  const maxVal = Math.max(...data.map(d => d.count), 1);

  data.forEach(d => {
    const pct = (d.count / maxVal) * 100;
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.innerHTML = `
      <span class="label">${typeLabels[d.request_type] || d.request_type}</span>
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="bar-value">${d.count}</span>
    `;
    container.appendChild(bar);
  });
}

function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '0s';
  if (seconds < 60) return seconds + 's';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins + 'm ' + secs + 's';
}

/* Update waiting times every 10 seconds */
setInterval(() => {
  document.querySelectorAll('tr[data-id]').forEach(tr => {
    const status = tr.getAttribute('data-status');
    if (status === 'completed' || status === 'dismissed') return;
    const timeCell = tr.querySelector('.waiting-time');
    if (!timeCell) return;
    const createdTd = tr.querySelector('td:nth-child(3)');
    if (!createdTd) return;

    const timeStr = createdTd.textContent.trim();
    const now = new Date();
    const created = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    created.setHours(hours, minutes, 0, 0);

    if (created > now) created.setDate(created.getDate() - 1);

    const diff = Math.floor((now - created) / 1000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    timeCell.textContent = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  });
}, 10000);
