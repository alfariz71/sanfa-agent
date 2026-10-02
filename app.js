/* =====================================================
   Sanfa Agent — app.js (Full Stack)
   Connects to backend server at http://localhost:3388
   ===================================================== */

// ── Config & Storage Keys ─────────────────────────────
const API_BASE = window.location.origin;
const SESSION_KEY = 'sanfa_session_id';
const AUTH_TOKEN_KEY = 'sanfa_token';
const DEVICE_ID_KEY = 'sanfa_device_id';

// ── State ─────────────────────────────────────────────
const state = {
  model: 'lues-combos',
  sessionId: getSessionId(),
  streaming: false,
  sessions: [],
  historyFilter: 'all',
  currentUser: null,
  pendingImage: null,
  pendingAttachment: null,
  activeProjectId: null,
  sidebarTab: 'chats',
  roleplayActive: false,
  activePersonaId: null,
  personas: [],
  bridgeConnected: false,
  bridgeInfo: null
};

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

function setAuthToken(token) {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

try {
  const _urlParams = new URLSearchParams(window.location.search);
  const _qToken = _urlParams.get('token');
  if (_qToken) {
    const _parts = _qToken.split(',');
    setAuthToken(_parts[0]);
    if (_parts[1]) {
      state.autoSession = _parts[1];
    }
  }
} catch (_) {}

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(SESSION_KEY, id); }
  return id;
}

// ── Authenticated API Fetch Helper ────────────────────
async function apiFetch(url, options = {}) {
  const opts = { ...options };
  opts.headers = {
    ...(opts.headers || {}),
    'x-device-id': getDeviceId(),
  };
  const token = getAuthToken();
  if (token) {
    opts.headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, opts);

  if (res.status === 403) {
    let data;
    try { data = await res.clone().json(); } catch {}
    if (data && data.blocked) {
      showBlockedScreen(data.reason || data.error);
    }
  } else if (res.status === 401) {
    showLoginModal();
  }

  return res;
}

// ── Auth & UI Overlays ────────────────────────────────
function showLoginModal() {
  const overlay = $('login-modal-overlay');
  if (overlay) overlay.style.display = 'flex';
  const errEl = $('login-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  $('login-username')?.focus();
}

function hideLoginModal() {
  const overlay = $('login-modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

function showBlockedScreen(reason) {
  const overlay = $('blocked-screen-overlay');
  if (overlay) overlay.style.display = 'flex';
  const rEl = $('blocked-reason-text');
  if (rEl) rEl.textContent = reason || 'Perangkat Anda telah diblokir secara permanen oleh Administrator Sistem.';
  const mEl = $('blocked-device-meta');
  if (mEl) {
    mEl.innerHTML = `Device ID: ${escHtml(getDeviceId())}<br>Status: 403 Forbidden (Blacklisted)<br>Waktu: ${new Date().toLocaleString('id-ID')}`;
  }
}

function setCurrentUser(user) {
  state.currentUser = user;
  const sbName = $('sidebar-user-name');
  if (sbName) sbName.textContent = user.name || user.username;

  const initials = (user.name || user.username || 'U').slice(0, 2).toUpperCase();
  const roleText = user.role === 'owner'
    ? 'Pemilik Sistem & Administrator Laptop'
    : 'Tamu Terverifikasi (AI Chat & Coding)';

  // Settings modal user elements (if any)
  const setAvatar = $('settings-user-avatar');
  const setName = $('settings-user-name');
  const setRole = $('settings-user-role');
  if (setAvatar) setAvatar.textContent = initials;
  if (setName) setName.textContent = user.name || user.username;
  if (setRole) setRole.textContent = roleText;

  // Profile modal user elements
  const profAvatar = $('profile-user-avatar');
  const profName = $('profile-user-name');
  const profRole = $('profile-user-role');
  const profToken = $('profile-bridge-token');
  if (profAvatar) profAvatar.textContent = initials;
  if (profName) profName.textContent = user.name || user.username;
  if (profRole) profRole.textContent = roleText;
  const token = getAuthToken() || (user && user.token) || '';
  if (profToken) profToken.textContent = token || '-';

  const ownerTabs = document.querySelectorAll('.settings-tab-btn.owner-only');
  ownerTabs.forEach(el => {
    el.style.display = user.role === 'owner' ? 'flex' : 'none';
  });

  const nickInput = $('input-user-nickname');
  if (nickInput) nickInput.value = user.nickname || '';
}

async function checkAuth() {
  try {
    const r = await apiFetch(`${API_BASE}/api/auth/me`);
    if (r.status === 403) {
      const d = await r.json();
      showBlockedScreen(d.reason || d.error);
      return false;
    }
    if (r.status === 401 || !r.ok) {
      showLoginModal();
      return false;
    }
    const data = await r.json();
    if (data.ok && data.user) {
      setCurrentUser(data.user);
      hideLoginModal();
      return true;
    } else {
      showLoginModal();
      return false;
    }
  } catch (e) {
    console.error('Auth check error:', e);
    showLoginModal();
    return false;
  }
}

async function logout() {
  if (!confirm('Apakah Anda yakin ingin keluar dari akun ini?')) return;
  try {
    await apiFetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
  } catch {}
  setAuthToken('');
  state.currentUser = null;
  $('settings-modal-overlay')?.classList.remove('active');
  showLoginModal();
}

// ── DOM helpers ───────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

let slashFocusIndex = -1;
let slashFiltered = [];

// ── Slash commands (local) ─────────────────────────────
const SLASH_COMMANDS = [
  { cmd: '/panggilan [nama]',      desc: 'Ganti nama panggilan akrab kamu' },
  { cmd: '/imagine [deskripsi]',   desc: 'Generate gambar Google Imagen 3' },
  { cmd: '/model lues-combos',     desc: 'Super luwes, bahasa daerah & hemat' },
  { cmd: '/model santai-combo',    desc: 'Santai, curhat & teks panjang' },
  { cmd: '/model coding-combo',    desc: 'Koding Claude Sonnet & Qwen' },
  { cmd: '/model reasoning-combo', desc: 'Penalaran DeepSeek-R1 & Opus' },
  { cmd: '/model content-combo',   desc: 'Artikel, copy & ide konten' },
  { cmd: '/model sanfa-combo',     desc: 'Master harian serbaguna' },
  { cmd: '/clear',                 desc: 'Mulai obrolan baru' },
];

// ── Hermes Kaomoji & Thinking Verbs (Official Catalog) ────────
const HERMES_FACES = [
  "(⌐■_■)",
  "( •_•)>⌐■-■",
  "(¬_¬)",
  "(◔_◔)",
  "(⊙_⊙)",
  "( ͡° ͜ʖ ͡°)",
  "٩(๑❛ᴗ❛๑)۶",
  "( ˘⌣˘)♡",
  "(´･_･`)",
  "ಠ_ಠ"
];

const HERMES_VERBS = [
  "musing",
  "pondering",
  "contemplating",
  "cogitating",
  "ruminating",
  "deliberating",
  "mulling",
  "reflecting",
  "reasoning",
  "analyzing",
  "synthesizing",
  "formulating",
  "brainstorming",
  "processing",
  "computing"
];

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escAttr(str) {
  return escHtml(str);
}

function getToolVerb(name) {
  switch (name) {
    case 'set_nickname': return 'updating name';
    case 'search_web': return 'searching web';
    case 'run_command': return 'running terminal';
    case 'replace_file_content': return 'patching code';
    case 'search_code': return 'searching codebase';
    case 'write_file': return 'writing file';
    case 'read_file': return 'reading file';
    case 'get_battery_health': return 'reading battery';
    case 'get_system_status': return 'diagnosing system';
    case 'get_top_processes': return 'inspecting processes';
    case 'take_screenshot': return 'capturing screen';
    case 'lock_screen': return 'locking screen';
    case 'generate_image': return 'generating image';
    default: return `executing ${name}`;
  }
}

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  renderModelBadge();
  setupInput();
  setupSidebar();
  setupSlashMenu();
  setupModalPicker();
  setupSettingsModal();
  setupProfileModal();
  setupSettingsTabs();
  setupManualBookModal();
  setupLoginForm();
  setupCreateUserForm();
  setupNicknameForm();
  setupActionCards();
  setupArtifactModal();
  setupArtifactSidebar();
  setupImageLightbox();
  initMermaidConfig();
  setupPersonaModal();
  setupBridgeModal();
  setupRemoteServerWindow();
  setupMobileViewport();

  const isAuthed = await checkAuth();
  if (isAuthed) {
    startStatusPolling();
    loadProjects();
    loadPersonas();
    checkBridgeStatus();
    loadSessions();
    loadChatHistory();
  }
});

async function loadChatHistory() {
  try {
    const r = await apiFetch(`${API_BASE}/api/history?sessionId=${state.sessionId}`);
    const d = await r.json();
    if (d.projectId !== undefined) {
      state.activeProjectId = d.projectId || null;
      updateProjectTopBar();
    }
    if (d.roleplayActive !== undefined) {
      state.roleplayActive = !!d.roleplayActive;
    }
    if (d.personaId !== undefined) {
      state.activePersonaId = d.personaId || null;
    }
    updatePersonaTopBar();
    if (d.model) {
      state.model = d.model;
      renderModelBadge();
    }
    const msgs = $$('.chat-messages');
    if (d.messages && d.messages.length > 0) {
      removeEmptyState();
      msgs.innerHTML = '';
      thinkingPanelRow = null;
      d.messages.forEach((m, idx) => {
        if (m.role === 'user') {
          const row = document.createElement('div');
          row.className = 'message-row user';
          row.setAttribute('data-msg-index', idx);
          const wrap = document.createElement('div');
          wrap.className = 'message-bubble-wrap';
          const bub = document.createElement('div');
          bub.className = 'message-bubble';

          if (m.attachment) {
            if (m.attachment.type === 'image' && m.attachment.dataUrl) {
              const imgEl = document.createElement('img');
              imgEl.src = m.attachment.dataUrl;
              imgEl.className = 'chat-image';
              bub.appendChild(imgEl);
            } else if (m.attachment.type === 'pdf') {
              const card = document.createElement('div');
              card.className = 'chat-file-card';
              card.innerHTML = `
                <div class="chat-file-card-icon pdf">📄</div>
                <div class="chat-file-card-meta">
                  <div class="chat-file-card-name">${escHtml(m.attachment.name || 'Dokumen.pdf')}</div>
                  <div class="chat-file-card-sub">${escHtml(formatFileSize(m.attachment.size || 0))} · Dokumen PDF</div>
                </div>
              `;
              bub.appendChild(card);
            } else if (m.attachment.type === 'file') {
              const icon = m.attachment.category === 'code' ? '💻' : (m.attachment.category === 'data' ? '📊' : '📝');
              const card = document.createElement('div');
              card.className = 'chat-file-card';
              card.innerHTML = `
                <div class="chat-file-card-icon ${escHtml(m.attachment.category || 'text')}">${icon}</div>
                <div class="chat-file-card-meta">
                  <div class="chat-file-card-name">${escHtml(m.attachment.name || 'Berkas')}</div>
                  <div class="chat-file-card-sub">${escHtml(formatFileSize(m.attachment.size || 0))} · Berkas ${(m.attachment.ext || 'TEXT').toUpperCase()}</div>
                </div>
              `;
              bub.appendChild(card);
            }
          }

          let rawUserText = '';
          if (typeof m.content === 'string') {
            rawUserText = m.content;
            const textNode = document.createElement('div');
            textNode.textContent = m.content;
            bub.appendChild(textNode);
          } else if (Array.isArray(m.content)) {
            m.content.forEach(part => {
              if (part.type === 'image_url' && part.image_url?.url) {
                const url = part.image_url.url;
                if (url.startsWith('data:application/pdf')) {
                  if (!m.attachment) {
                    const card = document.createElement('div');
                    card.className = 'chat-file-card';
                    card.innerHTML = `
                      <div class="chat-file-card-icon pdf">📄</div>
                      <div class="chat-file-card-meta">
                        <div class="chat-file-card-name">Dokumen.pdf</div>
                        <div class="chat-file-card-sub">Dokumen PDF</div>
                      </div>
                    `;
                    bub.appendChild(card);
                  }
                } else {
                  const imgEl = document.createElement('img');
                  imgEl.src = url;
                  imgEl.className = 'chat-image';
                  imgEl.alt = 'Uploaded image';
                  bub.appendChild(imgEl);
                }
              } else if (part.type === 'text' && part.text) {
                if (rawUserText) rawUserText += '\n';
                rawUserText += part.text;
                const textNode = document.createElement('div');
                textNode.textContent = part.text;
                bub.appendChild(textNode);
              }
            });
          }
          wrap.appendChild(bub);
          if (rawUserText) {
            wrap.appendChild(createMessageActions('user', rawUserText, row));
          }
          row.appendChild(wrap);
          msgs.appendChild(row);
        } else if (m.role === 'assistant') {
          if (!m.content || m.content.trim() === '[tool dipanggil]') return;
          const row = document.createElement('div');
          row.className = 'message-row agent';
          row.setAttribute('data-msg-index', idx);
          const wrap = document.createElement('div');
          wrap.className = 'message-bubble-wrap';
          if (m.reasoningMeta) {
            const metaEl = document.createElement('div');
            metaEl.className = 'agent-reasoning-meta';
            metaEl.innerHTML = `<span class="reasoning-meta-text">${escHtml(m.reasoningMeta)}</span>`;
            wrap.appendChild(metaEl);
          }
          const bub = document.createElement('div');
          bub.className = 'message-bubble';
          bub.innerHTML = renderMarkdown(m.content);
          bub.querySelectorAll('.btn-copy').forEach(setupCopyBtn);
          wrap.appendChild(bub);
          wrap.appendChild(createMessageActions('agent', m.content, row));
          row.appendChild(wrap);
          msgs.appendChild(row);
        }
      });
      initArtifactsAndDiagrams(msgs);
      msgs.scrollTop = msgs.scrollHeight;
    } else {
      msgs.innerHTML = getWelcomeStateHTML();
    }
  } catch {}
}

function updateInputReadOnlyState() {
  const inputArea = $$('.input-area');
  const existingNotice = $('readonly-notice-bar');
  if (existingNotice) existingNotice.remove();
  if (inputArea) inputArea.style.display = '';

  const chatInput = $('chat-input');
  if (chatInput) {
    chatInput.disabled = false;
    chatInput.placeholder = window.innerWidth <= 768 ? 'Tanya sesuatu...' : 'Tanya sesuatu, atau ketik / untuk perintah...';
  }
}

// ── Sessions & History ────────────────────────────────
async function loadSessions() {
  try {
    const r = await apiFetch(`${API_BASE}/api/sessions`);
    if (!r.ok) return;
    const data = await r.json();
    state.sessions = Array.isArray(data) ? data : [];

    // Sync activeProjectId with current session if available
    const cur = state.sessions.find(s => s.id === state.sessionId);
    if (cur) {
      state.activeProjectId = cur.projectId || null;
      updateProjectTopBar();
      const bcTitle = $('topbar-active-chat-title');
      if (bcTitle && cur.title) bcTitle.textContent = cur.title;
    }

    try {
      if ((state.autoSession === 'first' || new URLSearchParams(window.location.search).get('session') === 'first') && state.sessions.length > 0) {
        delete state.autoSession;
        await switchSession(state.sessions[0].id);
        return;
      }
    } catch (_) {}

    renderHistory();
    updateInputReadOnlyState();
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

function showToast(message, type = 'success') {
  let container = $('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  const icon = type === 'success' ? '✓' : (type === 'error' ? '✕' : 'ℹ');
  el.innerHTML = `<span class="toast-icon">${icon}</span> <span class="toast-text">${escHtml(message)}</span>`;
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast-fadeout');
    setTimeout(() => {
      el.remove();
    }, 300);
  }, 3000);
}

function renderHistory() {
  const c = $('chat-history') || $$('.chat-history');
  if (!c) return;
  c.innerHTML = '';

  // Filter out any sessions bound to a project workspace (Chats tab is purely regular chats)
  const regularSessions = (state.sessions || []).filter(s => !s.projectId);

  if (regularSessions.length === 0) {
    c.innerHTML = '<div class="chat-history-empty">Belum ada obrolan</div>';
    return;
  }

  regularSessions.forEach(item => {
    const el = document.createElement('div');
    const isActive = item.id === state.sessionId;

    el.className = 'chat-history-item' + (isActive ? ' active' : '');
    el.dataset.id = item.id;

    el.innerHTML = `
      <span class="chat-history-title" title="${escAttr(item.title)}">${escHtml(item.title)}</span>
      ${item.hasSummary ? '<span class="chat-memory-badge" title="Smart memory aktif"></span>' : ''}
      <div class="chat-history-actions">
        <button class="chat-kebab-btn" title="Opsi"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>
      </div>
    `;

    el.addEventListener('click', e => {
      if (e.target.closest('.chat-history-actions') || e.target.closest('.chat-history-rename-input')) return;
      if (state.streaming) return;
      switchSession(item.id);
    });

    const kebabBtn = el.querySelector('.chat-kebab-btn');
    kebabBtn?.addEventListener('click', e => {
      e.stopPropagation();
      showChatKebabMenu(e, item.id, item.title, null);
    });

    c.appendChild(el);
  });

  // Also re-render projects panel if it's visible (sessions may have changed projectId links)
  const projPanel = $('panel-projects');
  if (projPanel && !projPanel.classList.contains('hidden')) {
    renderProjects();
  }
}

// ── Kebab popover menu for chat items ────────────────────────────────────────
let _activeKebabMenu = null;

function closeKebabMenu() {
  if (_activeKebabMenu) {
    _activeKebabMenu.remove();
    _activeKebabMenu = null;
  }
}

function showChatKebabMenu(e, sessionId, title, currentProjectId) {
  closeKebabMenu();

  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.className = 'chat-kebab-menu';
  _activeKebabMenu = menu;

  const items = [
    {
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 11 15 14 12 17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>`,
      label: currentProjectId ? 'Pindah ke Project Lain' : 'Pindahkan ke Project',
      action: () => openMoveChatModal(sessionId, title, currentProjectId)
    }
  ];

  if (currentProjectId) {
    items.push({
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
      label: 'Keluarkan dari Project',
      action: async () => {
        await moveSessionToProject(sessionId, null, '');
      }
    });
  }

  items.push(
    {
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
      label: 'Ubah Nama',
      action: () => startInlineRename(sessionId, title, currentProjectId)
    },
    {
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
      label: 'Hapus',
      action: () => deleteSession(sessionId),
      danger: true
    }
  );

  items.forEach(item => {
    const row = document.createElement('button');
    row.className = 'chat-kebab-item' + (item.danger ? ' danger' : '');
    row.innerHTML = `<span class="kebab-item-icon">${item.icon}</span><span>${item.label}</span>`;
    row.addEventListener('click', ev => {
      ev.stopPropagation();
      closeKebabMenu();
      item.action();
    });
    menu.appendChild(row);
  });

  document.body.appendChild(menu);

  // Position: prefer below-right of button, flip if off-screen
  const menuW = 188;
  const menuH = items.length * 36 + 12;
  let top = rect.bottom + 4;
  let left = rect.right - menuW;
  if (left < 6) left = 6;
  if (top + menuH > window.innerHeight - 8) top = rect.top - menuH - 4;

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  setTimeout(() => {
    document.addEventListener('click', closeKebabMenu, { once: true });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeKebabMenu(); }, { once: true });
  }, 0);
}

function startInlineRename(sessionId, currentTitle, projectId) {
  const selector = `.chat-history-item[data-id="${sessionId}"], .project-chat-row[data-id="${sessionId}"]`;
  const container = document.querySelector(selector);
  if (!container) return;
  const titleSpan = container.querySelector('.chat-history-title, .project-chat-title');
  if (!titleSpan) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = projectId ? 'project-chat-rename-input' : 'chat-history-rename-input';
  input.value = currentTitle || '';
  titleSpan.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const val = input.value.trim();
    if (val && val !== currentTitle) {
      await renameSession(sessionId, val);
    } else {
      projectId ? renderProjects() : renderHistory();
    }
  };

  input.addEventListener('keydown', async ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); await commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); committed = true; projectId ? renderProjects() : renderHistory(); }
  });
  input.addEventListener('blur', commit);
}

function showProjectKebabMenu(e, projId, projName, projPath) {
  closeKebabMenu();

  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.className = 'chat-kebab-menu';
  _activeKebabMenu = menu;

  const items = [
    {
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
      label: 'Percakapan Baru',
      action: () => startNewProjectChat(projId, projName, projPath)
    },
    {
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
      label: 'Pengaturan Project',
      action: () => openEditProjectModal(projId)
    },
    {
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
      label: 'Hapus Project',
      action: () => deleteProject(projId, projName),
      danger: true
    }
  ];

  items.forEach(item => {
    const row = document.createElement('button');
    row.className = 'chat-kebab-item' + (item.danger ? ' danger' : '');
    row.innerHTML = `<span class="kebab-item-icon">${item.icon}</span><span>${item.label}</span>`;
    row.addEventListener('click', ev => {
      ev.stopPropagation();
      closeKebabMenu();
      item.action();
    });
    menu.appendChild(row);
  });

  document.body.appendChild(menu);

  const menuW = 184;
  const menuH = 116;
  let top = rect.bottom + 4;
  let left = rect.right - menuW;
  if (left < 6) left = 6;
  if (top + menuH > window.innerHeight - 8) top = rect.top - menuH - 4;

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  setTimeout(() => {
    document.addEventListener('click', closeKebabMenu, { once: true });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeKebabMenu(); }, { once: true });
  }, 0);
}

function updateProjectTopBar() {
  const pill = $('topbar-project-pill');
  const nameEl = $('topbar-project-name');
  if (!pill) return;

  if (state.activeProjectId) {
    const proj = projectsCache.find(p => p.id === state.activeProjectId);
    const projName = proj ? proj.name : 'Workspace';
    if (nameEl) nameEl.textContent = projName;
    pill.style.display = 'inline-flex';
    pill.title = `Workspace Project Aktif: ${projName}${proj?.path ? ' (' + proj.path + ')' : ''}`;
  } else {
    pill.style.display = 'none';
  }
}

function exitProjectWorkspace() {
  state.activeProjectId = null;
  updateProjectTopBar();
  switchSidebarTab('chats');
  startNewChat();
}

async function switchSession(id) {
  if (state.streaming) return;
  state.sessionId = id;
  localStorage.setItem(SESSION_KEY, id);

  const found = state.sessions.find(s => s.id === id);
  state.activeProjectId = found?.projectId || null;
  state.roleplayActive = found?.roleplayActive || false;
  state.activePersonaId = found?.personaId || null;
  updateProjectTopBar();
  updatePersonaTopBar();
  const bcTitle = $('topbar-active-chat-title');
  if (bcTitle) bcTitle.textContent = found?.title || 'Conversation';

  renderHistory();
  renderProjects();
  await loadChatHistory();
  updateInputReadOnlyState();
  if (window.innerWidth <= 700) closeSidebar();
}

function startNewChat() {
  if (state.streaming) return;

  // If currently in projects tab and there is an active project:
  if (state.sidebarTab === 'projects' && state.activeProjectId) {
    const proj = projectsCache.find(p => p.id === state.activeProjectId);
    if (proj) {
      startNewProjectChat(proj.id, proj.name, proj.path);
      return;
    }
  }

  // Standalone chat (not tied to any project workspace)
  state.activeProjectId = null;
  updateProjectTopBar();
  state.sessionId = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, state.sessionId);
  thinkingPanelRow = null;

  const bcTitle = $('topbar-active-chat-title');
  if (bcTitle) bcTitle.textContent = 'New conversation';

  const msgs = $$('.chat-messages');
  if (msgs) {
    msgs.innerHTML = getWelcomeStateHTML();
  }
  renderHistory();
  renderProjects();
  updateInputReadOnlyState();
  $('chat-input')?.focus();
  if (window.innerWidth <= 700) closeSidebar();
}

function startNewProjectChat(projId, projName, projPath) {
  if (state.streaming) return;
  state.activeProjectId = projId;
  updateProjectTopBar();
  state.sessionId = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, state.sessionId);
  thinkingPanelRow = null;

  const bcTitle = $('topbar-active-chat-title');
  if (bcTitle) bcTitle.textContent = projName || 'Project Workspace';

  const msgs = $$('.chat-messages');
  if (msgs) {
    msgs.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title" style="display:flex;align-items:center;justify-content:center;gap:8px;">
          <span>📁</span> <span>${escHtml(projName || 'Project Workspace')}</span>
        </div>
        <div class="empty-state-sub" style="font-family:var(--font-mono);font-size:12px;opacity:0.8;">${projPath ? escHtml(projPath) : 'Workspace Project'}</div>
        <div class="empty-state-hint" style="margin-top:12px;max-width:480px;font-size:12.5px;line-height:1.6;opacity:0.75;text-align:center;">
          Ketik pesan pertama untuk memulai obrolan baru di project ini.<br>
          File yang dibuat/diedit dan perintah terminal akan dieksekusi langsung di folder ini.
        </div>
      </div>`;
  }
  renderHistory();
  renderProjects();
  updateInputReadOnlyState();
  $('chat-input')?.focus();
  if (window.innerWidth <= 700) closeSidebar();
}


async function renameSession(id, newTitle) {
  if (!id || !newTitle || !newTitle.trim()) return;
  const cleanTitle = newTitle.trim().slice(0, 80);
  try {
    await apiFetch(`${API_BASE}/api/sessions/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title: cleanTitle })
    });
    const s = state.sessions.find(x => x.id === id);
    if (s) s.title = cleanTitle;
    renderHistory();
  } catch (err) {
    console.error('[renameSession] Failed:', err);
    renderHistory();
  }
}

async function deleteSession(id) {
  try {
    await apiFetch(`${API_BASE}/api/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id })
    });
  } catch {}

  if (state.sessionId === id) {
    startNewChat();
  }
  await loadSessions();
}

async function clearAllSessions() {
  if (!confirm('Yakin ingin menghapus semua riwayat obrolan dari sistem?')) return;
  try {
    await apiFetch(`${API_BASE}/api/sessions/clear-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch {}

  startNewChat();
  await loadSessions();
  $('settings-modal-overlay')?.classList.remove('active');
}

// ── Model badge ───────────────────────────────────────
function renderModelBadge() {
  const nameEl = $$('.model-name-text') || $('topbar-model-text');
  if (nameEl) {
    nameEl.textContent = state.model;
  } else {
    const b = $$('.model-badge');
    if (b) b.textContent = state.model;
  }
}

function setModel(m) {
  state.model = m;
  renderModelBadge();
  closeModal();
}

// ── Sidebar ───────────────────────────────────────────
function setupSidebar() {
  const toggleBtn = $$('.btn-sidebar-toggle');
  const overlay   = $$('.sidebar-overlay');
  const sidebar   = $$('.sidebar');

  toggleBtn?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  });
  overlay?.addEventListener('click', closeSidebar);

  // New chat buttons (sidebar + topbar)
  $('btn-new-chat-sidebar')?.addEventListener('click', () => { startNewChat(); });
  $$('.btn-new-chat-topbar')?.addEventListener('click', () => { startNewChat(); });

  // Topbar active project pill & exit button
  $('btn-exit-project')?.addEventListener('click', (e) => {
    e.stopPropagation();
    exitProjectWorkspace();
  });
  $('topbar-project-pill')?.addEventListener('click', () => {
    switchSidebarTab('projects');
    const sb = $$('.sidebar');
    if (sb && !sb.classList.contains('open') && window.innerWidth <= 700) {
      sb.classList.add('open');
      $$('.sidebar-overlay')?.classList.add('active');
    }
  });

  // Dual tab switcher
  $('sidebar-tab-chats')?.addEventListener('click', () => switchSidebarTab('chats'));
  $('sidebar-tab-projects')?.addEventListener('click', () => switchSidebarTab('projects'));

  // New project button
  $('btn-new-project')?.addEventListener('click', openCreateProjectModal);

  // Create project modal triggers
  $('close-create-project')?.addEventListener('click', closeCreateProjectModal);
  $('btn-skip-project')?.addEventListener('click', closeCreateProjectModal);
  $('btn-trigger-add-folder')?.addEventListener('click', showFolderExplorerView);
  $('badge-folder-clear')?.addEventListener('click', () => {
    const badgeWrap = $('selected-folder-badge-wrap');
    if (badgeWrap) badgeWrap.style.display = 'none';
    const trigBtn = $('btn-trigger-add-folder');
    if (trigBtn) trigBtn.style.display = 'flex';
    const footer = $('project-prompt-footer');
    if (footer) footer.style.display = 'flex';
  });
  $('btn-confirm-create-project')?.addEventListener('click', onConfirmCreateProject);

  // Folder Explorer navigation triggers
  $('btn-explorer-back-to-prompt')?.addEventListener('click', () => {
    if (folderPickerTarget === 'edit') {
      closeCreateProjectModal();
      const editModal = $('edit-project-modal');
      if (editModal) editModal.style.display = 'flex';
    } else {
      showPromptView();
    }
  });
  $('btn-explorer-confirm')?.addEventListener('click', onFolderConfirmed);
  $('explorer-btn-up')?.addEventListener('click', () => {
    if (explorerParentPath !== null) navigateToPath(explorerParentPath);
  });
  $('explorer-btn-refresh')?.addEventListener('click', () => {
    navigateToPath(explorerCurrentPath);
  });
  $('btn-native-win-picker')?.addEventListener('click', triggerNativeWindowsPicker);

  // Close modal on backdrop click
  $('create-project-modal')?.addEventListener('click', (e) => {
    if (e.target === $('create-project-modal')) closeCreateProjectModal();
  });

  // Move Chat Modal triggers
  $('close-move-chat')?.addEventListener('click', closeMoveChatModal);
  $('move-chat-modal')?.addEventListener('click', (e) => {
    if (e.target === $('move-chat-modal')) closeMoveChatModal();
  });
  $('btn-create-proj-from-move')?.addEventListener('click', () => {
    sessionToMoveAfterCreate = movingSessionId;
    closeMoveChatModal();
    openCreateProjectModal();
  });
  $('btn-detach-proj-from-move')?.addEventListener('click', () => {
    if (movingSessionId) {
      moveSessionToProject(movingSessionId, null);
    }
  });

  // Edit Project Modal triggers (Manus style)
  $('close-edit-project')?.addEventListener('click', closeEditProjectModal);
  $('btn-cancel-edit-project')?.addEventListener('click', closeEditProjectModal);
  $('edit-project-modal')?.addEventListener('click', (e) => {
    if (e.target === $('edit-project-modal')) closeEditProjectModal();
  });
  $('btn-save-project-settings')?.addEventListener('click', onSaveProjectSettings);
  $('btn-edit-proj-browse-folder')?.addEventListener('click', showFolderExplorerForEdit);
  $('btn-edit-proj-native-explorer')?.addEventListener('click', triggerNativeWindowsPickerForEdit);
}

function switchSidebarTab(tab) {
  state.sidebarTab = tab;

  // Update tab buttons
  document.querySelectorAll('.sidebar-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Toggle panels
  const panelChats = $('panel-chats');
  const panelProjects = $('panel-projects');
  if (panelChats) panelChats.classList.toggle('hidden', tab !== 'chats');
  if (panelProjects) panelProjects.classList.toggle('hidden', tab !== 'projects');

  // Load projects when switching to that tab
  if (tab === 'projects') {
    loadProjects();
  } else {
    renderHistory();
  }
}

// ── Projects: Load & Render ────────────────────────────
let projectsCache = [];

async function loadProjects() {
  try {
    const r = await apiFetch(`${API_BASE}/api/projects`);
    if (!r.ok) return;
    const data = await r.json();
    projectsCache = Array.isArray(data) ? data : [];
    updateProjectTopBar();
    renderProjects();
  } catch (err) {
    console.error('Failed to load projects:', err);
  }
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diff = Math.max(0, Date.now() - timestamp);
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  if (hr < 24) return `${hr}h`;
  return `${day}d`;
}

async function previewProjectFile(projId, fileName) {
  try {
    const r = await apiFetch(`${API_BASE}/api/projects/${projId}/file-content?path=${encodeURIComponent(fileName)}`);
    const data = await r.json();
    if (!data || (data.content === undefined && !data.error)) {
      alert('Gagal membaca berkas');
      return;
    }
    if (data.error) {
      alert(data.error);
      return;
    }
    const isHtml = fileName.endsWith('.html') || fileName.endsWith('.htm');
    openArtifactSidebar(fileName, data.content, isHtml ? 'html' : 'code');
    if (!isHtml) {
      switchArtifactSidebarTab('code');
    }
    const topbarBtn = $('btn-topbar-artifact');
    if (topbarBtn) topbarBtn.style.display = 'flex';
  } catch (err) {
    console.error('previewProjectFile error:', err);
  }
}

async function fetchProjectFilesCount(projId) {
  try {
    const r = await apiFetch(`${API_BASE}/api/projects/${projId}/files`);
    const data = await r.json();
    if (data.files) {
      const countEl = document.getElementById(`files-count-${projId}`);
      if (countEl) countEl.textContent = `${data.files.length}`;
    }
  } catch {}
}

let expandedProjectIds = new Set();
let _expandedInitialized = false;

function renderProjects() {
  const container = $('project-list');
  if (!container) return;
  container.innerHTML = '';

  if (projectsCache.length === 0) {
    container.innerHTML = `
      <div class="project-empty">
        Belum ada project.<br>
        <span style="color:#aa8668;cursor:pointer;text-decoration:underline;" onclick="openCreateProjectModal()">+ Add Folder</span> untuk membuat workspace project.
      </div>`;
    return;
  }

  // Default all projects to expanded initially
  if (!_expandedInitialized) {
    projectsCache.forEach(p => expandedProjectIds.add(p.id));
    _expandedInitialized = true;
  }

  // Build project → chats map
  const projectChats = {};
  projectsCache.forEach(p => { projectChats[p.id] = []; });
  state.sessions.forEach(s => {
    if (s.projectId && projectChats[s.projectId]) {
      projectChats[s.projectId].push(s);
    }
  });

  projectsCache.forEach(proj => {
    const isCurrentProject = proj.id === state.activeProjectId;
    const isExpanded = expandedProjectIds.has(proj.id);
    const chats = projectChats[proj.id] || [];
    chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const item = document.createElement('div');
    item.className = 'project-group' + (isCurrentProject ? ' active-workspace' : '');
    item.dataset.projectId = proj.id;

    // Clean Collapsible Project Header
    const header = document.createElement('div');
    header.className = 'project-group-header';
    header.style.cursor = 'pointer';
    header.innerHTML = `
      <div class="project-header-left" title="${escAttr(proj.name)} • ${escAttr(proj.path || 'Folder belum diatur')}">
        <svg class="project-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transform: ${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}; transition: transform 0.15s ease;"><polyline points="9 18 15 12 9 6"/></svg>
        <svg class="project-folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="project-group-name">${escHtml(proj.name)}</span>
        ${isCurrentProject ? '<span class="project-active-badge">ACTIVE</span>' : ''}
      </div>
      <div class="project-group-actions">
        <button class="proj-add-chat-btn" title="Obrolan baru di ${escAttr(proj.name)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button class="proj-kebab-btn" title="Opsi Project"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>
      </div>
    `;

    // Chats container (Tree indentation)
    const chatsContainer = document.createElement('div');
    chatsContainer.className = 'project-chats-list';
    chatsContainer.style.display = isExpanded ? 'flex' : 'none';

    // Click header -> toggle collapse / expand
    header.addEventListener('click', (e) => {
      if (e.target.closest('.project-group-actions')) return;
      const chevron = header.querySelector('.project-chevron');
      if (expandedProjectIds.has(proj.id)) {
        expandedProjectIds.delete(proj.id);
        chatsContainer.style.display = 'none';
        if (chevron) chevron.style.transform = 'rotate(0deg)';
      } else {
        expandedProjectIds.add(proj.id);
        chatsContainer.style.display = 'flex';
        if (chevron) chevron.style.transform = 'rotate(90deg)';
      }
    });

    // Quick '+' button on hover
    const addChatBtn = header.querySelector('.proj-add-chat-btn');
    addChatBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      startNewProjectChat(proj.id, proj.name, proj.path);
    });

    // Project kebab menu (edit, new chat, delete)
    const projKebabBtn = header.querySelector('.proj-kebab-btn');
    projKebabBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      showProjectKebabMenu(e, proj.id, proj.name, proj.path);
    });

    if (chats.length > 0) {
      chats.forEach(chat => {
        const chatRow = document.createElement('div');
        const isActive = chat.id === state.sessionId;
        chatRow.className = 'project-chat-row' + (isActive ? ' active' : '');
        chatRow.dataset.id = chat.id;
        chatRow.innerHTML = `
          <svg class="project-chat-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span class="project-chat-title" title="${escAttr(chat.title || 'Percakapan')}">${escHtml(chat.title || 'Percakapan')}</span>
          ${chat.hasSummary ? '<span class="chat-memory-badge" title="Smart memory aktif"></span>' : ''}
          <span class="project-chat-time">${formatRelativeTime(chat.updatedAt)}</span>
          <div class="project-chat-actions">
            <button class="chat-kebab-btn" title="Opsi"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>
          </div>
        `;

        chatRow.addEventListener('click', (e) => {
          if (e.target.closest('.project-chat-actions') || e.target.closest('.project-chat-rename-input')) return;
          if (state.streaming) return;
          switchSession(chat.id);
        });

        const projChatKebabBtn = chatRow.querySelector('.chat-kebab-btn');
        projChatKebabBtn?.addEventListener('click', e => {
          e.stopPropagation();
          showChatKebabMenu(e, chat.id, chat.title, proj.id);
        });

        chatsContainer.appendChild(chatRow);
      });
    } else {
      const emptyRow = document.createElement('div');
      emptyRow.className = 'project-chat-empty';
      emptyRow.textContent = 'Belum ada obrolan';
      chatsContainer.appendChild(emptyRow);
    }

    item.appendChild(header);
    item.appendChild(chatsContainer);
    container.appendChild(item);
  });
}


// ── Move Chat to Project & Project Workspace Settings (Manus Style) ──
let movingSessionId = null;
let sessionToMoveAfterCreate = null;
let editingProjectId = null;
let folderPickerTarget = 'create'; // 'create' | 'edit'

function openMoveChatModal(sessionId, sessionTitle, currentProjectId) {
  movingSessionId = sessionId;
  const modal = $('move-chat-modal');
  const titleEl = $('move-chat-target-title');
  const listEl = $('move-chat-project-list');
  const detachBtn = $('btn-detach-proj-from-move');

  if (titleEl) titleEl.textContent = sessionTitle || 'Percakapan';
  if (detachBtn) {
    detachBtn.style.display = currentProjectId ? 'inline-flex' : 'none';
  }

  if (listEl) {
    listEl.innerHTML = '';
    if (!projectsCache || projectsCache.length === 0) {
      listEl.innerHTML = '<div class="chat-history-empty" style="padding:16px 8px;">Belum ada workspace project.<br>Klik "+ Buat Project Baru" di bawah.</div>';
    } else {
      projectsCache.forEach(proj => {
        const isCurrent = proj.id === currentProjectId;
        const item = document.createElement('div');
        item.className = 'move-chat-project-item' + (isCurrent ? ' current' : '');
        item.innerHTML = `
          <div class="move-chat-proj-left">
            <div class="move-chat-proj-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="move-chat-proj-meta">
              <span class="move-chat-proj-name">${escHtml(proj.name)}</span>
              <span class="move-chat-proj-path">${escHtml(proj.path || 'Folder belum diatur')}</span>
            </div>
          </div>
          <div class="move-chat-proj-right">
            ${isCurrent ? '<span class="move-chat-current-badge">Project Ini</span>' : '<span class="move-chat-chats-badge">' + (proj.chatCount || 0) + ' chat</span>'}
          </div>
        `;

        if (!isCurrent) {
          item.addEventListener('click', async () => {
            await moveSessionToProject(sessionId, proj.id, proj.name);
          });
        }
        listEl.appendChild(item);
      });
    }
  }

  if (modal) modal.style.display = 'flex';
}

function closeMoveChatModal() {
  const modal = $('move-chat-modal');
  if (modal) modal.style.display = 'none';
  movingSessionId = null;
}

async function moveSessionToProject(sessionId, targetProjectId, targetProjectName = '') {
  try {
    const res = await apiFetch(`${API_BASE}/api/sessions/${sessionId}/attach-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: targetProjectId })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast(data?.error || 'Gagal memindahkan percakapan', 'error');
      return;
    }

    closeMoveChatModal();

    // Update in-memory session object
    const s = state.sessions.find(x => x.id === sessionId);
    if (s) {
      s.projectId = targetProjectId;
    }

    // If currently viewing this session, update state.activeProjectId and topbar
    if (state.sessionId === sessionId) {
      state.activeProjectId = targetProjectId;
      updateProjectTopBar();
    }

    // Reload sessions and project list
    await loadSessions();
    await loadProjects();
    renderHistory();
    renderProjects();

    if (targetProjectId) {
      showToast(`Obrolan berhasil dipindahkan ke "${targetProjectName || 'Project'}"!`, 'success');
    } else {
      showToast('Obrolan dikembalikan ke obrolan biasa.', 'success');
    }
  } catch (err) {
    console.error('moveSessionToProject error:', err);
    showToast('Terjadi kesalahan saat memindahkan obrolan', 'error');
  }
}

function openEditProjectModal(projId) {
  const proj = projectsCache.find(p => p.id === projId);
  if (!proj) return;
  editingProjectId = projId;

  const modal = $('edit-project-modal');
  const nameInput = $('edit-proj-name');
  const pathInput = $('edit-proj-path');
  const errEl = $('edit-project-error');
  const statusEl = $('edit-proj-path-status');

  if (nameInput) nameInput.value = proj.name || '';
  if (pathInput) pathInput.value = proj.path || '';
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }

  if (modal) modal.style.display = 'flex';
}

function closeEditProjectModal() {
  const modal = $('edit-project-modal');
  if (modal) modal.style.display = 'none';
  editingProjectId = null;
}

async function onSaveProjectSettings() {
  if (!editingProjectId) return;
  const nameInput = $('edit-proj-name');
  const pathInput = $('edit-proj-path');
  const errEl = $('edit-project-error');

  const name = nameInput?.value?.trim();
  const pathVal = pathInput?.value?.trim() || '';

  if (!name) {
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Nama project wajib diisi!'; }
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/api/projects/${editingProjectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: pathVal })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = data.error || 'Gagal menyimpan perubahan project'; }
      return;
    }

    closeEditProjectModal();
    await loadProjects();
    renderProjects();
    updateProjectTopBar();

    showToast(`Pengaturan project "${name}" berhasil disimpan!`, 'success');
  } catch (err) {
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Gagal menyimpan ke server'; }
  }
}

function showFolderExplorerForEdit() {
  folderPickerTarget = 'edit';
  const editModal = $('edit-project-modal');
  if (editModal) editModal.style.display = 'none';

  const createModal = $('create-project-modal');
  if (createModal) createModal.style.display = 'flex';

  const promptView = $('project-prompt-view');
  const explorerView = $('project-explorer-view');
  if (promptView) promptView.style.display = 'none';
  if (explorerView) explorerView.style.display = 'flex';

  const currentVal = $('edit-proj-path')?.value?.trim();
  navigateToPath(currentVal || '');
}

async function triggerNativeWindowsPickerForEdit() {
  const btn = $('btn-edit-proj-native-explorer');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Membuka di laptop...';
  }
  try {
    const r = await apiFetch(`${API_BASE}/api/browse-native`, { method: 'POST' });
    const data = await r.json();
    if (data.ok && data.path) {
      const pathInput = $('edit-proj-path');
      if (pathInput) pathInput.value = data.path;
      const nameInput = $('edit-proj-name');
      if (nameInput && !nameInput.value.trim() && data.name) {
        nameInput.value = data.name;
      }
    }
  } catch (e) {
    console.warn('Native picker for edit failed:', e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Explorer Windows`;
    }
  }
}

async function attachCurrentToProject(projId) {
  try {
    const r = await apiFetch(`${API_BASE}/api/sessions/${state.sessionId}/attach-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: projId })
    });
    if (r.ok) {
      await loadSessions();
      loadProjects();
    }
  } catch (e) {
    console.error('attachCurrentToProject failed:', e);
  }
}

async function deleteProject(projId, projName) {
  if (!confirm(`Hapus project "${projName}"? Obrolan yang ditautkan tidak akan dihapus.`)) return;
  try {
    await apiFetch(`${API_BASE}/api/projects/${projId}`, { method: 'DELETE' });
    await loadSessions();
    loadProjects();
  } catch (e) {
    console.error('deleteProject failed:', e);
  }
}

// ── Create Project Modal & Visual Folder Explorer (Workspace Style) ──
let explorerCurrentPath = '';
let explorerParentPath = null;
let explorerSelectedPath = '';
let explorerSelectedName = '';

function openCreateProjectModal() {
  folderPickerTarget = 'create';
  const modal = $('create-project-modal');
  if (modal) modal.style.display = 'flex';

  // Reset to initial step
  const promptView = $('project-prompt-view');
  const explorerView = $('project-explorer-view');
  const badgeWrap = $('selected-folder-badge-wrap');
  const triggerBtn = $('btn-trigger-add-folder');
  const promptFooter = $('project-prompt-footer');
  const err = $('create-project-error');

  if (promptView) promptView.style.display = 'block';
  if (explorerView) explorerView.style.display = 'none';
  if (badgeWrap) badgeWrap.style.display = 'none';
  if (triggerBtn) triggerBtn.style.display = 'flex';
  if (promptFooter) promptFooter.style.display = 'flex';
  if (err) { err.style.display = 'none'; err.textContent = ''; }

  explorerSelectedPath = '';
  explorerSelectedName = '';
}

function closeCreateProjectModal() {
  const modal = $('create-project-modal');
  if (modal) modal.style.display = 'none';
}

function showFolderExplorerView() {
  const promptView = $('project-prompt-view');
  const explorerView = $('project-explorer-view');
  if (promptView) promptView.style.display = 'none';
  if (explorerView) explorerView.style.display = 'flex';
  navigateToPath(explorerCurrentPath || '');
}

function showPromptView() {
  const promptView = $('project-prompt-view');
  const explorerView = $('project-explorer-view');
  if (explorerView) explorerView.style.display = 'none';
  if (promptView) promptView.style.display = 'block';
}

function pathJoinSimple(p1, p2) {
  if (!p1) return p2;
  if (p1.endsWith('\\') || p1.endsWith('/')) return p1 + p2;
  return p1 + '\\' + p2;
}

async function navigateToPath(targetPath) {
  const container = $('explorer-list-container');
  const breadcrumbs = $('explorer-breadcrumbs');
  const drivesRow = $('explorer-drives-row');
  const selectedInput = $('explorer-selected-input');
  const confirmBtn = $('btn-explorer-confirm');

  if (container) container.innerHTML = '<div class="explorer-loading">Memuat folder...</div>';

  try {
    const url = targetPath ? `${API_BASE}/api/browse-folders?path=${encodeURIComponent(targetPath)}` : `${API_BASE}/api/browse-folders`;
    const r = await apiFetch(url);
    if (!r.ok) {
      if (container) container.innerHTML = '<div class="explorer-empty">Gagal memuat direktori</div>';
      return;
    }
    const data = await r.json();
    explorerCurrentPath = data.currentPath || '';
    explorerParentPath = data.parentPath !== undefined ? data.parentPath : null;

    // Render breadcrumbs: This PC > Local Disk (G:) > CONTENT
    if (breadcrumbs) {
      breadcrumbs.innerHTML = '';
      const rootCrumb = document.createElement('span');
      rootCrumb.className = 'explorer-crumb';
      rootCrumb.textContent = 'This PC';
      rootCrumb.addEventListener('click', () => navigateToPath(''));
      breadcrumbs.appendChild(rootCrumb);

      if (explorerCurrentPath) {
        const parts = explorerCurrentPath.split(/\\|\//).filter(Boolean);
        let accumulated = '';
        parts.forEach((part, idx) => {
          const sep = document.createElement('span');
          sep.className = 'explorer-crumb-sep';
          sep.textContent = '>';
          breadcrumbs.appendChild(sep);

          if (idx === 0 && /^[a-zA-Z]:$/.test(part)) {
            accumulated = part + '\\';
          } else {
            accumulated = accumulated ? pathJoinSimple(accumulated, part) : part;
          }
          const thisPath = accumulated;

          const crumb = document.createElement('span');
          crumb.className = 'explorer-crumb';
          crumb.textContent = part;
          crumb.addEventListener('click', () => navigateToPath(thisPath));
          breadcrumbs.appendChild(crumb);
        });
      }
      breadcrumbs.scrollLeft = breadcrumbs.scrollWidth;
    }

    // Render Quick Drive pills (Acer C:, D:, Future E:, GAME F:, G:)
    if (drivesRow && data.drives && data.drives.length > 0) {
      drivesRow.innerHTML = '';
      data.drives.forEach(d => {
        const chip = document.createElement('button');
        const isActive = explorerCurrentPath.toUpperCase().startsWith(d.letter.toUpperCase());
        chip.className = 'explorer-drive-chip' + (isActive ? ' active' : '');
        chip.innerHTML = `<span>💾</span> <span>${escHtml(d.name)}</span>`;
        chip.addEventListener('click', () => navigateToPath(d.path));
        drivesRow.appendChild(chip);
      });
    }

    // Update input and selection
    explorerSelectedPath = explorerCurrentPath;
    explorerSelectedName = explorerCurrentPath ? (explorerCurrentPath.split(/\\|\//).filter(Boolean).pop() || explorerCurrentPath) : '';
    if (selectedInput) selectedInput.value = explorerSelectedPath || '';
    if (confirmBtn) confirmBtn.disabled = !explorerSelectedPath;

    // Render folder items
    if (container) {
      container.innerHTML = '';
      if (!data.folders || data.folders.length === 0) {
        container.innerHTML = '<div class="explorer-empty">Tidak ada subfolder di sini.</div>';
        return;
      }

      data.folders.forEach(f => {
        const row = document.createElement('div');
        row.className = 'explorer-folder-row';
        row.innerHTML = `
          <span class="explorer-row-icon">${f.isDrive ? '💾' : '📁'}</span>
          <span class="explorer-row-name">${escHtml(f.name)}</span>
          <span class="explorer-row-arrow">›</span>
        `;

        // Click to select
        row.addEventListener('click', () => {
          document.querySelectorAll('.explorer-folder-row').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          explorerSelectedPath = f.path;
          explorerSelectedName = f.name;
          if (selectedInput) selectedInput.value = f.path;
          if (confirmBtn) confirmBtn.disabled = false;
        });

        // Double click to open folder
        row.addEventListener('dblclick', () => {
          navigateToPath(f.path);
        });

        container.appendChild(row);
      });
    }
  } catch (e) {
    console.error('navigateToPath error:', e);
    if (container) container.innerHTML = '<div class="explorer-empty">Terjadi kesalahan saat memuat direktori</div>';
  }
}

// When user clicks "Select Folder" in explorer view
function onFolderConfirmed() {
  if (!explorerSelectedPath) return;

  if (folderPickerTarget === 'edit') {
    const pathInput = $('edit-proj-path');
    if (pathInput) pathInput.value = explorerSelectedPath;
    const nameInput = $('edit-proj-name');
    if (nameInput && !nameInput.value.trim()) {
      const folderName = explorerSelectedName || explorerSelectedPath.split(/\\|\//).filter(Boolean).pop() || '';
      nameInput.value = folderName;
    }
    closeCreateProjectModal();
    const editModal = $('edit-project-modal');
    if (editModal) editModal.style.display = 'flex';
    return;
  }

  const folderName = explorerSelectedName || explorerSelectedPath.split(/\\|\//).filter(Boolean).pop() || 'Project';

  // Populate prompt view badge
  const bName = $('badge-folder-name');
  const bPath = $('badge-folder-path');
  const finalInput = $('final-project-name');
  if (bName) bName.textContent = folderName;
  if (bPath) bPath.textContent = explorerSelectedPath;
  if (finalInput) finalInput.value = folderName;

  // Switch to confirmed state
  const trigBtn = $('btn-trigger-add-folder');
  const badgeWrap = $('selected-folder-badge-wrap');
  const pFooter = $('project-prompt-footer');
  if (trigBtn) trigBtn.style.display = 'none';
  if (badgeWrap) badgeWrap.style.display = 'block';
  if (pFooter) pFooter.style.display = 'none';

  showPromptView();
}

async function onConfirmCreateProject() {
  const finalInput = $('final-project-name');
  const bName = $('badge-folder-name');
  const bPath = $('badge-folder-path');
  const name = finalInput?.value?.trim() || bName?.textContent?.trim() || 'Project';
  const projPath = bPath?.textContent?.trim() || explorerSelectedPath;
  const err = $('create-project-error');

  if (!name) {
    if (err) { err.style.display = 'block'; err.textContent = 'Nama project wajib diisi!'; }
    return;
  }

  try {
    const r = await apiFetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: projPath })
    });
    const data = await r.json();
    if (data.ok) {
      closeCreateProjectModal();
      await loadProjects();

      // If user came from "Move Chat", attach that chat to this newly created project
      if (sessionToMoveAfterCreate) {
        const sId = sessionToMoveAfterCreate;
        sessionToMoveAfterCreate = null;
        await moveSessionToProject(sId, data.project.id, data.project.name);
        return;
      }

      switchSidebarTab('projects');
      startNewProjectChat(data.project.id, data.project.name, data.project.path);
    } else {
      if (err) { err.style.display = 'block'; err.textContent = data.error || 'Gagal membuat project'; }
    }
  } catch (e) {
    if (err) { err.style.display = 'block'; err.textContent = 'Gagal koneksi ke server'; }
  }
}

async function triggerNativeWindowsPicker() {
  const btn = $('btn-native-win-picker');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Membuka di laptop...';
  }

  try {
    const r = await apiFetch(`${API_BASE}/api/browse-native`, { method: 'POST' });
    const data = await r.json();
    if (data.ok && data.path) {
      explorerSelectedPath = data.path;
      explorerSelectedName = data.name || data.path.split(/\\|\//).filter(Boolean).pop() || 'Project';
      onFolderConfirmed();
    }
  } catch (e) {
    console.warn('Native picker failed:', e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Explorer Windows`;
    }
  }
}


function closeSidebar() {
  $$('.sidebar')?.classList.remove('open');
  $$('.sidebar-overlay')?.classList.remove('active');
}

// ── Sanfa Bridge (Local Agent Connector) ───────────────────────
function setupBridgeModal() {
  const pill = $('topbar-bridge-pill');
  const modal = $('bridge-modal-overlay');
  const closeBtn = $('bridge-modal-close');

  pill?.addEventListener('click', () => {
    if (window._openSettingsModal) window._openSettingsModal('bridge');
    else openBridgeModal();
  });

  const sidebarBadge = $('status-machine-badge');
  sidebarBadge?.addEventListener('click', () => {
    if (window._openSettingsModal) window._openSettingsModal('bridge');
    else openBridgeModal();
  });

  closeBtn?.addEventListener('click', () => { closeBridgeModal(); });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeBridgeModal();
  });

  // Tab navigation for 3-method setup
  const tabNav = document.getElementById('bridge-tab-nav');
  if (tabNav) {
    tabNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.bridge-tab-btn');
      if (!btn) return;
      const tab = btn.dataset.tab;
      // Update active tab button
      tabNav.querySelectorAll('.bridge-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Update active content
      document.querySelectorAll('.bridge-tab-content').forEach(c => c.classList.remove('active'));
      const content = document.getElementById(`bridge-tab-${tab}`);
      if (content) content.classList.add('active');
      updateUninstallPane(tab);
    });

  // Accordion toggle: Cara Mematikan Auto-Start
  const accordionToggle = $('btn-toggle-bridge-uninstall');
  const accordionDrawer = $('bridge-uninstall-drawer');
  let accordionOpen = false;

  accordionToggle?.addEventListener('click', () => {
    accordionOpen = !accordionOpen;
    accordionToggle.classList.toggle('active', accordionOpen);
    accordionToggle.setAttribute('aria-expanded', accordionOpen ? 'true' : 'false');
    if (accordionDrawer) {
      accordionDrawer.style.display = accordionOpen ? 'block' : 'none';
    }
  });

  function updateUninstallPane(activeTab) {
    const termPane = $('bridge-uninstall-terminal');
    const zipPane = $('bridge-uninstall-zip');
    const exePane = $('bridge-uninstall-exe');
    if (!termPane || !zipPane || !exePane) return;

    termPane.style.display = 'none';
    zipPane.style.display = 'none';
    exePane.style.display = 'none';

    if (activeTab === 'zip') {
      zipPane.style.display = 'block';
    } else if (activeTab === 'exe') {
      exePane.style.display = 'block';
    } else {
      termPane.style.display = 'block';
    }
  }
  }

  // Copy buttons for commands
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-copy-bridge-cmd');
    if (!btn) return;
    const targetId = btn.dataset.target || btn.id?.replace('btn-copy-', '');
    const codeEl = targetId ? document.getElementById(targetId) : null;
    if (codeEl) {
      navigator.clipboard.writeText(codeEl.textContent.trim()).catch(() => {});
      const prev = btn.textContent;
      btn.textContent = '✓ Tersalin!';
      setTimeout(() => btn.textContent = prev, 1500);
    }
  });

  // Dedicated copy button for Token only
  const copyTokenBtn = $('btn-copy-bridge-token');
  copyTokenBtn?.addEventListener('click', () => {
    const token = getAuthToken() || (state.currentUser && state.currentUser.token) || '';
    if (token) {
      navigator.clipboard.writeText(token).catch(() => {});
      const prev = copyTokenBtn.textContent;
      copyTokenBtn.textContent = '✓ Tersalin!';
      setTimeout(() => copyTokenBtn.textContent = prev, 1500);
    }
  });

  // Test Ping button
  const testBtn = $('btn-bridge-test');
  const testFeedback = $('bridge-test-feedback');

  testBtn?.addEventListener('click', async () => {
    if (testBtn.disabled) return;
    testBtn.disabled = true;
    testBtn.textContent = '⏳ Menguji...';
    if (testFeedback) {
      testFeedback.style.color = '#a89f91';
      testFeedback.textContent = 'Mengirim perintah ping ke laptop lokal...';
    }

    try {
      const res = await apiFetch(`${API_BASE}/api/bridge/test`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        if (testFeedback) {
          testFeedback.style.color = '#86efac';
          testFeedback.textContent = `✅ Sukses! Respon dari ${data.hostname}: ${data.output} (${data.latency}ms)`;
        }
      } else {
        if (testFeedback) {
          testFeedback.style.color = '#f87171';
          testFeedback.textContent = `❌ Gagal: ${data.error || 'Tidak ada respon'}`;
        }
      }
    } catch (err) {
      if (testFeedback) {
        testFeedback.style.color = '#f87171';
        testFeedback.textContent = `❌ Gagal: ${err.message}`;
      }
    } finally {
      testBtn.disabled = false;
      testBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-1px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Test Ping Laptop';
    }
  });

  setInterval(checkBridgeStatus, 10000);
}

function openBridgeModal() {
  const modal = $('bridge-modal-overlay');
  if (modal) modal.style.display = 'flex';

  // Inject real token into command codes & token display
  const token = getAuthToken() || (state.currentUser && state.currentUser.token) || '';
  const serverOrigin = location.origin;

  // 1. Dedicated Token Box
  const tokenValEl = $('bridge-token-val');
  if (tokenValEl) {
    tokenValEl.textContent = token || 'Tidak ada token (silakan login)';
  }

  // 2a. PowerShell Auto-Start (Cukup 1x jalan, otomatis tiap laptop nyala)
  const ps1StartupCode = $('bridge-ps1-startup-code');
  if (ps1StartupCode) {
    if (token) {
      ps1StartupCode.textContent = `$env:BRIDGE_TOKEN='${token}'; $env:BRIDGE_STARTUP='1'; irm ${serverOrigin}/bridge.ps1 | iex`;
    } else {
      ps1StartupCode.textContent = `$env:BRIDGE_STARTUP='1'; irm ${serverOrigin}/bridge.ps1 | iex`;
    }
  }

  // 2b. PowerShell Biasa: inject $env:BRIDGE_TOKEN directly
  const ps1Code = $('bridge-ps1-code');
  if (ps1Code) {
    if (token) {
      ps1Code.textContent = `$env:BRIDGE_TOKEN='${token}'; irm ${serverOrigin}/bridge.ps1 | iex`;
    } else {
      ps1Code.textContent = `irm ${serverOrigin}/bridge.ps1 | iex`;
    }
  }

  // 3. CMD: inject --token directly
  const cmdCode = $('bridge-command-code');
  if (cmdCode) {
    if (token) {
      cmdCode.textContent = `curl.exe -sO ${serverOrigin}/scripts/sanfa-bridge.mjs && node sanfa-bridge.mjs --server ${serverOrigin} --token ${token}`;
    } else {
      cmdCode.textContent = `curl.exe -sO ${serverOrigin}/scripts/sanfa-bridge.mjs && node sanfa-bridge.mjs --server ${serverOrigin}`;
    }
  }

  checkBridgeStatus();
}

function closeBridgeModal() {
  const modal = $('bridge-modal-overlay');
  if (modal) modal.style.display = 'none';
}

async function checkBridgeStatus() {
  try {
    const token = getAuthToken();
    if (!token) return;

    // Auto-start bridge in background if running inside Electron desktop app
    if (window.sanfaElectron?.syncBridge && !state.bridgeConnected && !window._electronBridgeAttempted) {
      window._electronBridgeAttempted = true;
      window.sanfaElectron.syncBridge({ serverUrl: location.origin, token });
      setTimeout(checkBridgeStatus, 2500);
    }

    const r = await apiFetch(`${API_BASE}/api/bridge/status`);
    if (!r.ok) return;
    const d = await r.json();

    state.bridgeConnected = !!d.connected;
    state.bridgeInfo = d.info || null;

    updateBridgeUI();
  } catch {}
}

function updateBridgeUI() {
  const pill = $('topbar-bridge-pill');
  const nameEl = $('topbar-bridge-name');
  const dotEl = $('topbar-bridge-dot');

  const card = $('bridge-status-card');
  const title = $('bridge-status-title');
  const desc = $('bridge-status-desc');
  const meta = $('bridge-connected-meta');
  const metaHost = $('bridge-meta-hostname');
  const metaPlat = $('bridge-meta-platform');
  const metaCwd = $('bridge-meta-cwd');

  if (state.bridgeConnected && state.bridgeInfo) {
    const host = state.bridgeInfo.hostname || 'Laptop';
    if (nameEl) nameEl.textContent = 'bridge:ok';
    pill?.classList.add('bridge-connected');
    if (pill) pill.style.display = 'none';
    if (dotEl) dotEl.style.display = 'none';

    card?.classList.add('connected');
    if (title) title.textContent = `Bridge Terhubung: ${host}`;
    if (desc) desc.textContent = 'Laptop lokal kamu terhubung aktif! Semua perintah terminal dan berkas di web ini akan dieksekusi langsung di komputermu.';
    if (meta) meta.style.display = 'flex';
    if (metaHost) metaHost.textContent = host;
    if (metaPlat) metaPlat.textContent = `${state.bridgeInfo.platform || 'Unknown'} (User: ${state.bridgeInfo.user || '-'})`;
    if (metaCwd) metaCwd.textContent = state.bridgeInfo.cwd || '-';

    // Settings Bridge tab UI
    $('settings-bridge-status-card')?.classList.add('connected');
    $('settings-bridge-dot')?.classList.add('connected');
    const sTitle = $('settings-bridge-title');
    if (sTitle) sTitle.textContent = `Bridge Terhubung: ${host}`;
    const sDesc = $('settings-bridge-desc');
    if (sDesc) sDesc.textContent = 'Laptop lokal kamu terhubung aktif dan siap menerima perintah!';
    const sMeta = $('settings-bridge-meta');
    if (sMeta) sMeta.style.display = 'block';
    const sHost = $('settings-bridge-hostname');
    if (sHost) sHost.textContent = host;
    const sPlat = $('settings-bridge-platform');
    if (sPlat) sPlat.textContent = `${state.bridgeInfo.platform || 'Windows'} (User: ${state.bridgeInfo.user || '-'})`;
  } else {
    if (nameEl) nameEl.textContent = 'Bridge';
    pill?.classList.remove('bridge-connected');
    if (pill) {
      pill.style.display = 'none';
      pill.title = 'Sanfa Bridge: Belum Terhubung';
    }
    if (dotEl) dotEl.style.display = 'none';

    card?.classList.remove('connected');
    if (title) title.textContent = 'Bridge Terputus (Offline)';
    if (desc) desc.textContent = 'Hubungkan laptop kamu agar AI bisa menjalankan perintah coding dan berkas langsung di komputermu.';
    if (meta) meta.style.display = 'none';

    // Settings Bridge tab UI
    $('settings-bridge-status-card')?.classList.remove('connected');
    $('settings-bridge-dot')?.classList.remove('connected');
    const sTitle = $('settings-bridge-title');
    if (sTitle) sTitle.textContent = 'Bridge Terputus';
    const sDesc = $('settings-bridge-desc');
    if (sDesc) sDesc.textContent = 'Hubungkan laptop untuk kontrol hardware & terminal.';
    const sMeta = $('settings-bridge-meta');
    if (sMeta) sMeta.style.display = 'none';
  }
}

// ── Persona & Roleplay Management ──────────────────────────────
let waParsedData = null;
let selectedWaParticipant = null;

function setupPersonaModal() {
  const pill = $('topbar-persona-pill');
  const modal = $('persona-modal-overlay');
  const closeBtn = $('persona-modal-close');
  const toggle = $('persona-roleplay-toggle');
  const tabList = $('tab-persona-list');
  const tabImport = $('tab-persona-import');

  pill?.addEventListener('click', () => {
    openPersonaModal();
  });

  closeBtn?.addEventListener('click', () => {
    closePersonaModal();
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closePersonaModal();
  });

  toggle?.addEventListener('change', async (e) => {
    await setRoleplayActive(e.target.checked);
  });

  tabList?.addEventListener('click', () => switchPersonaTab('list'));
  $('tab-persona-manual')?.addEventListener('click', () => switchPersonaTab('manual'));
  tabImport?.addEventListener('click', () => switchPersonaTab('import'));

  // Manual persona creation form
  const btnSaveManual = $('btn-save-manual-persona');
  btnSaveManual?.addEventListener('click', async () => {
    const nameInput = $('manual-persona-name');
    const descInput = $('manual-persona-desc');
    const name = (nameInput?.value || '').trim();
    const description = (descInput?.value || '').trim();

    if (!name) {
      alert('Silakan masukkan nama persona.');
      nameInput?.focus();
      return;
    }

    btnSaveManual.disabled = true;
    btnSaveManual.textContent = 'Menyimpan...';

    try {
      const r = await apiFetch(`${API_BASE}/api/personas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description })
      });
      const res = await r.json();
      if (!res.ok) {
        alert(res.error || 'Gagal menyimpan persona');
        return;
      }

      if (nameInput) nameInput.value = '';
      if (descInput) descInput.value = '';

      await loadPersonas();
      await selectPersona(res.persona.id);
      switchPersonaTab('list');
    } catch (err) {
      alert('Gagal menyimpan persona: ' + err.message);
    } finally {
      btnSaveManual.disabled = false;
      btnSaveManual.textContent = 'Simpan Persona';
    }
  });

  // WhatsApp file picker
  const btnSelect = $('btn-select-wa-file');
  const fileInput = $('wa-file-input');
  const dropZone = $('wa-upload-zone');

  btnSelect?.addEventListener('click', () => fileInput?.click());
  dropZone?.addEventListener('click', (e) => {
    if (e.target !== btnSelect) fileInput?.click();
  });

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleWaFile(e.target.files[0]);
    }
  });

  // Drag & drop
  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
      handleWaFile(e.dataTransfer.files[0]);
    }
  });

  // Confirm clone button
  $('btn-confirm-clone-wa')?.addEventListener('click', onConfirmCloneWa);
}

function openPersonaModal() {
  const modal = $('persona-modal-overlay');
  if (!modal) return;
  modal.style.display = 'flex';
  const toggle = $('persona-roleplay-toggle');
  if (toggle) toggle.checked = !!state.roleplayActive;
  switchPersonaTab('list');
  loadPersonas();
}

function closePersonaModal() {
  const modal = $('persona-modal-overlay');
  if (modal) modal.style.display = 'none';
}

function switchPersonaTab(tab) {
  const tabList = $('tab-persona-list');
  const tabManual = $('tab-persona-manual');
  const tabImport = $('tab-persona-import');
  const paneList = $('pane-persona-list');
  const paneManual = $('pane-persona-manual');
  const paneImport = $('pane-persona-import');

  tabList?.classList.toggle('active', tab === 'list');
  tabManual?.classList.toggle('active', tab === 'manual');
  tabImport?.classList.toggle('active', tab === 'import');

  if (paneList) paneList.style.display = tab === 'list' ? 'block' : 'none';
  if (paneManual) paneManual.style.display = tab === 'manual' ? 'block' : 'none';
  if (paneImport) paneImport.style.display = tab === 'import' ? 'block' : 'none';
}

async function loadPersonas() {
  try {
    const r = await apiFetch(`${API_BASE}/api/personas`);
    if (!r.ok) return;
    const data = await r.json();
    state.personas = Array.isArray(data) ? data : [];
    updatePersonaTopBar();
    renderPersonas();
  } catch (err) {
    console.error('Failed to load personas:', err);
  }
}

function updatePersonaTopBar() {
  const pill = $('topbar-persona-pill');
  const nameEl = $('topbar-persona-name');
  const dotEl = $('topbar-persona-dot');
  if (!pill) return;

  if (state.roleplayActive && state.activePersonaId) {
    const persona = state.personas.find(p => p.id === state.activePersonaId);
    const personaName = persona ? persona.name : 'Roleplay';

    if (nameEl) {
      nameEl.textContent = personaName;
      nameEl.style.display = 'inline-block';
    }
    pill.classList.add('roleplay-on');
    pill.title = `Mode Roleplay: ${personaName}`;
    if (dotEl) dotEl.style.display = 'none';
  } else {
    if (nameEl) {
      nameEl.textContent = '';
      nameEl.style.display = 'none';
    }
    pill.classList.remove('roleplay-on');
    pill.title = 'Persona & Mode Roleplay';
    if (dotEl) dotEl.style.display = 'none';
  }
}

function renderPersonas() {
  const container = $('persona-items-container');
  if (!container) return;
  container.innerHTML = '';

  if (state.personas.length === 0) {
    container.innerHTML = '<div style="font-size:12.5px;color:#8c7868;text-align:center;padding:32px 14px;line-height:1.6;">Belum ada persona tersimpan.<br><span style="font-size:11px;color:#6b5344;">Buat di tab <strong>Tulis Manual</strong> atau <strong>Import WA (.txt)</strong>.</span></div>';
    return;
  }

  state.personas.forEach(p => {
    const isActive = state.roleplayActive && p.id === state.activePersonaId;
    const card = document.createElement('div');
    card.className = 'persona-card-item' + (isActive ? ' active' : '');
    card.dataset.id = p.id;

    card.innerHTML = `
      <div class="persona-card-left">
        <div class="persona-card-avatar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <div class="persona-card-meta">
          <div class="persona-card-name-row">
            <span class="persona-card-name" title="${escAttr(p.name)}">${escHtml(p.name)}</span>
          </div>
          ${p.dialect ? `<div class="persona-card-dialect-row"><span class="persona-badge-tag">${escHtml(p.dialect)}</span></div>` : ''}
          <div class="persona-card-desc" title="${escAttr(p.description || '')}">${escHtml(p.description || 'Karakter roleplay')}</div>
        </div>
      </div>
      <div class="persona-card-actions">
        ${isActive ? `
          <svg class="persona-check-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ` : ''}
        <button class="btn-del-persona" title="Hapus persona ini">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;

    card.addEventListener('click', async (e) => {
      if (e.target.closest('.btn-del-persona')) return;
      await selectPersona(p.id);
    });

    const delBtn = card.querySelector('.btn-del-persona');
    delBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deletePersona(p.id, p.name);
    });

    container.appendChild(card);
  });
}

async function selectPersona(personaId) {
  state.activePersonaId = personaId;
  state.roleplayActive = true;
  const toggle = $('persona-roleplay-toggle');
  if (toggle) toggle.checked = true;

  updatePersonaTopBar();
  renderPersonas();

  // Persist to session on server
  try {
    await apiFetch(`${API_BASE}/api/personas/set-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.sessionId,
        roleplayActive: true,
        personaId: personaId
      })
    });
  } catch {}
}

async function setRoleplayActive(active) {
  state.roleplayActive = active;
  if (active && !state.activePersonaId && state.personas.length > 0) {
    state.activePersonaId = state.personas[0].id;
  }
  updatePersonaTopBar();
  renderPersonas();

  try {
    await apiFetch(`${API_BASE}/api/personas/set-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.sessionId,
        roleplayActive: active,
        personaId: state.activePersonaId || null
      })
    });
  } catch {}
}

async function deletePersona(personaId, personaName) {
  if (!confirm(`Hapus persona "${personaName}"?`)) return;
  try {
    const r = await apiFetch(`${API_BASE}/api/personas/${personaId}`, { method: 'DELETE' });
    if (r.ok) {
      if (state.activePersonaId === personaId) {
        state.activePersonaId = null;
        state.roleplayActive = false;
      }
      await loadPersonas();
    }
  } catch (err) {
    console.error('deletePersona error:', err);
  }
}

// WhatsApp File Upload & Parser
async function handleWaFile(file) {
  if (!file.name.toLowerCase().endsWith('.txt')) {
    alert('Harap pilih file teks WhatsApp berformat .txt');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    await parseWaContent(text, file.name);
  };
  reader.readAsText(file, 'utf-8');
}

async function parseWaContent(rawText, fileName) {
  const loading = $('wa-cloning-loading');
  const uploadZone = $('wa-upload-zone');
  const partSection = $('wa-participants-section');
  const partList = $('wa-participants-list');
  const cloneBtn = $('btn-confirm-clone-wa');

  if (loading) {
    loading.style.display = 'flex';
    const statusText = $('wa-cloning-status-text');
    if (statusText) statusText.textContent = 'Membaca riwayat percakapan WhatsApp...';
  }
  if (uploadZone) uploadZone.style.display = 'none';

  try {
    const r = await apiFetch(`${API_BASE}/api/personas/parse-wa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: rawText })
    });
    const data = await r.json();

    if (!data.ok || !data.participants || data.participants.length === 0) {
      alert(data.error || 'Tidak ditemukan pesan pengirim dalam format chat WhatsApp yang valid.');
      if (uploadZone) uploadZone.style.display = 'block';
      if (loading) loading.style.display = 'none';
      return;
    }

    waParsedData = { rawText, fileName, participants: data.participants };
    selectedWaParticipant = data.participants[0].name;

    if (partList) {
      partList.innerHTML = '';
      data.participants.forEach((p, idx) => {
        const chip = document.createElement('div');
        chip.className = 'wa-participant-chip' + (idx === 0 ? ' selected' : '');
        chip.innerHTML = `
          <span>👤</span>
          <span>${escHtml(p.name)}</span>
          <span class="wa-chip-count">${p.count} pesan</span>
        `;
        chip.addEventListener('click', () => {
          document.querySelectorAll('.wa-participant-chip').forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          selectedWaParticipant = p.name;
        });
        partList.appendChild(chip);
      });
    }

    if (loading) loading.style.display = 'none';
    if (partSection) partSection.style.display = 'block';
    if (cloneBtn) cloneBtn.disabled = false;

  } catch (err) {
    alert('Terjadi kesalahan saat memproses file: ' + err.message);
    if (uploadZone) uploadZone.style.display = 'block';
    if (loading) loading.style.display = 'none';
  }
}

async function onConfirmCloneWa() {
  if (!waParsedData || !selectedWaParticipant) return;

  const partSection = $('wa-participants-section');
  const loading = $('wa-cloning-loading');
  const cloneBtn = $('btn-confirm-clone-wa');

  if (partSection) partSection.style.display = 'none';
  if (loading) {
    loading.style.display = 'flex';
    const statusText = $('wa-cloning-status-text');
    if (statusText) statusText.textContent = `AI sedang menganalisis gaya bicara, ingatan, & relasi "${selectedWaParticipant}"...`;
  }

  try {
    const r = await apiFetch(`${API_BASE}/api/personas/clone-wa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: waParsedData.rawText,
        targetName: selectedWaParticipant
      })
    });
    const data = await r.json();

    if (!data.ok || !data.persona) {
      alert(data.error || 'Gagal membuat persona');
      if (partSection) partSection.style.display = 'block';
      if (loading) loading.style.display = 'none';
      return;
    }

    // Success! Load personas, select it, and switch to list tab
    await loadPersonas();
    await selectPersona(data.persona.id);
    switchPersonaTab('list');

    // Reset upload zone
    if (loading) loading.style.display = 'none';
    const uploadZone = $('wa-upload-zone');
    if (uploadZone) uploadZone.style.display = 'block';
    waParsedData = null;
    selectedWaParticipant = null;

  } catch (err) {
    alert('Gagal menghubungi AI untuk kloning: ' + err.message);
    if (partSection) partSection.style.display = 'block';
    if (loading) loading.style.display = 'none';
  }
}


// ── Profile Modal (👤 Nama User) ──────────────────────────────
function setupProfileModal() {
  const modal = $('profile-modal-overlay');
  const closeBtn = $('profile-modal-close');
  const logoutBtn = $('btn-logout-profile');

  function openProfile() {
    // Isi data user
    const u = state.currentUser;
    if (u) {
      const initials = (u.name || u.username || 'U').slice(0, 2).toUpperCase();
      const avatarEl = $('profile-user-avatar');
      const nameEl = $('profile-user-name');
      const roleEl = $('profile-user-role');
      if (avatarEl) avatarEl.textContent = initials;
      if (nameEl) nameEl.textContent = u.name || u.username;
      if (roleEl) roleEl.textContent = u.role === 'owner' ? 'Pemilik Sistem & Administrator Laptop' : 'Tamu Terverifikasi';
      const nickInput = $('input-user-nickname');
      if (nickInput) nickInput.value = u.nickname || '';
    }
    const token = getAuthToken() || (state.currentUser && state.currentUser.token) || '';
    const tokenEl = $('profile-bridge-token');
    if (tokenEl) tokenEl.textContent = token || '-';
    modal?.classList.add('active');
    loadAiPersona();
  }

  function closeProfile() {
    modal?.classList.remove('active');
  }

  // Open via nama user di sidebar
  $('btn-open-profile')?.addEventListener('click', openProfile);
  closeBtn?.addEventListener('click', closeProfile);
  logoutBtn?.addEventListener('click', logout);
  modal?.addEventListener('click', e => { if (e.target === modal) closeProfile(); });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal?.classList.contains('active')) closeProfile();
  });

  // Copy token
  $('btn-copy-profile-token')?.addEventListener('click', () => {
    const token = getAuthToken() || (state.currentUser && state.currentUser.token) || '';
    if (token) {
      navigator.clipboard.writeText(token).catch(() => {});
      const btn = $('btn-copy-profile-token');
      if (btn) { const p = btn.textContent; btn.textContent = '✓ Tersalin!'; setTimeout(() => btn.textContent = p, 1500); }
    }
  });

  // Persona preset selector
  const presetGrid = $('persona-preset-grid');
  if (presetGrid) {
    presetGrid.addEventListener('click', e => {
      const btn = e.target.closest('.persona-preset-btn');
      if (!btn) return;
      presetGrid.querySelectorAll('.persona-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  }

  // Save AI Persona
  $('btn-save-ai-persona')?.addEventListener('click', async () => {
    const activePreset = presetGrid?.querySelector('.persona-preset-btn.active');
    const preset = activePreset?.dataset.preset || 'santai';
    const user_bio = ($('input-user-bio')?.value || '').trim();
    const ai_instruction = ($('input-ai-instruction')?.value || '').trim();
    const statusEl = $('persona-status-msg');
    try {
      const r = await apiFetch(`${API_BASE}/api/user/ai-persona`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset, user_bio, ai_instruction })
      });
      const data = await r.json();
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = data.ok ? '#86efac' : '#f87171';
        statusEl.textContent = data.ok ? '✓ Persona AI berhasil disimpan!' : `Gagal: ${data.error || 'Error'}`;
        setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 2500);
      }
    } catch (e) {
      if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#f87171'; statusEl.textContent = `Gagal: ${e.message}`; }
    }
  });
}

async function loadAiPersona() {
  try {
    const r = await apiFetch(`${API_BASE}/api/user/ai-persona`);
    const data = await r.json();
    if (data.ok && data.ai_persona) {
      const { preset, user_bio, ai_instruction } = data.ai_persona;
      // Set preset button
      const presetGrid = $('persona-preset-grid');
      if (presetGrid && preset) {
        presetGrid.querySelectorAll('.persona-preset-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.preset === preset);
        });
      }
      const bioEl = $('input-user-bio');
      const instrEl = $('input-ai-instruction');
      if (bioEl) bioEl.value = user_bio || '';
      if (instrEl) instrEl.value = ai_instruction || '';
    }
  } catch {}
}

// ── Settings Modal (⚙️) ────────────────────────────────────────
function setupSettingsModal() {
  const modal = $('settings-modal-overlay');
  const closeBtn = $('settings-modal-close');
  const clearCurrentBtn = $('btn-clear-current-chat');
  const clearAllBtn = $('btn-clear-all-sessions');
  const refreshDevBtn = $('btn-refresh-devices');

  function openSettings(tabName) {
    const badge = $('settings-model-badge');
    if (badge) badge.textContent = state.model;
    modal?.classList.add('active');
    if (tabName) {
      // switch to specific tab
      const tabs = modal?.querySelectorAll('.settings-tab-btn');
      const panes = modal?.querySelectorAll('.settings-pane');
      tabs?.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
      panes?.forEach(p => p.classList.toggle('active', p.id === `settings-pane-${tabName}`));
      if (tabName === 'users') loadAdminUsers();
      if (tabName === 'devices') loadAdminDevices();
      if (tabName === 'bridge') syncSettingsBridgeStatus();
    }
  }

  function closeSettings() {
    modal?.classList.remove('active');
  }

  // Open via ⚙️ Settings button di sidebar
  $('btn-open-settings')?.addEventListener('click', () => openSettings('about'));
  closeBtn?.addEventListener('click', closeSettings);
  modal?.addEventListener('click', e => { if (e.target === modal) closeSettings(); });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal?.classList.contains('active')) closeSettings();
  });

  refreshDevBtn?.addEventListener('click', loadAdminDevices);

  clearCurrentBtn?.addEventListener('click', async () => {
    if (state.streaming) return;
    await deleteSession(state.sessionId);
    closeSettings();
  });
  clearAllBtn?.addEventListener('click', clearAllSessions);

  // Make openSettings accessible globally for bridge pill shortcut
  window._openSettingsModal = openSettings;
}

function syncSettingsBridgeStatus() {
  openBridgeModal();
}

// ── Manual Book Modal (📖 Buku Panduan Pengguna) ───────────────
function setupManualBookModal() {
  const modal = $('manual-book-modal-overlay');
  const openBtn = $('btn-open-manual-book');
  const closeBtn = $('manual-book-modal-close');

  function openManual(tab) {
    modal?.classList.add('active');
    if (tab) {
      const tabs = modal?.querySelectorAll('.manual-book-tab-btn');
      const panes = modal?.querySelectorAll('.manual-book-pane');
      tabs?.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
      panes?.forEach(p => p.classList.toggle('active', p.id === `manual-pane-${tab.replace('manual-', '')}`));
    }
  }

  function closeManual() {
    modal?.classList.remove('active');
  }

  openBtn?.addEventListener('click', () => openManual('manual-slash'));
  closeBtn?.addEventListener('click', closeManual);
  modal?.addEventListener('click', e => { if (e.target === modal) closeManual(); });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal?.classList.contains('active')) closeManual();
  });

  // Tab switching
  const tabs = modal?.querySelectorAll('.manual-book-tab-btn');
  tabs?.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const tabName = btn.dataset.tab.replace('manual-', '');
      modal?.querySelectorAll('.manual-book-pane').forEach(p => p.classList.remove('active'));
      const targetPane = $(`manual-pane-${tabName}`);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  window._openManualBook = openManual;
}


// ── Floating Remote Server Window (Khusus Owner) ────────────────
let serverDevOpsHistoryLoaded = false;
let serverChatBusy = false;

function setupRemoteServerWindow() {
  const btnToggle = $('btn-topbar-server');
  const win = $('server-floating-window');
  const btnClose = $('btn-close-server-win');
  const chatInput = $('server-chat-input');
  const btnSend = $('btn-send-server-chat');

  const btnSuhu = $('btn-quick-suhu');
  const btnRam = $('btn-quick-ram');
  const btnTunnel = $('btn-quick-tunnel');

  makeServerWindowDraggable();

  btnToggle?.addEventListener('click', () => {
    if (!win) return;
    const isHidden = win.style.display === 'none' || !win.style.display;
    win.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) {
      updateStatus();
      if (!serverDevOpsHistoryLoaded) {
        loadServerDevOpsHistory();
      }
      setTimeout(() => chatInput?.focus(), 100);
      scrollServerChatToBottom();
    }
  });

  btnClose?.addEventListener('click', () => {
    if (win) win.style.display = 'none';
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && win && win.style.display !== 'none') {
      win.style.display = 'none';
    }
  });

  const handleServerChatSend = () => {
    const text = (chatInput?.value || '').trim();
    if (!text) return;
    chatInput.value = '';
    if (text === '/clear') {
      const history = $('server-chat-history');
      if (history) history.innerHTML = '';
      return;
    }
    sendServerDevOpsChat(text);
  };

  btnSend?.addEventListener('click', handleServerChatSend);

  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleServerChatSend();
    }
  });

  btnSuhu?.addEventListener('click', () => {
    sendServerDevOpsChat('Cek suhu CPU, GPU, dan beban proses server saat ini');
  });

  btnRam?.addEventListener('click', () => {
    sendServerDevOpsChat('Cek penggunaan RAM server dan bersihkan cache proses jika ada yang boros');
  });

  btnTunnel?.addEventListener('click', () => {
    sendServerDevOpsChat('Cek status koneksi Cloudflare tunnel sanfaagent.my.id dan latensi jaringan');
  });
}

function makeServerWindowDraggable() {
  const win = $('server-floating-window');
  const header = $('server-window-header') || win?.querySelector('.server-window-header');
  if (!win || !header || win._isDraggableInitialized) return;
  win._isDraggableInitialized = true;

  let isDragging = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;

  header.style.cursor = 'grab';

  const onMouseDown = (e) => {
    if (e.target.closest('#btn-close-server-win') || e.target.closest('button')) return;
    isDragging = true;
    header.style.cursor = 'grabbing';

    const rect = win.getBoundingClientRect();
    win.style.bottom = 'auto';
    win.style.right = 'auto';
    win.style.left = `${rect.left}px`;
    win.style.top = `${rect.top}px`;

    startX = e.clientX;
    startY = e.clientY;
    initialLeft = rect.left;
    initialTop = rect.top;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  };

  const onMouseMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    // Viewport bounding
    const maxLeft = window.innerWidth - win.offsetWidth - 8;
    const maxTop = window.innerHeight - 40;
    newLeft = Math.max(8, Math.min(newLeft, maxLeft));
    newTop = Math.max(8, Math.min(newTop, maxTop));

    win.style.left = `${newLeft}px`;
    win.style.top = `${newTop}px`;
  };

  const onMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;
    header.style.cursor = 'grab';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  header.addEventListener('mousedown', onMouseDown);

  // Touch device support
  header.addEventListener('touchstart', (e) => {
    if (e.target.closest('#btn-close-server-win') || e.target.closest('button')) return;
    const touch = e.touches[0];
    const rect = win.getBoundingClientRect();
    win.style.bottom = 'auto';
    win.style.right = 'auto';
    win.style.left = `${rect.left}px`;
    win.style.top = `${rect.top}px`;
    startX = touch.clientX;
    startY = touch.clientY;
    initialLeft = rect.left;
    initialTop = rect.top;
    isDragging = true;
  }, { passive: true });

  header.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    let newLeft = Math.max(8, Math.min(initialLeft + dx, window.innerWidth - win.offsetWidth - 8));
    let newTop = Math.max(8, Math.min(initialTop + dy, window.innerHeight - 40));
    win.style.left = `${newLeft}px`;
    win.style.top = `${newTop}px`;
  }, { passive: true });

  header.addEventListener('touchend', () => { isDragging = false; });
}

function scrollServerChatToBottom() {
  const history = $('server-chat-history');
  if (history) {
    history.scrollTop = history.scrollHeight;
  }
}

async function loadServerDevOpsHistory() {
  try {
    const r = await apiFetch(`${API_BASE}/api/history?sessionId=session_server_devops`);
    if (!r.ok) return;
    const data = await r.json();
    serverDevOpsHistoryLoaded = true;
    const messages = data.messages || [];
    if (messages.length > 0) {
      const history = $('server-chat-history');
      if (!history) return;
      history.innerHTML = '';
      for (const m of messages) {
        if (m.role === 'user') {
          appendServerChatBubble('user', m.content);
        } else if (m.role === 'assistant') {
          appendServerChatBubble('bot', m.content);
        }
      }
      scrollServerChatToBottom();
    }
  } catch {}
}

function appendServerChatBubble(role, content) {
  const history = $('server-chat-history');
  if (!history) return null;

  const bubble = document.createElement('div');
  bubble.className = `server-chat-bubble server-chat-${role}`;
  if (role === 'bot') {
    bubble.innerHTML = `
      <div class="server-chat-avatar">S</div>
      <div class="server-chat-text">${typeof renderMarkdown === 'function' ? renderMarkdown(content) : escHtml(content)}</div>
    `;
  } else {
    bubble.innerHTML = `
      <div class="server-chat-text">${escHtml(content)}</div>
    `;
  }
  history.appendChild(bubble);
  scrollServerChatToBottom();
  return bubble;
}

async function sendServerDevOpsChat(userText) {
  if (serverChatBusy || !userText.trim()) return;
  serverChatBusy = true;

  const chatInput = $('server-chat-input');
  const btnSend = $('btn-send-server-chat');
  if (chatInput) chatInput.disabled = true;
  if (btnSend) btnSend.disabled = true;

  // Append user bubble
  appendServerChatBubble('user', userText);

  // Append bot placeholder
  const history = $('server-chat-history');
  const botBubble = document.createElement('div');
  botBubble.className = 'server-chat-bubble server-chat-bot';
  botBubble.innerHTML = `
    <div class="server-chat-avatar">S</div>
    <div class="server-chat-text"><span class="server-chat-typing">Mengecek server Asus...</span></div>
  `;
  history?.appendChild(botBubble);
  scrollServerChatToBottom();

  const textContainer = botBubble.querySelector('.server-chat-text');
  let fullText = '';

  try {
    const resp = await apiFetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userText,
        sessionId: 'session_server_devops',
        useDeepThinking: false
      })
    });

    if (!resp.ok) {
      let errMsg = `Server error (${resp.status})`;
      try {
        const errJson = await resp.json();
        if (errJson?.error) errMsg = errJson.error;
      } catch {}
      if (textContainer) textContainer.innerHTML = `<span style="color:#ef4444;">⚠ ${escHtml(errMsg)}</span>`;
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let currentEvent = 'message';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith('data: ')) {
          if (line.trim() === '') currentEvent = 'message';
          continue;
        }
        const raw = line.slice(6).trim();
        if (!raw) continue;

        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'text' && evt.content) {
            fullText += evt.content;
            if (textContainer) {
              textContainer.innerHTML = typeof renderMarkdown === 'function' ? renderMarkdown(fullText) : escHtml(fullText);
            }
            scrollServerChatToBottom();
          } else if (evt.type === 'tool_start') {
            if (textContainer) {
              const chip = document.createElement('div');
              chip.className = 'server-chat-tool-chip';
              chip.style.cssText = 'font-size:10px;font-family:var(--font-mono);color:#f7b06d;margin:4px 0;opacity:0.9;';
              chip.textContent = `⚡ Menjalankan: ${evt.name || 'tool'}...`;
              textContainer.appendChild(chip);
              scrollServerChatToBottom();
            }
          } else if (evt.type === 'error') {
            if (textContainer) {
              textContainer.innerHTML += `<div style="color:#ef4444;font-size:11px;margin-top:4px;">⚠ ${escHtml(evt.message || 'Error')}</div>`;
            }
          }
        } catch {}
        currentEvent = 'message';
      }
    }

    if (!fullText.trim() && textContainer) {
      textContainer.textContent = 'Perintah selesai diproses oleh server.';
    }
  } catch (err) {
    if (textContainer) {
      textContainer.innerHTML = `<span style="color:#ef4444;">⚠ Koneksi terputus: ${escHtml(err.message)}</span>`;
    }
  } finally {
    serverChatBusy = false;
    if (chatInput) {
      chatInput.disabled = false;
      chatInput.focus();
    }
    if (btnSend) btnSend.disabled = false;
    scrollServerChatToBottom();
  }
}

// ── Status polling & Dynamic Hardware View ──────────────────────
function startStatusPolling() {
  updateStatus();
  setInterval(updateStatus, 15000);
}

async function updateStatus() {
  try {
    const r = await apiFetch(`${API_BASE}/api/status`);
    const d = await r.json();
    if (d.type === 'status') {
      const isOwner = !!d.isOwner;
      const bridgeConnected = !!d.bridge?.connected;

      // 1. Owner Floating Window & Topbar Remote Server Button
      const btnServer = $('btn-topbar-server');
      const badgeAlert = $('badge-server-alert');
      const bannerAlert = $('server-alert-banner');
      const bannerAlertText = $('server-alert-banner-text');

      if (isOwner) {
        if (btnServer) btnServer.style.display = 'inline-flex';

        // Update server stats in floating window
        if (d.server) {
          const winTitle = $('server-window-title-text');
          if (winTitle) {
            winTitle.textContent = `Server Host (${d.server?.hostname || 'Redmi Note 9'})`;
          }
          const valTemp = $('val-server-temp');
          const subTemp = $('sub-server-temp');
          const cardTemp = $('card-server-temp');
          const valBat = $('val-server-bat');
          const subBat = $('sub-server-bat');
          const cardBat = $('card-server-bat');
          const valRam = $('val-server-ram');
          const subRam = $('sub-server-ram');
          const valUptime = $('val-server-uptime');
          const badgeOnline = $('label-server-badge');
          const updatedEl = $('server-stats-updated');

          const tempStr = (d.server.temp && !d.server.temp.includes('undefined')) ? d.server.temp : '38°C';
          if (valTemp) valTemp.textContent = tempStr;
          const tempNum = parseInt(tempStr) || 0;
          const isHot = tempNum > 75;

          if (subTemp) {
            subTemp.textContent = isHot ? 'Panas' : 'Aman';
            subTemp.className = isHot ? 'compact-metric-sub compact-sub-red' : 'compact-metric-sub';
          }
          if (cardTemp) {
            if (isHot) cardTemp.classList.add('server-card-alert');
            else cardTemp.classList.remove('server-card-alert');
          }

          const batStr = (d.server.battery && !d.server.battery.includes('undefined')) ? d.server.battery : 'Baterai';
          const isDischarging = batStr.toLowerCase().includes('discharging') || batStr.toLowerCase().includes('bat') || batStr.toLowerCase().includes('lepas');
          if (valBat) {
            if (batStr.includes('%')) {
              valBat.textContent = batStr.split(' ')[0];
            } else {
              valBat.textContent = isDischarging ? 'Baterai' : 'Dicas';
            }
          }
          if (subBat) {
            if (isDischarging) {
              subBat.textContent = 'Lepas Cas';
              subBat.className = 'compact-metric-sub compact-sub-red';
            } else {
              subBat.textContent = 'AC';
              subBat.className = 'compact-metric-sub compact-sub-green';
            }
          }
          if (cardBat) {
            if (isDischarging) cardBat.classList.add('server-card-alert');
            else cardBat.classList.remove('server-card-alert');
          }

          if (valRam) {
            const rawRam = (d.server.ram && !d.server.ram.includes('undefined')) ? d.server.ram : '2.1 / 3.8 GB';
            valRam.textContent = rawRam.replace(/\s+/g, '');
          }
          if (valUptime) valUptime.textContent = d.server.uptime || 'Online';

          // Check Critical Alerts (Temp > 75°C or Charger Disconnected)
          if (isDischarging || isHot) {
            badgeAlert?.classList.add('alert');
            btnServer?.classList.add('alert-glow');
            if (badgeOnline) {
              badgeOnline.textContent = isDischarging ? 'baterai' : 'panas';
              badgeOnline.classList.add('battery-mode');
            }
            if (bannerAlert) {
              bannerAlert.style.display = 'flex';
              if (bannerAlertText) {
                bannerAlertText.textContent = isDischarging
                  ? '⚠️ Charger server terlepas! Berjalan dengan baterai.'
                  : `⚠️ Suhu server tinggi (${tempStr})! Beban berat.`;
              }
            }
          } else {
            badgeAlert?.classList.remove('alert');
            btnServer?.classList.remove('alert-glow');
            if (badgeOnline) {
              badgeOnline.textContent = 'online';
              badgeOnline.classList.remove('battery-mode');
            }
            if (bannerAlert) bannerAlert.style.display = 'none';
          }
        }
      } else {
        // Guest user: hide server button and floating window entirely
        if (btnServer) btnServer.style.display = 'none';
        const win = $('server-floating-window');
        if (win) win.style.display = 'none';
      }

      // 2. Sidebar System Status Block (Natural specs display)
      const machName = $('status-machine-name');
      const machBadge = $('status-machine-badge');
      const rowRam = $('row-status-ram');
      const ramEl = $('status-ram');
      const rowTemp = $('row-status-temp');
      const tempEl = $('status-temp');
      const rowBat = $('row-status-bat');
      const batEl = $('status-bat');
      const rowServerOnly = $('row-status-server-only');

      if (isOwner) {
        const isWindowsHost = d.server?.platform === 'win32';
        if (bridgeConnected && d.bridge) {
          // When Local Bridge is ACTIVE: display connected Laptop hardware
          const host = d.bridge.hostname || 'Laptop Anda';
          if (machName) machName.textContent = host;
          if (machBadge) {
            machBadge.innerHTML = `<span class="badge-pulse-dot"></span>Local Bridge`;
            machBadge.className = 'status-val status-val-green';
            machBadge.title = 'Sanfa Bridge aktif. Menampilkan spesifikasi laptop lokal.';
          }
          if (rowRam) {
            rowRam.style.display = 'flex';
            const bridgeRamValid = d.bridge.ram && !d.bridge.ram.includes('undefined') && d.bridge.ram !== '— GB';
            if (ramEl) ramEl.textContent = bridgeRamValid ? d.bridge.ram : 'Menghubungkan...';
          }
          if (rowTemp) {
            const bridgeTempValid = d.bridge.temp && d.bridge.temp !== 'N/A' && !d.bridge.temp.includes('undefined');
            rowTemp.style.display = bridgeTempValid ? 'flex' : 'none';
            if (tempEl && bridgeTempValid) tempEl.textContent = d.bridge.temp;
          }
          if (rowBat) {
            rowBat.style.display = 'flex';
            const bridgeBatValid = d.bridge.battery && !d.bridge.battery.includes('undefined');
            if (batEl) batEl.textContent = bridgeBatValid ? d.bridge.battery : '—%';
          }
          if (rowServerOnly) rowServerOnly.style.display = 'none';
        } else if (isWindowsHost) {
          // Laptop IS the Host Server! Display Laptop's real specs directly
          const host = d.server.hostname || 'Laptop Asus';
          if (machName) machName.textContent = host;
          if (machBadge) {
            machBadge.innerHTML = `<span class="badge-pulse-dot"></span>Direct Host`;
            machBadge.className = 'status-val status-val-green';
            machBadge.title = 'Laptop berjalan langsung sebagai Server Host utama.';
          }
          if (rowRam) {
            rowRam.style.display = 'flex';
            if (ramEl) ramEl.textContent = d.server.ram || '— GB';
          }
          if (rowTemp) {
            rowTemp.style.display = 'flex';
            if (tempEl) tempEl.textContent = d.server.temp || '—°C';
          }
          if (rowBat) {
            rowBat.style.display = 'flex';
            if (batEl) batEl.textContent = d.server.battery || '—%';
          }
          if (rowServerOnly) rowServerOnly.style.display = 'none';
        } else {
          // Remote server (Termux) with Bridge OFF: display clean Server Online status
          if (machName) machName.textContent = 'Sanfa Server';
          if (machBadge) {
            machBadge.innerHTML = `<span class="badge-pulse-dot"></span>Online`;
            machBadge.className = 'status-val status-val-green';
            machBadge.title = 'Server Host aktif. Sanfa Bridge laptop belum terhubung.';
          }
          // Hide laptop hardware rows
          if (rowRam) rowRam.style.display = 'none';
          if (rowTemp) rowTemp.style.display = 'none';
          if (rowBat) rowBat.style.display = 'none';
          if (rowServerOnly) {
            rowServerOnly.style.display = 'flex';
            rowServerOnly.innerHTML = `<span>Server Host</span><span class="status-val status-val-green">🟢 Online</span>`;
          }
        }
      } else if (bridgeConnected && d.bridge) {
        // Guest user with active bridge on their local laptop
        if (machName) machName.textContent = d.bridge.hostname || 'Laptop Anda';
        if (machBadge) {
          machBadge.innerHTML = `<span class="badge-pulse-dot"></span>Local Bridge`;
          machBadge.className = 'status-val status-val-green';
          machBadge.title = 'Sanfa Bridge aktif. Klik untuk detail & tes ping.';
        }
        if (rowRam) {
          rowRam.style.display = 'flex';
          if (ramEl) ramEl.textContent = d.bridge.ram || '— GB';
        }
        if (rowTemp) {
          rowTemp.style.display = 'flex';
          if (tempEl) tempEl.textContent = (d.bridge.temp && d.bridge.temp !== 'N/A') ? d.bridge.temp : '46°C';
        }
        if (rowBat) {
          rowBat.style.display = 'flex';
          if (batEl) batEl.textContent = d.bridge.battery || '76% (Bat)';
        }
        if (rowServerOnly) rowServerOnly.style.display = 'none';
      } else {
        // Guest user without bridge (pure cloud mode)
        if (machName) machName.textContent = 'Sanfa Cloud';
        if (machBadge) {
          machBadge.innerHTML = `<span class="badge-pulse-dot" style="background:#a08870;box-shadow:none;animation:none;"></span>Online`;
          machBadge.className = 'status-val';
          machBadge.title = 'Terhubung ke server cloud. Buka aplikasi Sanfa di laptopmu untuk kontrol lokal.';
        }
        if (rowRam) rowRam.style.display = 'none';
        if (rowTemp) rowTemp.style.display = 'none';
        if (rowBat) rowBat.style.display = 'none';
        if (rowServerOnly) rowServerOnly.style.display = 'none';
      }

      // Hide topbar bridge indicator completely (status is now integrated into sidebar)
      const topPill = $('topbar-bridge-pill');
      if (topPill) topPill.style.display = 'none';
    }
  } catch {
    // Network or server starting up
  }
}

// ── Chat ──────────────────────────────────────────────
function clearChat() {
  apiFetch(`${API_BASE}/api/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId }),
  }).catch(() => {});
}

function getWelcomeStateHTML() {
  return `
    <div class="ambient ambient-one"></div>
    <div class="ambient ambient-two"></div>
    <div class="empty-state welcome-state">
      <div class="welcome-watermark" aria-hidden="true">
        <img src="icon.png" alt="" class="welcome-watermark-img" />
      </div>
      <h1 class="welcome-heading">Sanfa Agent</h1>
      <p class="welcome-copy">AI multi-model dengan 9Router. Ngobrol, coding, kontrol laptop — semua dari sini.</p>
      <div class="welcome-status"><span class="status-pulse"></span> Context Engine Ready <span class="status-divider"></span> Local Intelligence Online</div>
      <div class="empty-state-suggestions prompt-grid">
        <button type="button" class="suggestion-item prompt-card" onclick="document.getElementById('chat-input').value='Tolong carikan info terbaru di internet tentang ';document.getElementById('chat-input').focus();">
          <span class="prompt-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
          <span class="prompt-card-text"><strong>Cari info terbaru di web</strong><small>Ekstraksi data & riset online terkini</small></span>
          <svg class="prompt-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
        </button>
        <button type="button" class="suggestion-item prompt-card" onclick="document.getElementById('chat-input').value='Bikinin gambar pemandangan kota neon cyberpunk 16:9';document.getElementById('chat-input').focus();">
          <span class="prompt-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span>
          <span class="prompt-card-text"><strong>Generate gambar AI</strong><small>Google Imagen 3 studio visual</small></span>
          <svg class="prompt-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
        </button>
        <button type="button" class="suggestion-item prompt-card" onclick="document.getElementById('chat-input').value='Cek proses pemakan RAM dan status laptop sekarang';document.getElementById('chat-input').focus();">
          <span class="prompt-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span>
          <span class="prompt-card-text"><strong>Cek status laptop &amp; RAM</strong><small>Pantau hardware &amp; proses sistem</small></span>
          <svg class="prompt-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
        </button>
      </div>
    </div>`;
}

function renderEmptyState() {
  clearThinkingPanel();
  const msgs = $$('.chat-messages');
  if (msgs) {
    msgs.innerHTML = getWelcomeStateHTML();
  }
}

function removeEmptyState() {
  $$('.empty-state')?.remove();
}

function appendUserMessage(text, attachment = null) {
  removeEmptyState();
  const msgs = $$('.chat-messages');
  const row = document.createElement('div');
  row.className = 'message-row user';
  const bub = document.createElement('div');
  bub.className = 'message-bubble';

  if (attachment) {
    if (typeof attachment === 'string') {
      const imgEl = document.createElement('img');
      imgEl.src = attachment;
      imgEl.className = 'chat-image';
      imgEl.alt = 'Uploaded image';
      bub.appendChild(imgEl);
    } else if (attachment.type === 'image' && attachment.dataUrl) {
      const imgEl = document.createElement('img');
      imgEl.src = attachment.dataUrl;
      imgEl.className = 'chat-image';
      imgEl.alt = attachment.name || 'Uploaded image';
      bub.appendChild(imgEl);
    } else if (attachment.type === 'pdf') {
      const card = document.createElement('div');
      card.className = 'chat-file-card';
      card.innerHTML = `
        <div class="chat-file-card-icon pdf">📄</div>
        <div class="chat-file-card-meta">
          <div class="chat-file-card-name">${escHtml(attachment.name || 'Dokumen.pdf')}</div>
          <div class="chat-file-card-sub">${escHtml(formatFileSize(attachment.size || 0))} · Dokumen PDF</div>
        </div>
      `;
      bub.appendChild(card);
    } else if (attachment.type === 'file') {
      const icon = attachment.category === 'code' ? '💻' : (attachment.category === 'data' ? '📊' : '📝');
      const card = document.createElement('div');
      card.className = 'chat-file-card';
      card.innerHTML = `
        <div class="chat-file-card-icon ${escHtml(attachment.category || 'text')}">${icon}</div>
        <div class="chat-file-card-meta">
          <div class="chat-file-card-name">${escHtml(attachment.name || 'Berkas')}</div>
          <div class="chat-file-card-sub">${escHtml(formatFileSize(attachment.size || 0))} · Berkas ${(attachment.ext || 'TEXT').toUpperCase()}</div>
        </div>
      `;
      bub.appendChild(card);
    }
  }

  if (text) {
    const textNode = document.createElement('div');
    textNode.textContent = text;
    bub.appendChild(textNode);
  }

  const count = msgs.querySelectorAll('.message-row:not(.thinking-panel-row):not(.action-preview-row):not(.tool-pending-row)').length;
  row.setAttribute('data-msg-index', count);

  const wrap = document.createElement('div');
  wrap.className = 'message-bubble-wrap';
  wrap.appendChild(bub);

  if (text) {
    wrap.appendChild(createMessageActions('user', text, row));
  }

  row.appendChild(wrap);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Organic Robot Thinking Engine (Unpredictable Glances & Pauses) ──
function startRobotThinkingAnimation(widget) {
  const faceEl = widget?.querySelector('.kaomoji-robot-face');
  if (!faceEl) return;

  // Realistic mechanical & intellectual gaze positions (No flipping!)
  const GLANCE_POSES = [
    'translate(0, 0)',                         // Focus center
    'translate(-4px, -1px)',                   // Pondering left / memory recall
    'translate(4px, 0px)',                     // Scanning right / evaluating data
    'translate(-3px, 0px) rotate(-1.8deg)',    // Head-tilt left (deliberating)
    'translate(2.5px, -1px) rotate(1.5deg)',   // Head-tilt right (curious / analytical)
    'scale(1.04) translate(0, -0.5px)',        // Micro-focus (target locked / idea found)
    'translate(0, 0)',                         // Recenter focus
    'translate(-2px, 0.5px)',                  // Subtle glance down-left
  ];

  let currentPose = 'translate(0, 0)';

  function scheduleNextGlance() {
    if (!widget || !document.body.contains(widget)) return;

    // Pick a new random pose different from current
    let nextPose = GLANCE_POSES[Math.floor(Math.random() * GLANCE_POSES.length)];
    if (nextPose === currentPose) {
      nextPose = 'translate(0, 0)';
    }
    currentPose = nextPose;
    faceEl.style.transform = currentPose;

    // Organic random dwell time: between 750ms and 2200ms
    // Humans and robots don't shift gaze on a rigid 1-second loop
    const randomInterval = Math.floor(Math.random() * 1450) + 750;
    widget._glanceTimer = setTimeout(scheduleNextGlance, randomInterval);
  }

  // Initial organic pause before first glance
  widget._glanceTimer = setTimeout(scheduleNextGlance, 650);
}

// ── Progressive Cognitive States (Evolving Expression & Thinking Verbs) ──
const COGNITIVE_PHASES = [
  // Phase 1: Observing & analyzing input (0s ~ 1.1s)
  {
    afterMs: 0,
    faces: ['(⊙_⊙)', '(¬_¬)'],
    verbs: ['analyzing', 'reflecting', 'reading']
  },
  // Phase 2: Deliberating & Deep Reasoning (~ 1.1s ~ 2.4s)
  {
    afterMs: 1100,
    faces: ['( •_•)>⌐■-■', '(◔_◔)'],
    verbs: ['deliberating', 'pondering', 'contemplating', 'reasoning']
  },
  // Phase 3: Synthesizing & Formulating Solution (~ 2.4s ~ 4.2s)
  {
    afterMs: 2400,
    faces: ['( •_•)>⌐■-■', '(•_•)'],
    verbs: ['synthesizing', 'formulating', 'computing', 'processing']
  },
  // Phase 4: Extended Complex Inference (> 4.2s - stays in deep reasoning, glasses off)
  {
    afterMs: 4200,
    faces: ['( •_•)>⌐■-■', '(◔_◔)', '( •_•)'],
    verbs: ['deliberating', 'reasoning', 'pondering', 'cogitating']
  }
];

function setWidgetKaomoji(widget, face, verb) {
  if (!widget) return;
  if (face) {
    const faceEl = widget.querySelector('.kaomoji-robot-face');
    if (faceEl && faceEl.textContent !== face) {
      faceEl.textContent = face;
    }
  }
  if (verb) {
    const verbEl = widget.querySelector('.kaomoji-verb');
    if (verbEl) {
      verbEl.textContent = verb.endsWith('...') ? verb : `${verb}...`;
    }
  }
}

function startRobotCognitiveProgression(widget) {
  if (!widget) return;
  widget._phaseTimers = [];

  COGNITIVE_PHASES.forEach((p, idx) => {
    if (idx === 0) {
      const f = p.faces[Math.floor(Math.random() * p.faces.length)];
      const v = p.verbs[Math.floor(Math.random() * p.verbs.length)];
      setWidgetKaomoji(widget, f, v);
    } else {
      const timer = setTimeout(() => {
        if (!document.body.contains(widget)) return;
        const f = p.faces[Math.floor(Math.random() * p.faces.length)];
        const v = p.verbs[Math.floor(Math.random() * p.verbs.length)];
        setWidgetKaomoji(widget, f, v);
      }, p.afterMs);
      widget._phaseTimers.push(timer);
    }
  });

  widget._lateCycleTimer = setInterval(() => {
    if (!document.body.contains(widget)) return;
    const latePhase = COGNITIVE_PHASES[COGNITIVE_PHASES.length - 1];
    const f = latePhase.faces[Math.floor(Math.random() * latePhase.faces.length)];
    const v = latePhase.verbs[Math.floor(Math.random() * latePhase.verbs.length)];
    setWidgetKaomoji(widget, f, v);
  }, 2200);
}

function stopRobotCognitiveProgression(widget) {
  if (!widget) return;
  if (widget._phaseTimers) {
    widget._phaseTimers.forEach(t => clearTimeout(t));
    widget._phaseTimers = [];
  }
  if (widget._lateCycleTimer) {
    clearInterval(widget._lateCycleTimer);
    widget._lateCycleTimer = null;
  }
}

function stopRobotThinkingAnimation(widget) {
  if (!widget) return;
  if (widget._glanceTimer) {
    clearTimeout(widget._glanceTimer);
    widget._glanceTimer = null;
  }
  stopRobotCognitiveProgression(widget);
}

function removeTyping(parent) {
  const w = parent?.querySelector('.hermes-thinking-widget') || parent?.querySelector('.typing-indicator');
  if (w) {
    stopRobotThinkingAnimation(w);
    if (w._liveTimer) clearInterval(w._liveTimer);
    if (w._kaomojiTimer) clearInterval(w._kaomojiTimer);
    w.remove();
  }
}

function createAgentRow(showTyping) {
  removeEmptyState();
  const msgs = $$('.chat-messages');
  const count = msgs.querySelectorAll('.message-row:not(.thinking-panel-row):not(.action-preview-row):not(.tool-pending-row)').length;
  const row = document.createElement('div');
  row.className = 'message-row agent';
  row.setAttribute('data-msg-index', count);
  const wrap = document.createElement('div');
  wrap.className = 'message-bubble-wrap';
  const bub = document.createElement('div');
  bub.className = 'message-bubble';

  if (showTyping) {
    const initFace = Math.random() > 0.5 ? '(⊙_⊙)' : '(¬_¬)';
    bub.innerHTML = `<div class="hermes-thinking-widget">
      <span class="kaomoji-robot-face">${initFace}</span>
      <span class="kaomoji-verb">analyzing...</span>
      <span class="kaomoji-cursor">▋</span>
      <button class="btn-stop-bubble" title="Hentikan pembuatan respon (Stop)" type="button">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
        <span>Stop</span>
      </button>
    </div>`;

    const widget = bub.querySelector('.hermes-thinking-widget');
    const stopBubbleBtn = bub.querySelector('.btn-stop-bubble');
    stopBubbleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      stopGenerating();
    });

    if (widget) {
      startRobotThinkingAnimation(widget);
      startRobotCognitiveProgression(widget);
    }
  }


  wrap.appendChild(bub);
  row.appendChild(wrap);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
  return bub;
}

// Streaming text writer
function createStreamWriter(bubble) {
  let rawText = '';
  let cursorEl = null;

  function ensureCursor() {
    if (!cursorEl) {
      cursorEl = document.createElement('span');
      cursorEl.className = 'stream-cursor';
      cursorEl.textContent = '▋';
      bubble.appendChild(cursorEl);
    }
  }

  function removeCursor() {
    cursorEl?.remove();
    cursorEl = null;
  }

  function flush() {
    removeCursor();
    if (rawText.trim()) {
      bubble.innerHTML = renderMarkdown(rawText.trim());
      bubble.querySelectorAll('.btn-copy').forEach(setupCopyBtn);
      initArtifactsAndDiagrams(bubble);
      attachAgentMessageActions(bubble, rawText.trim());
    }
  }

  return {
    append(text) {
      rawText += text;
      // Clear typing indicator if present
      removeTyping(bubble);
      finalizeReasoningMeta(bubble, currentTurnReasoningMeta);
      ensureCursor();
      // Simple incremental render (re-render every chunk)
      removeCursor();
      bubble.innerHTML = renderMarkdown(rawText.trim());
      bubble.querySelectorAll('.btn-copy').forEach(setupCopyBtn);
      ensureCursor();
      $$('.chat-messages').scrollTop = $$('.chat-messages').scrollHeight;
    },
    finish() {
      flush();
      finalizeReasoningMeta(bubble, currentTurnReasoningMeta);
      $$('.chat-messages').scrollTop = $$('.chat-messages').scrollHeight;
    },
    raw() { return rawText; },
    bubble,
  };
}

function appendAgentMessage(markdown, typing = true) {
  if (!typing) {
    const bub = createAgentRow(false);
    bub.innerHTML = renderMarkdown(markdown);
    bub.querySelectorAll('.btn-copy').forEach(setupCopyBtn);
    initArtifactsAndDiagrams(bub);
    attachAgentMessageActions(bub, markdown);
    $$('.chat-messages').scrollTop = $$('.chat-messages').scrollHeight;
    return;
  }
  const bub = createAgentRow(true);
  // Remove typing after short delay and render
  setTimeout(() => {
    bub.innerHTML = renderMarkdown(markdown);
    bub.querySelectorAll('.btn-copy').forEach(setupCopyBtn);
    initArtifactsAndDiagrams(bub);
    attachAgentMessageActions(bub, markdown);
    $$('.chat-messages').scrollTop = $$('.chat-messages').scrollHeight;
  }, 400);
}

// ── Tool execution indicator ────────────────────────────
function appendToolPending(toolName) {
  removeToolPending();
  const msgs = $$('.chat-messages');
  const row = document.createElement('div');
  row.className = 'message-row agent tool-pending-row';
  const bub = document.createElement('div');

  if (toolName === 'search_web') {
    bub.className = 'message-bubble search-pending-bubble';
    bub.innerHTML = `<div class="chatgpt-search-pill searching">
      <span class="chatgpt-search-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
      <span class="chatgpt-search-text">Mencari informasi di web</span>
      <span class="chatgpt-search-dots"><span>.</span><span>.</span><span>.</span></span>
    </div>`;
  } else if (toolName === 'read_url') {
    bub.className = 'message-bubble search-pending-bubble';
    bub.innerHTML = `<div class="chatgpt-search-pill searching read-url-pill">
      <span class="chatgpt-search-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>
      <span class="chatgpt-search-text">Membuka tautan web</span>
      <span class="chatgpt-search-dots"><span>.</span><span>.</span><span>.</span></span>
    </div>`;
  } else {
    bub.className = 'message-bubble';
    bub.innerHTML = `<div class="hermes-thinking-widget tool-executing">
      <span class="kaomoji-robot-face">(⌐■_■)</span>
      <span class="kaomoji-verb">${escHtml(getToolVerb(toolName))}...</span>
      <span class="kaomoji-cursor">▋</span>
    </div>`;
  }
  row.appendChild(bub);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Thinking Panel (Reasoning Chain Visualization) ────────
let thinkingPanelRow = null;
let currentTurnReasoningMeta = '';

function finalizeReasoningMeta(bubble, metaText) {
  if (thinkingPanelRow) {
    thinkingPanelRow.remove();
    thinkingPanelRow = null;
  }
  let text = metaText || currentTurnReasoningMeta;
  if (!text || !text.trim()) {
    text = `Processing with ${state.model || 'Sanfa Agent'}...`;
  }
  const wrap = bubble.closest('.message-bubble-wrap') || bubble.parentElement;
  if (!wrap) return;
  if (wrap.querySelector('.agent-reasoning-meta')) return;

  const metaEl = document.createElement('div');
  metaEl.className = 'agent-reasoning-meta';
  metaEl.innerHTML = `<span class="reasoning-meta-text">${escHtml(text)}</span>`;
  wrap.insertBefore(metaEl, bubble);
}

function updateThinkingPanel(evt) {
  const msgs = $$('.chat-messages');
  if (!msgs) return;

  // Capture model/token detail for the finished minimal header
  if (evt.detail) {
    if (evt.step === 'reasoning' || evt.detail.includes('Processing with') || evt.detail.includes('Context:')) {
      currentTurnReasoningMeta = evt.detail;
    } else if (!currentTurnReasoningMeta) {
      currentTurnReasoningMeta = evt.detail;
    }
  }
  
  // Create panel if not exists
  if (!thinkingPanelRow) {
    thinkingPanelRow = document.createElement('div');
    thinkingPanelRow.className = 'message-row agent thinking-panel-row';
    const bub = document.createElement('div');
    bub.className = 'message-bubble';
    bub.style.padding = '0';
    bub.style.background = 'transparent';
    bub.style.border = 'none';
    
    bub.innerHTML = `<div class="thinking-panel">
      <div class="thinking-panel-header" title="Klik untuk sembunyikan/tampilkan penalaran">
        <span class="thinking-panel-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
            <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
            <path d="M12 5v14"/>
          </svg>
        </span>
        <span class="thinking-panel-title">Agent Reasoning</span>
        <span class="thinking-panel-toggle">▾</span>
      </div>
      <div class="thinking-panel-body"></div>
    </div>`;
    
    thinkingPanelRow.appendChild(bub);
    
    // Position Agent Reasoning BELOW the active thinking widget row
    const activeWidget = msgs.querySelector('.hermes-thinking-widget');
    const activeRow = activeWidget ? activeWidget.closest('.message-row') : null;
    if (activeRow && activeRow.parentNode === msgs) {
      if (activeRow.nextSibling) {
        msgs.insertBefore(thinkingPanelRow, activeRow.nextSibling);
      } else {
        msgs.appendChild(thinkingPanelRow);
      }
    } else {
      msgs.appendChild(thinkingPanelRow);
    }
    
    // Toggle collapse on clicking the header
    const panelHeader = bub.querySelector('.thinking-panel-header');
    const toggleBtn = bub.querySelector('.thinking-panel-toggle');
    const panelBody = bub.querySelector('.thinking-panel-body');
    panelHeader?.addEventListener('click', () => {
      const isCollapsed = panelBody.style.display === 'none';
      panelBody.style.display = isCollapsed ? 'flex' : 'none';
      if (toggleBtn) toggleBtn.textContent = isCollapsed ? '▾' : '▸';
    });
  } else {
    // Keep thinkingPanelRow below the active thinking widget if present
    const activeWidget = msgs.querySelector('.hermes-thinking-widget');
    const activeRow = activeWidget ? activeWidget.closest('.message-row') : null;
    if (activeRow && activeRow.parentNode === msgs && activeRow.nextSibling !== thinkingPanelRow) {
      if (activeRow.nextSibling) {
        msgs.insertBefore(thinkingPanelRow, activeRow.nextSibling);
      } else {
        msgs.appendChild(thinkingPanelRow);
      }
    }
  }
  
  const panelBody = thinkingPanelRow.querySelector('.thinking-panel-body');
  if (!panelBody) return;
  
  // Check if step already exists
  let stepEl = panelBody.querySelector(`[data-step="${evt.step}"]`);
  const isNew = !stepEl;
  
  if (!stepEl) {
    stepEl = document.createElement('div');
    stepEl.className = 'thinking-step';
    stepEl.setAttribute('data-step', evt.step);
    panelBody.appendChild(stepEl);
  }
  
  // Update step status
  const statusIcon = evt.status === 'completed' ? '✓' : evt.status === 'active' ? '→' : '·';
  const statusClass = evt.status === 'completed' ? 'completed' : evt.status === 'active' ? 'active' : 'pending';
  
  stepEl.className = `thinking-step ${statusClass}`;
  stepEl.innerHTML = `
    <span class="thinking-step-icon">${statusIcon}</span>
    <div class="thinking-step-content">
      <span class="thinking-step-title">${escHtml(evt.title || evt.step)}:</span>
      ${evt.detail ? `<span class="thinking-step-detail">${escHtml(evt.detail)}</span>` : ''}
    </div>
  `;
  
  msgs.scrollTop = msgs.scrollHeight;
}


function clearThinkingPanel() {
  if (thinkingPanelRow) {
    thinkingPanelRow.remove();
    thinkingPanelRow = null;
  }
  currentTurnReasoningMeta = '';
}

// ── Action Preview Card (Pre-Execution Confirmation) ──────
// ── Action Preview Card (Pre-Execution Confirmation) ──────
function appendActionPreviewCard(evt) {
  // Suppress action preview card completely when approval_required handles it
  if (!evt || evt.risk_level === 'low' || evt.tool === 'search_web' || evt.requires_approval) {
    return;
  }
  removeEmptyState();
  const msgs = $$('.chat-messages');
  const row = document.createElement('div');
  row.className = 'message-row agent action-preview-row';
  const bub = document.createElement('div');
  bub.className = 'message-bubble';
  bub.style.padding = '0';
  
  const riskColors = {
    low: '#7ab87a',
    medium: '#f0c674',
    high: '#f0906f',
    critical: '#f08282'
  };
  
  const riskColor = riskColors[evt.risk_level] || '#f0c674';
  const riskLabel = (evt.risk_level || 'medium').toUpperCase();
  
  bub.innerHTML = `<div class="action-preview-card" data-risk="${escAttr(evt.risk_level || 'medium')}">
    <div class="action-preview-header">
      <div class="action-preview-left">
        <span class="action-preview-badge" style="background: ${riskColor}20; color: ${riskColor}; border-color: ${riskColor}40;">
          ${evt.risk_level === 'critical' ? '🔴' : evt.risk_level === 'high' ? '⚠️' : evt.risk_level === 'low' ? '✓' : '●'} ${riskLabel} RISK
        </span>
        <span class="action-preview-tool">${escHtml(evt.tool)}</span>
      </div>
    </div>
    <div class="action-preview-body">
      <div class="action-preview-description">${escHtml(evt.description || 'Executing action...')}</div>
      ${evt.args && Object.keys(evt.args).length > 0 ? `
        <div class="action-preview-params">
          <div class="action-preview-params-title">Parameters:</div>
          <pre class="action-preview-params-code">${escHtml(JSON.stringify(evt.args, null, 2))}</pre>
        </div>
      ` : ''}
    </div>
  </div>`;
  
  row.appendChild(bub);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Approval Card (Minimalist Modern Design) ──────────────────
function markApprovalResolved(card, toolName, status, label) {
  if (!card) return;
  card.className = `approval-card resolved ${status}`;
  let iconSvg = '';
  if (status === 'approved') {
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7ab87a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
  } else if (status === 'rejected') {
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f08282" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  } else {
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f0c674" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  }
  const badgeText = status === 'approved' ? 'Diizinkan' : status === 'rejected' ? 'Ditolak' : 'Timeout';
  card.innerHTML = `
    <div class="approval-resolved-inner">
      <div class="approval-resolved-left">
        ${iconSvg}
        <span class="approval-resolved-tool">${escHtml(toolName || 'command')}</span>
        <span class="approval-resolved-text">${escHtml(label)}</span>
      </div>
      <span class="approval-resolved-badge ${status}">${badgeText}</span>
    </div>
  `;
}

function appendApprovalCard(evt) {
  removeEmptyState();
  const msgs = $$('.chat-messages');
  const row = document.createElement('div');
  row.className = 'message-row agent approval-card-row';
  row.setAttribute('data-approval-id', evt.approval_id);
  const bub = document.createElement('div');
  bub.className = 'message-bubble';
  bub.style.padding = '0';
  
  const toolName = evt.tool || 'run_command';
  let snippet = '';
  if (evt.args && typeof evt.args === 'object') {
    if (evt.args.command) {
      snippet = evt.args.command;
    } else if (evt.args.path || evt.args.file) {
      snippet = evt.args.path || evt.args.file;
    } else if (evt.args.query || evt.args.q) {
      snippet = evt.args.query || evt.args.q;
    } else if (evt.args.action) {
      snippet = `${evt.args.action} ${evt.args.app || evt.args.text || ''}`.trim();
    }
  }
  if (!snippet) {
    snippet = evt.description || toolName;
  }

  const hasParams = evt.args && Object.keys(evt.args).length > 0;

  bub.innerHTML = `
    <div class="approval-card" data-approval-id="${escAttr(evt.approval_id)}" data-tool="${escAttr(toolName)}">
      <div class="approval-header">
        <div class="approval-header-left">
          <span class="approval-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </span>
          <span class="approval-title">Izin Eksekusi</span>
          <code class="approval-tool-badge">${escHtml(toolName)}</code>
        </div>
        <div class="approval-countdown-badge" title="Sisa batas waktu">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span class="approval-countdown">${evt.timeout_seconds || 30}</span>s
        </div>
      </div>

      <div class="approval-body">
        <div class="approval-code-box">
          <code>${escHtml(snippet)}</code>
        </div>

        ${hasParams ? `
          <details class="approval-params-details">
            <summary>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <span>Parameter Lengkap</span>
            </summary>
            <pre>${escHtml(JSON.stringify(evt.args, null, 2))}</pre>
          </details>
        ` : ''}

        <div class="approval-actions">
          <button class="approval-btn reject" data-approval-id="${escAttr(evt.approval_id)}" title="Batalkan tindakan">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            <span>Tolak</span>
          </button>
          <button class="approval-btn approve" data-approval-id="${escAttr(evt.approval_id)}" title="Setujui dan jalankan tindakan">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Izinkan</span>
          </button>
        </div>
      </div>
    </div>
  `;
  
  row.appendChild(bub);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
  
  // Setup button handlers
  const approveBtn = bub.querySelector('.approval-btn.approve');
  const rejectBtn = bub.querySelector('.approval-btn.reject');
  
  approveBtn?.addEventListener('click', () => sendApprovalDecision(evt.approval_id, 'approved', row, toolName));
  rejectBtn?.addEventListener('click', () => sendApprovalDecision(evt.approval_id, 'rejected', row, toolName));
  
  // Countdown timer
  startApprovalCountdown(bub, evt.timeout_seconds || 30, evt.approval_id, row, toolName);
}

function startApprovalCountdown(bubbleEl, seconds, approvalId, rowEl, toolName) {
  const countdownEl = bubbleEl.querySelector('.approval-countdown');
  let remaining = seconds;
  
  const timer = setInterval(() => {
    remaining--;
    if (countdownEl) countdownEl.textContent = remaining;
    
    if (remaining <= 0) {
      clearInterval(timer);
      const card = bubbleEl.querySelector('.approval-card');
      markApprovalResolved(card, toolName, 'timeout', 'Waktu konfirmasi habis (dibatalkan)');
    }
  }, 1000);
  
  // Store timer so we can clear it on decision
  rowEl._countdownTimer = timer;
}

async function sendApprovalDecision(approvalId, decision, rowEl, toolName) {
  // Clear countdown timer
  if (rowEl._countdownTimer) {
    clearInterval(rowEl._countdownTimer);
  }
  
  const card = rowEl.querySelector('.approval-card');
  if (decision === 'approved') {
    markApprovalResolved(card, toolName, 'approved', 'Perintah diizinkan, mengeksekusi...');
  } else {
    markApprovalResolved(card, toolName, 'rejected', 'Perintah dibatalkan oleh pengguna');
  }
  
  try {
    const res = await apiFetch(`${API_BASE}/api/approval/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approval_id: approvalId, decision })
    });
    
    const data = await res.json();
    if (!data.ok) {
      console.error('Approval response failed:', data.error);
    }
  } catch (err) {
    console.error('Failed to send approval decision:', err);
  }
}

function removeToolPending() {
  const el = $$('.tool-pending-row');
  if (el) {
    const widget = el.querySelector('.hermes-thinking-widget');
    if (widget) stopRobotThinkingAnimation(widget);
    el.remove();
  }
}

// ── Tool card builders ─────────────────────────────────
function appendToolCard(result) {
  removeEmptyState();
  const msgs = $$('.chat-messages');
  const row = document.createElement('div');
  row.className = 'message-row agent';
  const bub = document.createElement('div');
  bub.className = 'message-bubble';
  bub.style.padding = '0';
  bub.style.background = 'transparent';
  bub.style.border = 'none';

  let card = '';
  switch (result.type) {
    case 'nickname_updated': {
      card = `<div class="action-card open">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge" style="color:#a78bfa;background:rgba(167,139,250,0.12);border-color:rgba(167,139,250,0.3)">profile</span>
            <span class="action-card-title">Nama Panggilan Diubah: "${escHtml(result.nickname)}"</span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill ok">✓ saved</span>
          </div>
        </div>
        <div class="action-card-body" style="padding:10px 14px;font-size:12px;color:var(--text-muted);">
          ${escHtml(result.message || 'Nama panggilan berhasil diperbarui.')}
        </div>
      </div>`;
      if (state.currentUser) state.currentUser.nickname = result.nickname;
      const nickInput = $('input-user-nickname');
      if (nickInput) nickInput.value = result.nickname;
      break;
    }

    case 'search': {
      const q = result.query || '';
      const count = result.count || (result.results ? result.results.length : 0);
      const items = result.results || [];
      const itemRows = items.map((it, idx) => {
        let domain = '';
        try {
          if (it.link) {
            domain = new URL(it.link).hostname.replace(/^www\./, '');
          }
        } catch {}
        return `
        <div class="chatgpt-search-item">
          <a href="${escAttr(it.link || '#')}" target="_blank" rel="noopener noreferrer" class="chatgpt-search-item-link">
            <span class="chatgpt-search-item-num">${idx + 1}</span>
            <div class="chatgpt-search-item-info">
              <span class="chatgpt-search-item-title">${escHtml(it.title)}</span>
              ${domain ? `<span class="chatgpt-search-item-domain">${escHtml(domain)}</span>` : ''}
            </div>
          </a>
          ${it.snippet ? `<div class="chatgpt-search-item-snippet">${escHtml(it.snippet)}</div>` : ''}
        </div>
      `}).join('');

      card = `<div class="chatgpt-search-card">
        <div class="chatgpt-search-pill done" onclick="this.closest('.chatgpt-search-card').classList.toggle('open')" title="Klik untuk lihat sumber web">
          <span class="chatgpt-search-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
          <span class="chatgpt-search-text">Mencari di ${count} situs web</span>
          <span class="chatgpt-search-arrow"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
        </div>
        <div class="chatgpt-search-drawer">
          <div class="chatgpt-search-drawer-header">
            <span class="chatgpt-search-kw">Kata Kunci: "${escHtml(q)}"</span>
            <span class="chatgpt-search-count-badge">${count} Sumber Ditemukan</span>
          </div>
          <div class="chatgpt-search-items">
            ${items.length > 0 ? itemRows : '<div class="chatgpt-search-empty">Tidak ada cuplikan web.</div>'}
          </div>
        </div>
      </div>`;
      break;
    }

    case 'read_url': {
      const url = result.url || '';
      let domain = '';
      try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {}
      const title = result.title || domain || 'Halaman Web';
      const len = result.length || 0;
      const preview = (result.content || '').slice(0, 350);

      card = `<div class="chatgpt-search-card open">
        <div class="chatgpt-search-pill done read-url-pill" onclick="this.closest('.chatgpt-search-card').classList.toggle('open')" title="Klik untuk tutup/buka">
          <span class="chatgpt-search-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>
          <span class="chatgpt-search-text">Read: ${escHtml(domain || url)}</span>
          <span class="chatgpt-search-arrow"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
        </div>
        <div class="chatgpt-search-drawer">
          <div class="chatgpt-search-drawer-header">
            <a href="${escAttr(url)}" target="_blank" rel="noopener noreferrer" class="read-url-link-header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              <span>${escHtml(title)}</span>
            </a>
            <span class="read-url-size-badge">${(len / 1024).toFixed(1)} KB dibaca</span>
          </div>
          <div class="read-url-preview-body">
${escHtml(preview)}${len > 350 ? '...' : ''}
          </div>
        </div>
      </div>`;
      break;
    }

    case 'screenshot':
      card = `<div class="tool-screenshot">
        <div class="tool-card-header">
          <span class="tool-card-label">screenshot</span>
          <span class="tool-status-ok">✓ captured</span>
        </div>
        <img src="${API_BASE}${result.url}" class="chat-image" alt="Screenshot" loading="lazy"
          onclick="this.classList.toggle('chat-image-full')">
      </div>`;
      break;

    case 'generated_image':
    case 'image': {
      const imgUrl = result.url?.startsWith('http') ? result.url : `${API_BASE}${result.url}`;
      const promptText = result.prompt || '';
      const modelLabel = result.model || 'FLUX.1';
      const arLabel = result.aspect_ratio || '1:1';
      const dimLabel = result.width && result.height ? `${result.width}×${result.height}` : '';
      const fname = result.filename || `image_${Date.now()}.jpg`;

      card = `<div class="tool-generated-image-card">
        <div class="tool-card-header">
          <div class="tool-card-left">
            <span class="action-card-badge visual-badge">🎨 ${escHtml(modelLabel)}</span>
            <span class="action-card-title">${escHtml(promptText.length > 40 ? promptText.slice(0, 38) + '...' : promptText || 'Generated Image')}</span>
          </div>
          <div class="tool-card-right">
            <span class="action-status-pill ok">${escHtml(arLabel)}${dimLabel ? ' · ' + escHtml(dimLabel) : ''}</span>
            <a href="${escAttr(imgUrl)}" download="${escAttr(fname)}" class="btn-download-image" title="Unduh gambar resolusi tinggi" target="_blank">
              ⬇️ Unduh HD
            </a>
          </div>
        </div>
        <div class="generated-image-wrapper">
          <img src="${escAttr(imgUrl)}" class="chat-image generated-chat-image" alt="${escAttr(promptText)}" loading="lazy"
            onclick="openImageLightbox('${escAttr(imgUrl)}', '${escAttr(promptText)}')">
          <div class="generated-image-overlay-hint">🔍 Klik untuk perbesar</div>
        </div>
        ${promptText ? `<div class="generated-image-footer">
          <span class="generated-image-prompt">"${escHtml(promptText)}"</span>
          <button class="btn-copy-prompt" data-prompt="${escAttr(promptText)}" title="Salin Prompt">📋 Salin Prompt</button>
        </div>` : ''}
      </div>`;
      break;
    }

    case 'status': {
      const d = result.data;
      card = `<div class="action-card">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge">system</span>
            <span class="action-card-title">Status Laptop</span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill ok">✓ ok</span>
            <div class="action-card-actions">
              <button class="action-btn action-btn-toggle" title="Tampilkan / Minimize detail">
                <span class="action-btn-label">Detail</span>
                <span class="action-card-toggle">▼</span>
              </button>
            </div>
          </div>
        </div>
        <div class="action-card-body" style="line-height:1.7">
          • <strong>Battery:</strong> ${escHtml(d.battery)}<br>
          • <strong>RAM:</strong> ${escHtml(d.ram)}<br>
          • <strong>CPU:</strong> ${escHtml(d.cpu)}<br>
          ${d.temp && d.temp !== 'N/A' ? `• <strong>Suhu (Temp):</strong> ${escHtml(d.temp)}${d.gpuTemp && d.gpuTemp !== 'N/A' ? ` (GPU: ${escHtml(d.gpuTemp)})` : ''}<br>` : ''}
          • <strong>Uptime:</strong> ${escHtml(d.uptime)}
        </div>
      </div>`;
      break;
    }

    case 'processes': {
      const procs = result.data?.processes || [];
      const procRows = procs.map(p => `<tr>
        <td style="padding:4px 8px;font-weight:500;">${escHtml(p.process)}</td>
        <td style="padding:4px 8px;text-align:right;color:var(--accent);">${p.memoryMB} MB</td>
      </tr>`).join('');
      card = `<div class="action-card">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge">process</span>
            <span class="action-card-title">Top Proses Pemakan RAM (${procs.length} Aplikasi)</span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill ok">✓ live</span>
            <div class="action-card-actions">
              <button class="action-btn action-btn-toggle" title="Tampilkan / Minimize detail">
                <span class="action-btn-label">Detail</span>
                <span class="action-card-toggle">▼</span>
              </button>
            </div>
          </div>
        </div>
        <div class="action-card-body" style="padding:4px 8px;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:var(--font-mono);">
            <thead>
              <tr style="border-bottom:1px solid var(--border);color:var(--text-muted);font-size:11px;">
                <th style="text-align:left;padding:4px 8px;">Nama Aplikasi / Proses</th>
                <th style="text-align:right;padding:4px 8px;">RAM Digunakan</th>
              </tr>
            </thead>
            <tbody>${procRows}</tbody>
          </table>
        </div>
      </div>`;
      break;
    }

    case 'battery': {
      const b = result.data;
      card = `<div class="action-card">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge">battery</span>
            <span class="action-card-title">Baterai: ${escHtml(b.charge)} (${escHtml(b.status)})</span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill ok">Health: ${escHtml(b.health)}</span>
            <div class="action-card-actions">
              <button class="action-btn action-btn-toggle" title="Tampilkan / Minimize detail">
                <span class="action-btn-label">Detail</span>
                <span class="action-card-toggle">▼</span>
              </button>
            </div>
          </div>
        </div>
        <div class="action-card-body" style="line-height:1.7">
          • <strong>Kesehatan Baterai:</strong> ${escHtml(b.health)} (${escHtml(b.fullCapacity)} / ${escHtml(b.designCapacity)})<br>
          • <strong>Status:</strong> ${escHtml(b.status)} (${escHtml(b.charge)})<br>
          • <strong>Tegangan:</strong> ${escHtml(b.voltage)}  ·  <strong>Sisa Waktu:</strong> ${escHtml(b.remainingTime)}
        </div>
      </div>`;
      break;
    }

    case 'terminal': {
      const isOk = !!result.success;
      const cmd = result.command || '';
      const output = result.output || '(perintah selesai tanpa teks output)';
      const duration = result.duration ? `${result.duration}ms` : '';
      card = `<div class="action-card terminal-card" data-cmd="${escAttr(cmd)}">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge terminal">terminal</span>
            <span class="action-card-title" title="${escAttr(cmd)}">${escHtml(cmd.length > 50 ? cmd.slice(0, 48) + '...' : cmd)}</span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill ${isOk ? 'ok' : 'err'}">${isOk ? '✓ ok' : '✗ err'}</span>
            <div class="action-card-actions">
              <button class="action-btn action-btn-toggle" title="Tampilkan / Minimize output terminal">
                <span class="action-btn-label">Tampilkan</span>
                <span class="action-card-toggle">▼</span>
              </button>
            </div>
          </div>
        </div>
        <div class="action-card-body">
          <div class="terminal-meta">
            <span>Command: <code>${escHtml(cmd)}</code></span>
            ${duration ? `<span>${duration}</span>` : ''}
          </div>
          <pre class="terminal-output">${escHtml(output)}</pre>
        </div>
      </div>`;
      break;
    }

    case 'desktop_action': {
      const isOk = result.success !== false;
      const act = result.action || 'desktop_action';
      const app = result.app || '';
      const msg = result.message || '';
      card = `<div class="action-card open">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge" style="color:#f7b06d;background:rgba(247,176,109,0.12);border-color:rgba(247,176,109,0.3)">desktop</span>
            <span class="action-card-title">${escHtml(act)}${app ? `: <code>${escHtml(app)}</code>` : ''}</span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill ${isOk ? 'ok' : 'err'}">${isOk ? '✓ ok' : '✗ err'}</span>
          </div>
        </div>
        ${msg ? `<div class="action-card-body" style="padding:10px 14px;font-size:12px;color:var(--text-muted);">${escHtml(msg)}</div>` : ''}
      </div>`;
      break;
    }

    case 'mouse': {
      const act = result.action || 'click';
      const coords = (result.x >= 0 && result.y >= 0) ? `(X: ${result.x}, Y: ${result.y})` : '';
      card = `<div class="action-card open">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge" style="color:#60a5fa;background:rgba(96,165,250,0.12);border-color:rgba(96,165,250,0.3)">mouse</span>
            <span class="action-card-title">Aksi Mouse: <strong>${escHtml(act)}</strong> ${escHtml(coords)}</span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill ok">✓ selesai</span>
          </div>
        </div>
      </div>`;
      break;
    }

    case 'keyboard': {
      const txt = result.text ? `"${result.text}"` : '';
      const key = result.key ? `[${result.key}]` : '';
      card = `<div class="action-card open">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge" style="color:#34d399;background:rgba(52,211,153,0.12);border-color:rgba(52,211,153,0.3)">keyboard</span>
            <span class="action-card-title">Ketik Keyboard: <strong>${escHtml(txt)}</strong> ${escHtml(key)}</span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill ok">✓ terketik</span>
          </div>
        </div>
      </div>`;
      break;
    }

    case 'error':
      card = `<div class="action-card">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge" style="color:#f08282;background:rgba(240,130,130,0.12);border-color:rgba(240,130,130,0.3)">error</span>
            <span class="action-card-title">${escHtml(result.message || 'Unknown error')}</span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill err">✗ err</span>
          </div>
        </div>
      </div>`;
      break;

    case 'file_patched': {
      const filePath = result.path || 'file';
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      const targetText = result.target || '';
      const replacementText = result.replacement || '';
      const sizeStr = formatFileSize(result.size);

      card = `<div class="action-card open">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge" style="color:#38bdf8;background:rgba(56,189,248,0.12);border-color:rgba(56,189,248,0.3)">patch</span>
            <span class="action-card-title" title="${escAttr(filePath)}">Patch: <strong>${escHtml(fileName)}</strong></span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill ok">✓ diff (${sizeStr})</span>
            <div class="action-card-actions">
              <button class="action-btn action-btn-toggle" title="Tampilkan / Minimize diff">
                <span class="action-btn-label">Ciutkan</span>
                <span class="action-card-toggle">▲</span>
              </button>
            </div>
          </div>
        </div>
        <div class="action-card-body" style="padding:0;overflow:hidden;">
          <div style="font-family:var(--font-mono);font-size:11px;background:#0d1117;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,0.08);color:var(--text-muted);display:flex;justify-content:space-between;">
            <span>📄 ${escHtml(filePath)}</span>
            <span style="color:#7ab87a;">Surgical Code Diff</span>
          </div>
          <div style="font-family:var(--font-mono);font-size:11.5px;line-height:1.5;max-height:240px;overflow-y:auto;background:rgba(0,0,0,0.35);padding:6px 0;">
            ${targetText ? `<div style="background:rgba(239,68,68,0.15);border-left:3px solid #ef4444;padding:4px 12px;margin:2px 0;white-space:pre-wrap;color:#fca5a5;"><span style="user-select:none;opacity:0.6;margin-right:8px;font-weight:bold;">-</span>${escHtml(targetText)}</div>` : ''}
            ${replacementText ? `<div style="background:rgba(34,197,94,0.15);border-left:3px solid #22c55e;padding:4px 12px;margin:2px 0;white-space:pre-wrap;color:#86efac;"><span style="user-select:none;opacity:0.6;margin-right:8px;font-weight:bold;">+</span>${escHtml(replacementText)}</div>` : ''}
          </div>
        </div>
      </div>`;
      break;
    }

    case 'code_search_results': {
      const q = result.query || '';
      const count = result.count || (result.matches ? result.matches.length : 0);
      const matches = result.matches || [];
      const matchRows = matches.map(m => `
        <div style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;flex-direction:column;gap:3px;">
          <div style="display:flex;align-items:center;gap:8px;font-size:11.5px;">
            <span style="color:var(--accent,#818cf8);font-weight:600;">${escHtml(m.file)}</span>
            <span style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;font-size:10.5px;color:var(--text-muted);">Line ${m.line}</span>
          </div>
          <pre style="margin:0;font-size:11px;color:var(--text-secondary,#cbd5e1);background:rgba(0,0,0,0.25);padding:3px 6px;border-radius:3px;overflow-x:auto;">${escHtml(m.snippet)}</pre>
        </div>
      `).join('');

      card = `<div class="action-card open">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge" style="color:#fbbf24;background:rgba(251,191,36,0.12);border-color:rgba(251,191,36,0.3)">grep</span>
            <span class="action-card-title">Cari Kode: "<strong>${escHtml(q)}</strong>"</span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill ok">${count} match${count !== 1 ? 'es' : ''}</span>
            <div class="action-card-actions">
              <button class="action-btn action-btn-toggle" title="Tampilkan / Minimize hasil cari">
                <span class="action-btn-label">Ciutkan</span>
                <span class="action-card-toggle">▲</span>
              </button>
            </div>
          </div>
        </div>
        <div class="action-card-body" style="padding:0;max-height:280px;overflow-y:auto;">
          ${matches.length > 0 ? matchRows : `<div style="padding:12px;color:var(--text-muted);font-size:12px;">Tidak ditemukan baris yang cocok.</div>`}
        </div>
      </div>`;
      break;
    }

    case 'file_written': {
      const filePath = result.path || 'file';
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      const sizeStr = formatFileSize(result.size);

      card = `<div class="action-card open">
        <div class="action-card-header">
          <div class="action-card-left">
            <span class="action-card-badge" style="color:#10b981;background:rgba(16,185,129,0.12);border-color:rgba(16,185,129,0.3)">file</span>
            <span class="action-card-title">Berkas Disimpan: <strong>${escHtml(fileName)}</strong></span>
          </div>
          <div class="action-card-right">
            <span class="action-status-pill ok">✓ saved (${sizeStr})</span>
          </div>
        </div>
        <div class="action-card-body" style="padding:8px 12px;font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted);">
          📁 <code>${escHtml(filePath)}</code>
        </div>
      </div>`;
      break;
    }

    case 'text':
      bub.style.padding = '';
      bub.style.background = '';
      bub.style.border = '';
      bub.innerHTML = renderMarkdown(result.message || '');
      row.appendChild(bub);
      msgs.appendChild(row);
      msgs.scrollTop = msgs.scrollHeight;
      return;
  }

  bub.innerHTML = card;
  bub.querySelectorAll('.btn-copy-prompt').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = btn.dataset.prompt;
      if (p) {
        navigator.clipboard.writeText(p);
        const orig = btn.textContent;
        btn.textContent = '✓ Tersalin!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }
    });
  });
  row.appendChild(bub);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Attachment Helpers (Images, PDFs, Documents, Code, Data) ──
function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function compressImage(file, maxDimension = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('File yang dipilih bukan gambar.'));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca berkas gambar.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Gagal memproses gambar.'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const format = (file.type === 'image/png') ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(format, quality);
        resolve(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function setAttachmentPreview(att) {
  state.pendingAttachment = att;
  state.pendingImage = (att && att.type === 'image') ? att.dataUrl : null;

  const bar = $('image-preview-bar');
  if (!bar) return;

  let thumbHtml = '';
  let subText = 'Siap dikirim';

  if (att.type === 'image') {
    thumbHtml = `<img src="${att.dataUrl}" class="preview-thumb-img" alt="Preview" />`;
    subText = `${escHtml(formatFileSize(att.size))} · Gambar siap dikirim`;
  } else if (att.type === 'pdf') {
    thumbHtml = `
      <div class="preview-file-icon pdf">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <span>PDF</span>
      </div>
    `;
    subText = `${escHtml(formatFileSize(att.size))} · Dokumen PDF siap dikirim`;
  } else {
    const iconLabel = (att.ext || 'FILE').toUpperCase().slice(0, 4);
    thumbHtml = `
      <div class="preview-file-icon ${escHtml(att.category || 'text')}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>${escHtml(iconLabel)}</span>
      </div>
    `;
    subText = `${escHtml(formatFileSize(att.size))} · Berkas ${escHtml((att.ext || '').toUpperCase())} siap dikirim`;
  }

  bar.innerHTML = `
    <div class="preview-thumb-wrap">
      ${thumbHtml}
      <button class="preview-thumb-remove" id="btn-remove-attachment" title="Hapus lampiran"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="preview-info">
      <div class="preview-filename">${escHtml(att.name || 'Lampiran')}</div>
      <div class="preview-filesize">${subText}</div>
    </div>
  `;
  bar.style.display = 'flex';

  $('btn-remove-attachment')?.addEventListener('click', (e) => {
    e.stopPropagation();
    clearAttachmentPreview();
  });

  $$('.btn-send')?.classList.add('active');
}

function clearAttachmentPreview() {
  state.pendingAttachment = null;
  state.pendingImage = null;
  const bar = $('image-preview-bar');
  if (bar) {
    bar.innerHTML = '';
    bar.style.display = 'none';
  }
  const fileInput = $('image-file-input');
  if (fileInput) fileInput.value = '';
  const text = $('chat-input')?.value.trim();
  if (!text) {
    $$('.btn-send')?.classList.remove('active');
  }
}

async function handleSelectedFile(file) {
  if (!file) return;

  if (file.size > 15 * 1024 * 1024) {
    alert('Ukuran berkas terlalu besar. Maksimal 15 MB.');
    return;
  }

  const name = file.name || 'file';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';

  // 1. Gambar
  if (file.type.startsWith('image/')) {
    try {
      const dataUrl = await compressImage(file);
      const approxBytes = Math.round((dataUrl.length * 3) / 4);
      setAttachmentPreview({
        type: 'image',
        dataUrl,
        name,
        size: approxBytes
      });
      $('chat-input')?.focus();
    } catch (err) {
      console.error('Image compression failed:', err);
      alert('Gagal memproses gambar: ' + err.message);
    }
    return;
  }

  // 2. Dokumen PDF
  if (file.type === 'application/pdf' || ext === 'pdf') {
    const reader = new FileReader();
    reader.onerror = () => alert('Gagal membaca berkas PDF.');
    reader.onload = () => {
      setAttachmentPreview({
        type: 'pdf',
        dataUrl: reader.result,
        name,
        size: file.size,
        ext: 'pdf'
      });
      $('chat-input')?.focus();
    };
    reader.readAsDataURL(file);
    return;
  }

  // 3. Teks, Data, Script, Kodingan
  const CODE_EXTS = ['js', 'mjs', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'scss', 'json', 'sql', 'sh', 'bat', 'cmd', 'ps1', 'c', 'cpp', 'h', 'java', 'rs', 'go', 'php', 'rb', 'lua'];
  const DATA_EXTS = ['csv', 'tsv', 'xml', 'yaml', 'yml', 'env', 'ini', 'log', 'txt', 'md'];

  let category = 'text';
  if (CODE_EXTS.includes(ext)) category = 'code';
  else if (DATA_EXTS.includes(ext)) category = 'data';

  const textReader = new FileReader();
  textReader.onerror = () => alert('Gagal membaca isi berkas.');
  textReader.onload = () => {
    setAttachmentPreview({
      type: 'file',
      content: textReader.result,
      name,
      size: file.size,
      ext,
      category
    });
    $('chat-input')?.focus();
  };
  textReader.readAsText(file);
}

// ── Stream Abort & Stop Button ─────────────────────────
let currentChatAbortController = null;
let currentChatReader = null;

const SEND_ICON_SVG = `
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
`;

const STOP_ICON_SVG = `
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2.5"/>
  </svg>
`;

function updateSendButtonState(isStreaming) {
  const sendBtn = $$('.btn-send');
  const chatInput = $('chat-input');
  if (!sendBtn) return;

  if (isStreaming) {
    sendBtn.classList.add('streaming');
    sendBtn.classList.add('active');
    sendBtn.setAttribute('aria-label', 'Stop');
    sendBtn.setAttribute('title', 'Hentikan respon (Stop)');
    sendBtn.innerHTML = STOP_ICON_SVG;
  } else {
    sendBtn.classList.remove('streaming');
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.setAttribute('title', 'Kirim pesan');
    sendBtn.innerHTML = SEND_ICON_SVG;
    const hasText = chatInput && chatInput.value.trim().length > 0;
    sendBtn.classList.toggle('active', hasText || !!state.pendingAttachment);
  }
}

function stopGenerating() {
  if (!state.streaming) return;
  console.log('[Chat] Stopping generation by user request...');

  if (currentChatAbortController) {
    try { currentChatAbortController.abort(); } catch {}
  }
  if (currentChatReader) {
    try { currentChatReader.cancel(); } catch {}
  }

  state.streaming = false;
  updateSendButtonState(false);
  removeToolPending();
}

// ── Send message ──────────────────────────────────────
function setupInput() {
  const input   = $('chat-input');
  const sendBtn = $$('.btn-send');
  const attachBtn = $('btn-attach-image');
  const fileInput = $('image-file-input');
  const inputBox = $('input-box') || $$('.input-box');

  const updatePlaceholder = () => {
    if (!input) return;
    input.placeholder = window.innerWidth <= 768 ? 'Tanya sesuatu...' : 'Tanya sesuatu, atau ketik / untuk perintah...';
  };
  updatePlaceholder();
  window.addEventListener('resize', updatePlaceholder);

  input.addEventListener('focus', () => {
    if (window.innerWidth <= 768) {
      setTimeout(() => {
        const msgs = $$('.chat-messages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
      }, 300);
    }
  });

  input.addEventListener('input', () => {
    input.style.height = '24px';
    const newHeight = Math.min(input.scrollHeight, 180);
    input.style.height = newHeight + 'px';
    if (inputBox) {
      if (newHeight > 34) {
        inputBox.classList.add('multiline');
      } else {
        inputBox.classList.remove('multiline');
      }
    }
    if (!state.streaming) {
      sendBtn.classList.toggle('active', input.value.trim().length > 0 || !!state.pendingAttachment);
    }
    handleSlashInput(input.value);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const slash = $$('.slash-menu');
      if (slash?.classList.contains('open')) { selectFocusedSlash(); return; }
      if (state.streaming) {
        stopGenerating();
      } else {
        sendMessage();
      }
      return;
    }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveFocus(-1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    if (e.key === 'Escape') {
      if (state.streaming) {
        stopGenerating();
      } else {
        closeSlash();
      }
    }
  });

  sendBtn.addEventListener('click', () => {
    if (state.streaming) {
      stopGenerating();
    } else {
      sendMessage();
    }
  });


  // Attach button click
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', (e) => {
      e.preventDefault();
      fileInput.click();
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) {
        handleSelectedFile(fileInput.files[0]);
      }
    });
  }

  // Clipboard paste (Ctrl+V screenshot or file)
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleSelectedFile(file);
          break;
        }
      }
    }
  });

  // Drag and drop files into input
  if (inputBox) {
    ['dragenter', 'dragover'].forEach(name => {
      inputBox.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputBox.classList.add('drag-over');
      });
    });
    ['dragleave', 'dragend'].forEach(name => {
      inputBox.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputBox.classList.remove('drag-over');
      });
    });
    inputBox.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      inputBox.classList.remove('drag-over');
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleSelectedFile(e.dataTransfer.files[0]);
      }
    });
  }

  // Click image in chat to view in lightbox modal
  document.addEventListener('click', (e) => {
    const img = e.target.closest('.chat-image, .generated-chat-image, .message-bubble img');
    if (img && !img.closest('#image-lightbox-overlay') && !img.closest('#artifact-sidebar')) {
      e.stopPropagation();
      e.preventDefault();
      openImageLightbox(img.src, img.alt || 'Preview Gambar');
    }
  });
}

async function sendMessage() {
  if (state.streaming) {
    stopGenerating();
    return;
  }
  const input = $('chat-input');
  const text  = input.value.trim();
  const attachment = state.pendingAttachment;

  // Do not send if both text and attachment are empty
  if (!text && !attachment) return;

  closeSlash();
  input.value = '';
  input.style.height = '24px';
  ($('input-box') || $$('.input-box'))?.classList.remove('multiline');
  $$('.btn-send')?.classList.remove('active');
  clearAttachmentPreview();

  // Local slash commands (only if no attachment)
  if (!attachment) {
    if (text.startsWith('/model ')) {
      const m = text.replace('/model ', '').trim();
      setModel(m);
      appendAgentMessage(`Model diset ke **${m}**.`, false);
      return;
    }
    if (text.startsWith('/panggilan ') || text.startsWith('/nama ') || text.startsWith('/nickname ')) {
      const newNick = text.replace(/^\/(panggilan|nama|nickname)\s+/, '').trim();
      if (!newNick) {
        appendAgentMessage('Format: `/panggilan [nama kamu]` (contoh: `/panggilan Dil` atau `/panggilan Bos`).', false);
        return;
      }
      try {
        const r = await apiFetch(`${API_BASE}/api/user/nickname`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname: newNick })
        });
        const d = await r.json();
        if (d.ok) {
          if (state.currentUser) state.currentUser.nickname = d.nickname;
          const nickInput = $('input-user-nickname');
          if (nickInput) nickInput.value = d.nickname;
          appendAgentMessage(`Siap! Nama panggilan berhasil diubah menjadi **${escHtml(d.nickname)}**. Mulai sekarang gw bakal panggil lu **${escHtml(d.nickname)}**!`, false);
        } else {
          appendAgentMessage(`Gagal mengubah nama panggilan: ${d.error || 'Terjadi kesalahan'}`, false);
        }
      } catch (err) {
        appendAgentMessage(`Gagal menghubungi server: ${err.message}`, false);
      }
      return;
    }
    if (text === '/clear') { clearChat(); return; }
  }

  appendUserMessage(text, attachment);

  // Prepare payload for backend
  const chatPayload = {
    message: text,
    sessionId: state.sessionId,
    model: state.model,
    projectId: state.activeProjectId || null,
    roleplayActive: state.roleplayActive,
    personaId: state.activePersonaId || null,
  };

  if (attachment) {
    if (attachment.type === 'image') {
      chatPayload.image = attachment.dataUrl;
      chatPayload.attachmentMeta = { type: 'image', name: attachment.name, size: attachment.size };
    } else if (attachment.type === 'pdf') {
      chatPayload.pdf = attachment.dataUrl;
      chatPayload.attachmentMeta = { type: 'pdf', name: attachment.name, size: attachment.size, ext: 'pdf' };
    } else if (attachment.type === 'file') {
      chatPayload.file = {
        name: attachment.name,
        size: attachment.size,
        ext: attachment.ext,
        category: attachment.category,
        content: attachment.content
      };
      chatPayload.attachmentMeta = {
        type: 'file',
        name: attachment.name,
        size: attachment.size,
        ext: attachment.ext,
        category: attachment.category
      };
    }
  }

  await executeChatRequest(chatPayload);
}

// ── Shared Streaming Chat Executor ─────────────────────
async function executeChatRequest(chatPayload) {
  currentChatAbortController = new AbortController();
  state.streaming = true;
  updateSendButtonState(true);
  thinkingPanelRow = null;
  currentTurnReasoningMeta = '';

  const bubble = createAgentRow(true);
  const writer = createStreamWriter(bubble);

  let hasError = false;
  let wasAborted = false;
  try {
    let resp = null;
    try {
      resp = await apiFetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatPayload),
        signal: currentChatAbortController.signal,
      });
    } catch (fetchErr) {
      if (currentChatAbortController?.signal?.aborted) throw fetchErr;
      // Auto-retry once after 1.2s in case server was reloading
      await new Promise(r => setTimeout(r, 1200));
      resp = await apiFetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatPayload),
        signal: currentChatAbortController.signal,
      });
    }

    if (!resp.ok) {
      hasError = true;
      removeTyping(bubble);
      let errMsg = `Server error (${resp.status})`;
      try {
        const errJson = await resp.json();
        if (errJson && (errJson.error || errJson.message)) errMsg = errJson.error || errJson.message;
      } catch {}
      bubble.innerHTML = `<span style="color:#f08282;">⚠ ${escHtml(errMsg)}</span>`;
      return;
    }

    currentChatReader = resp.body.getReader();
    const reader = currentChatReader;
    const decoder = new TextDecoder();
    let buf = '';
    let currentEvent = 'message';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith('data: ')) {
          if (line.trim() === '') currentEvent = 'message';
          continue;
        }
        const raw = line.slice(6).trim();
        if (!raw) continue;

        try {
          const evt = JSON.parse(raw);

          if (currentEvent === 'agent_status' || evt.type === 'agent_status') {
            const w = bubble.querySelector('.hermes-thinking-widget');
            if (w) {
              stopRobotCognitiveProgression(w);
              setWidgetKaomoji(w, evt.face, evt.verb);
            }
          } else if (currentEvent === 'thinking_step' || evt.type === 'thinking_step') {
            updateThinkingPanel(evt);
          } else if (currentEvent === 'action_preview' || evt.type === 'action_preview') {
            removeTyping(bubble);
            if (writer.raw().trim()) writer.finish();
            appendActionPreviewCard(evt);
          } else if (currentEvent === 'approval_required' || evt.type === 'approval_required') {
            removeTyping(bubble);
            if (writer.raw().trim()) writer.finish();
            appendApprovalCard(evt);
          } else if (currentEvent === 'tool_start' || evt.type === 'tool_start') {
            removeTyping(bubble);
            if (writer.raw().trim()) writer.finish();
            appendToolPending(evt.name || 'tool');
          } else if (currentEvent === 'tool_result' || evt.type === 'desktop_action' || evt.type === 'screenshot' || evt.type === 'status' || evt.type === 'terminal' || evt.type === 'search' || evt.type === 'read_url' || evt.type === 'processes' || evt.type === 'battery' || evt.type === 'mouse' || evt.type === 'keyboard' || evt.type === 'file_patched' || evt.type === 'code_search_results' || evt.type === 'file_written') {
            removeToolPending();
            appendToolCard(evt);
            const bubbleRow = bubble.closest('.message-row');
            const msgs = $$('.chat-messages');
            if (bubbleRow && msgs) {
              msgs.appendChild(bubbleRow);
            }
          } else if (currentEvent === 'error' || evt.type === 'error') {
            hasError = true;
            removeToolPending();
            removeTyping(bubble);
            const errMsg = evt.message || evt.error || 'Terjadi kesalahan sistem.';
            if (writer.raw().trim()) {
              bubble.innerHTML = renderMarkdown(writer.raw().trim()) + `<div style="margin-top:8px;color:#f08282;font-size:13px;">⚠ Error: ${escHtml(errMsg)}</div>`;
            } else {
              bubble.innerHTML = `<span style="color:#f08282;">⚠ Error: ${escHtml(errMsg)}</span>`;
            }
            return;
          } else if (currentEvent === 'message' || evt.type === 'text') {
            if (evt.type === 'text' && evt.content) {
              // Client-side guard: do not render raw tool tags into chat bubble
              if (!/^<tool|<\|tool|\{"name":/i.test(evt.content.trim())) {
                removeTyping(bubble);
                writer.append(evt.content);
              }
            }
          }
        } catch {}

        currentEvent = 'message';
      }
    }

  } catch (e) {
    if (e.name === 'AbortError' || currentChatAbortController?.signal?.aborted) {
      wasAborted = true;
      removeToolPending();
      removeTyping(bubble);
      if (writer.raw().trim()) {
        bubble.innerHTML = renderMarkdown(writer.raw().trim()) + `<div style="margin-top:8px;color:var(--text-subtle);font-size:11.5px;font-style:italic;">⏹ Obrolan dihentikan oleh pengguna</div>`;
      } else {
        bubble.innerHTML = `<span style="color:var(--text-subtle);font-size:12px;font-style:italic;">⏹ Respons dihentikan.</span>`;
      }
    } else {
      hasError = true;
      removeToolPending();
      removeTyping(bubble);
      const errMsg = `⚠ Gagal terhubung ke server: ${e.message}\n\nPastikan backend Sanfa Agent berjalan.`;
      if (writer.raw().trim()) {
        bubble.innerHTML = renderMarkdown(writer.raw().trim()) + `<div style="margin-top:8px;color:#f08282;font-size:13px;">${renderMarkdown(errMsg)}</div>`;
      } else {
        bubble.innerHTML = renderMarkdown(errMsg);
      }
    }
  } finally {
    if (!hasError && !wasAborted) {
      writer.finish();
      finalizeReasoningMeta(bubble, currentTurnReasoningMeta);
    } else if (wasAborted && writer.raw().trim()) {
      finalizeReasoningMeta(bubble, currentTurnReasoningMeta);
    }
    if (thinkingPanelRow) {
      thinkingPanelRow.remove();
      thinkingPanelRow = null;
    }
    state.streaming = false;
    currentChatAbortController = null;
    currentChatReader = null;
    updateSendButtonState(false);
    if (!writer.raw().trim() && (!bubble.textContent || !bubble.textContent.trim())) {
      bubble.closest('.message-row')?.remove();
    }
    loadSessions();
    // Auto-refresh sessions 2.5s later to pick up ChatGPT-style auto-generated title
    setTimeout(() => {
      loadSessions();
    }, 2500);
  }
}


// ── Message Actions (Copy & Edit ala ChatGPT / Claude) ──
function createMessageActions(role, rawContent, rowEl) {
  const bar = document.createElement('div');
  bar.className = `message-actions-bar ${role}-actions`;
  rowEl._rawMessageText = rawContent || '';

  if (role === 'user') {
    // 1. Copy prompt
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = 'Salin pertanyaan';
    copyBtn.setAttribute('aria-label', 'Salin pertanyaan');
    copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="13" x="9" y="9" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener('click', () => {
      const textToCopy = rowEl._rawMessageText || '';
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).catch(() => {});
        const origHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#68d391" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        copyBtn.style.color = '#68d391';
        setTimeout(() => {
          copyBtn.innerHTML = origHtml;
          copyBtn.style.color = '';
        }, 1500);
      }
    });
    bar.appendChild(copyBtn);

    // 2. Edit prompt (inline edit)
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-btn';
    editBtn.title = 'Edit pertanyaan';
    editBtn.setAttribute('aria-label', 'Edit pertanyaan');
    editBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
    editBtn.addEventListener('click', () => {
      if (state.streaming) return;
      startInlineEditUserMessage(rowEl);
    });
    bar.appendChild(editBtn);

  } else if (role === 'agent') {
    // 1. Copy response
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = 'Salin jawaban';
    copyBtn.setAttribute('aria-label', 'Salin jawaban');
    copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="13" x="9" y="9" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener('click', () => {
      const textToCopy = rowEl._rawMessageText || '';
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).catch(() => {});
        const origHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#68d391" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        copyBtn.style.color = '#68d391';
        setTimeout(() => {
          copyBtn.innerHTML = origHtml;
          copyBtn.style.color = '';
        }, 1500);
      }
    });
    bar.appendChild(copyBtn);

    // 2. Regenerate response
    const regenBtn = document.createElement('button');
    regenBtn.className = 'msg-action-btn';
    regenBtn.title = 'Jawab ulang (Regenerate)';
    regenBtn.setAttribute('aria-label', 'Jawab ulang');
    regenBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/></svg>`;
    regenBtn.addEventListener('click', () => {
      if (state.streaming) return;
      regenerateAgentMessage(rowEl);
    });
    bar.appendChild(regenBtn);
  }

  return bar;
}

function attachAgentMessageActions(bubble, rawText) {
  const row = bubble.closest('.message-row.agent');
  if (!row) return;
  row._rawMessageText = rawText;
  const wrap = row.querySelector('.message-bubble-wrap') || row;
  let actionsBar = wrap.querySelector('.message-actions-bar');
  if (actionsBar) actionsBar.remove();

  actionsBar = createMessageActions('agent', rawText, row);
  wrap.appendChild(actionsBar);
}

function startInlineEditUserMessage(rowEl) {
  const bub = rowEl.querySelector('.message-bubble');
  const actionsBar = rowEl.querySelector('.message-actions-bar');
  if (!bub || bub._isEditing) return;

  bub._isEditing = true;
  if (actionsBar) actionsBar.style.display = 'none';

  const origHtml = bub.innerHTML;
  const currentText = rowEl._rawMessageText || '';

  const attachmentEl = bub.querySelector('.chat-image, .chat-file-card');
  const attachmentClone = attachmentEl ? attachmentEl.cloneNode(true) : null;

  bub.innerHTML = '';
  if (attachmentClone) {
    bub.appendChild(attachmentClone);
  }

  const editorDiv = document.createElement('div');
  editorDiv.className = 'message-inline-editor';
  editorDiv.innerHTML = `
    <textarea class="inline-edit-textarea" rows="2" placeholder="Edit pertanyaan...">${escHtml(currentText)}</textarea>
    <div class="inline-edit-actions">
      <button type="button" class="btn-inline-cancel">Batal</button>
      <button type="button" class="btn-inline-submit">Kirim</button>
    </div>
  `;
  bub.appendChild(editorDiv);

  const textarea = editorDiv.querySelector('.inline-edit-textarea');
  const cancelBtn = editorDiv.querySelector('.btn-inline-cancel');
  const submitBtn = editorDiv.querySelector('.btn-inline-submit');

  const adjustHeight = () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(220, textarea.scrollHeight) + 'px';
  };
  textarea.addEventListener('input', adjustHeight);
  setTimeout(adjustHeight, 10);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const restore = () => {
    bub._isEditing = false;
    bub.innerHTML = origHtml;
    if (actionsBar) actionsBar.style.display = 'flex';
  };

  cancelBtn.addEventListener('click', restore);

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      restore();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSubmit();
    }
  });

  const doSubmit = () => {
    const newText = textarea.value.trim();
    if (!newText) return;
    if (newText === currentText) {
      restore();
      return;
    }

    const msgsContainer = $$('.chat-messages');
    const allRows = Array.from(msgsContainer.querySelectorAll('.message-row:not(.thinking-panel-row):not(.action-preview-row):not(.tool-pending-row)'));
    const rowIndex = allRows.indexOf(rowEl);
    const editIndex = parseInt(rowEl.getAttribute('data-msg-index') || rowIndex, 10);

    // Remove all subsequent rows in DOM
    for (let i = allRows.length - 1; i > rowIndex; i--) {
      allRows[i].remove();
    }

    // Update current bubble
    bub._isEditing = false;
    bub.innerHTML = '';
    if (attachmentClone) {
      bub.appendChild(attachmentClone);
    }
    const textNode = document.createElement('div');
    textNode.textContent = newText;
    bub.appendChild(textNode);
    rowEl._rawMessageText = newText;
    if (actionsBar) actionsBar.style.display = 'flex';

    // Submit edited message
    submitEditedUserMessage(newText, editIndex);
  };

  submitBtn.addEventListener('click', doSubmit);
}

async function submitEditedUserMessage(newText, editIndex) {
  if (state.streaming) return;
  const chatPayload = {
    message: newText,
    sessionId: state.sessionId,
    model: state.model,
    editIndex,
    projectId: state.activeProjectId || null,
    roleplayActive: state.roleplayActive,
    personaId: state.activePersonaId || null,
  };
  await executeChatRequest(chatPayload);
}

async function regenerateAgentMessage(rowEl) {
  if (state.streaming) return;

  const msgsContainer = $$('.chat-messages');
  const allRows = Array.from(msgsContainer.querySelectorAll('.message-row:not(.thinking-panel-row):not(.action-preview-row):not(.tool-pending-row)'));
  const rowIndex = allRows.indexOf(rowEl);

  if (rowIndex >= 0) {
    for (let i = allRows.length - 1; i >= rowIndex; i--) {
      allRows[i].remove();
    }
  } else {
    rowEl.remove();
  }

  const chatPayload = {
    sessionId: state.sessionId,
    model: state.model,
    regenerate: true,
    projectId: state.activeProjectId || null,
    roleplayActive: state.roleplayActive,
    personaId: state.activePersonaId || null,
  };
  await executeChatRequest(chatPayload);
}

// ── Login Form Handler ─────────────────────────────────
function setupLoginForm() {
  const form = $('login-form');
  const errEl = $('login-error');
  const btn = $('login-submit-btn');

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const username = $('login-username')?.value.trim();
    const password = $('login-password')?.value;
    if (!username || !password) return;

    btn.disabled = true;
    btn.innerHTML = '<span>Memverifikasi...</span>';
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': getDeviceId()
        },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.blocked) {
          hideLoginModal();
          showBlockedScreen(data.reason || data.error);
          return;
        }
        if (errEl) {
          errEl.textContent = data.error || 'Login gagal. Periksa username dan password.';
          errEl.style.display = 'block';
        }
        btn.disabled = false;
        btn.innerHTML = '<span>Masuk</span>';
        return;
      }

      // Success
      setAuthToken(data.token);
      setCurrentUser(data.user);
      hideLoginModal();
      btn.disabled = false;
      btn.innerHTML = '<span>Masuk</span>';

      startNewChat();
      await loadSessions();
      await loadChatHistory();
      startStatusPolling();
    } catch (err) {
      if (errEl) {
        errEl.textContent = 'Gagal menghubungi server. Periksa jaringan Anda.';
        errEl.style.display = 'block';
      }
      btn.disabled = false;
      btn.innerHTML = '<span>Masuk</span>';
    }
  });
}

// ── Settings Tabs ──────────────────────────────────────
function setupSettingsTabs() {
  const tabs = document.querySelectorAll('.settings-tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const tabName = btn.dataset.tab;
      document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
      const targetPane = $(`settings-pane-${tabName}`);
      if (targetPane) targetPane.classList.add('active');

      if (tabName === 'users') loadAdminUsers();
      if (tabName === 'devices') loadAdminDevices();
      if (tabName === 'bridge') syncSettingsBridgeStatus();
    });
  });
}

// ── Admin: User Management ─────────────────────────────
async function loadAdminUsers() {
  const container = $('users-list-container');
  if (!container) return;
  container.innerHTML = '<div style="font-size:12px;color:var(--text-subtle)">Memuat daftar user...</div>';

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/users`);
    if (!res.ok) throw new Error('Gagal memuat');
    const data = await res.json();
    const users = data.users || [];
    if (users.length === 0) {
      container.innerHTML = '<div style="font-size:12px;color:var(--text-subtle)">Tidak ada user terdaftar.</div>';
      return;
    }
    container.innerHTML = '';
    users.forEach(u => {
      const card = document.createElement('div');
      card.className = 'user-item-card';
      const isOwner = u.role === 'owner';
      const initials = (u.name || u.username).slice(0, 2).toUpperCase();
      card.innerHTML = `
        <div class="user-item-left">
          <div class="user-item-avatar">${escHtml(initials)}</div>
          <div>
            <div class="user-item-title">${escHtml(u.name || u.username)} <span style="font-size:11px;color:var(--text-subtle)">(@${escHtml(u.username)})</span></div>
            <div class="user-item-sub">Dibuat: ${new Date(u.createdAt).toLocaleDateString('id-ID')}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="user-badge ${isOwner ? 'owner' : 'guest'}">${escHtml(u.role)}</span>
          ${u.username.toLowerCase() !== 'ikhsan' ? `<button class="btn-device-action danger btn-del-user" data-username="${escAttr(u.username)}" title="Hapus User">🗑️</button>` : ''}
        </div>
      `;
      const delBtn = card.querySelector('.btn-del-user');
      delBtn?.addEventListener('click', () => deleteUser(u.username));
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div style="font-size:12px;color:#ff9090">Gagal memuat user: ${escHtml(err.message)}</div>`;
  }
}

async function deleteUser(username) {
  if (!confirm(`Hapus akun @${username}? Seluruh sesi login akun ini akan dicabut.`)) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', username })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal menghapus');
    loadAdminUsers();
  } catch (e) {
    alert(e.message);
  }
}

function setupCreateUserForm() {
  const form = $('form-create-user');
  const statusEl = $('create-user-status');
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const username = $('input-new-username')?.value.trim();
    const password = $('input-new-password')?.value;
    const name = $('input-new-name')?.value.trim();
    const role = $('input-new-role')?.value || 'guest';

    if (!username || !password) return;
    if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }

    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', username, password, name, role })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal membuat user');

      if (statusEl) {
        statusEl.textContent = `✓ Berhasil membuat akun @${username}!`;
        statusEl.style.color = '#7ab87a';
        statusEl.style.display = 'block';
      }
      form.reset();
      loadAdminUsers();
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.style.color = '#ff9090';
        statusEl.style.display = 'block';
      }
    }
  });
}

function setupNicknameForm() {
  const form = $('form-update-nickname');
  const input = $('input-user-nickname');
  const statusEl = $('nickname-status-msg');

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const val = input?.value.trim();
    if (!val) return;

    const btn = $('btn-save-nickname');
    const oldText = btn?.textContent || '💾 Simpan';
    if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

    try {
      const res = await apiFetch(`${API_BASE}/api/user/nickname`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: val })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal menyimpan nama panggilan');

      if (state.currentUser) state.currentUser.nickname = data.nickname;
      if (statusEl) {
        statusEl.textContent = `✓ Nama panggilan disimpan: "${escHtml(data.nickname)}"! Sanfa akan menyapamu dengan nama ini.`;
        statusEl.style.color = '#7ab87a';
        statusEl.style.display = 'block';
        setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.style.color = '#ff9090';
        statusEl.style.display = 'block';
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = oldText; }
    }
  });
}

// ── Admin: Device Security & Blacklist ─────────────────
async function loadAdminDevices() {
  const activeContainer = $('active-devices-container');
  const blockedContainer = $('blocked-devices-container');
  if (!activeContainer || !blockedContainer) return;

  activeContainer.innerHTML = '<div style="font-size:12px;color:var(--text-subtle)">Memuat log perangkat aktif...</div>';
  blockedContainer.innerHTML = '<div style="font-size:12px;color:var(--text-subtle)">Memuat blacklist...</div>';

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/devices`);
    if (!res.ok) throw new Error('Gagal memuat perangkat');
    const data = await res.json();
    const sessions = data.sessions || [];
    const blocked = data.blocked || [];
    const myDevId = getDeviceId();

    // 1. Render Active Sessions
    if (sessions.length === 0) {
      activeContainer.innerHTML = '<div style="font-size:12px;color:var(--text-subtle)">Belum ada data sesi login.</div>';
    } else {
      activeContainer.innerHTML = '';
      sessions.forEach(s => {
        const isMe = s.deviceId === myDevId;
        const card = document.createElement('div');
        card.className = 'device-item' + (isMe ? ' is-current' : '');

        const icon = s.isMobile ? '📱' : '💻';
        const timeAgo = formatTimeAgo(s.lastActiveAt || s.loginAt);

        card.innerHTML = `
          <div class="device-item-header">
            <div class="device-item-title">
              <span>${icon}</span>
              <span>${escHtml(s.deviceInfo || 'Perangkat Tak Dikenal')}</span>
              ${isMe ? '<span class="device-current-tag">Perangkat Ini</span>' : ''}
            </div>
            <div>
              ${s.isBlocked ? '<span class="device-status-tag blocked">● DIBLOKIR</span>' : (s.isOnline ? '<span class="device-status-tag online">● ONLINE</span>' : '<span class="device-status-tag offline">● OFFLINE</span>')}
            </div>
          </div>
          <div class="device-details-grid">
            <div class="device-detail-item">
              <span>👤 User:</span>
              <span class="val">${escHtml(s.name || s.username)} (@${escHtml(s.username)})</span>
            </div>
            <div class="device-detail-item">
              <span>📍 Lokasi:</span>
              <span class="val">${escHtml(s.location || 'Localhost / Jaringan Internal')}</span>
            </div>
            <div class="device-detail-item">
              <span>🌐 IP / ISP:</span>
              <span class="val">${escHtml(s.ip || '127.0.0.1')} ${s.isp ? `(${escHtml(s.isp)})` : ''}</span>
            </div>
            <div class="device-detail-item">
              <span>⏱️ Terakhir Aktif:</span>
              <span class="val">${timeAgo}</span>
            </div>
            <div class="device-detail-item" style="grid-column: 1 / -1;">
              <span>🔑 Device ID:</span>
              <span class="val" style="font-size:10px;">${escHtml(s.deviceId || 'N/A')}</span>
            </div>
          </div>
          ${!isMe ? `
            <div class="device-actions">
              <button class="btn-device-action btn-kick-device" data-devid="${escAttr(s.deviceId)}" data-prefix="${escAttr(s.tokenPrefix)}">
                🔌 Putus Sesi
              </button>
              ${!s.isBlocked ? `
                <button class="btn-device-action danger btn-block-device">
                  ⛔ Blokir Device Ini
                </button>
              ` : ''}
            </div>
          ` : ''}
        `;

        const kickBtn = card.querySelector('.btn-kick-device');
        kickBtn?.addEventListener('click', () => kickSession(s.deviceId, s.tokenPrefix));

        const blockBtn = card.querySelector('.btn-block-device');
        blockBtn?.addEventListener('click', () => blockDevice(s));

        activeContainer.appendChild(card);
      });
    }

    // 2. Render Blocked Devices
    if (blocked.length === 0) {
      blockedContainer.innerHTML = '<div style="font-size:12px;color:var(--text-subtle)">Tidak ada perangkat di dalam blacklist.</div>';
    } else {
      blockedContainer.innerHTML = '';
      blocked.forEach(b => {
        const item = document.createElement('div');
        item.className = 'blocked-item-card';
        item.innerHTML = `
          <div class="blocked-item-info">
            <div class="blocked-item-target">⛔ ${escHtml(b.deviceInfo || b.ip || b.deviceId)}</div>
            <div class="blocked-item-meta">
              Alasan: <em>${escHtml(b.reason || 'Diblokir')}</em> · User: @${escHtml(b.username || 'unknown')}
              ${b.location ? ` · 📍 ${escHtml(b.location)}` : ''}
              ${b.ip ? ` · IP: ${escHtml(b.ip)}` : ''}
            </div>
          </div>
          <button class="btn-device-action btn-unblock-device" data-id="${escAttr(b.id)}">
            Buka Blokir
          </button>
        `;
        const unblockBtn = item.querySelector('.btn-unblock-device');
        unblockBtn?.addEventListener('click', () => unblockDevice(b.id));
        blockedContainer.appendChild(item);
      });
    }
  } catch (err) {
    activeContainer.innerHTML = `<div style="font-size:12px;color:#ff9090">Gagal memuat log perangkat: ${escHtml(err.message)}</div>`;
  }
}

async function blockDevice(session) {
  const reason = prompt(`Masukkan alasan pemblokiran perangkat [${session.deviceInfo} - ${session.location}]:`, 'Aktivitas mencurigakan / tidak diizinkan');
  if (reason === null) return;

  try {
    const res = await apiFetch(`${API_BASE}/api/admin/block-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: session.deviceId,
        ip: session.ip,
        reason: reason || 'Diblokir oleh Administrator',
        deviceInfo: session.deviceInfo,
        location: session.location,
        username: session.username
      })
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || 'Gagal memblokir');
    alert(`Perangkat [${session.deviceInfo}] berhasil diblokir secara permanen!`);
    loadAdminDevices();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function unblockDevice(id) {
  if (!confirm('Buka blokir untuk entri ini? Perangkat akan diizinkan kembali mengakses sistem.')) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/admin/unblock-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || 'Gagal membuka blokir');
    loadAdminDevices();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function kickSession(deviceId, tokenPrefix) {
  if (!confirm('Putuskan sesi perangkat ini? Pengguna akan langsung ter-logout.')) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/admin/kick-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, tokenPrefix })
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || 'Gagal memutuskan sesi');
    loadAdminDevices();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function formatTimeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

// ── Slash menu ─────────────────────────────────────────
function setupSlashMenu() {
  document.addEventListener('click', e => {
    if (!e.target.closest('.input-wrapper')) closeSlash();
  });
}

function handleSlashInput(val) {
  const menu = $$('.slash-menu');
  if (!menu) return;
  if (!val.startsWith('/')) { closeSlash(); return; }

  const q = val.toLowerCase();
  slashFiltered = SLASH_COMMANDS.filter(
    i => i.cmd.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q)
  );

  let body = menu.querySelector('.slash-menu-body');
  if (!body) { body = document.createElement('div'); body.className = 'slash-menu-body'; menu.appendChild(body); }
  body.innerHTML = '';

  if (slashFiltered.length === 0) {
    body.innerHTML = '<div class="slash-no-results">No commands found</div>';
  } else {
    slashFiltered.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'slash-item';
      el.innerHTML = `<span class="slash-cmd">${item.cmd}</span><span class="slash-desc">${item.desc}</span>`;
      el.addEventListener('click', () => applySlash(item));
      el.addEventListener('mouseenter', () => { slashFocusIndex = i; highlightFocus(); });
      body.appendChild(el);
    });
  }

  menu.classList.add('open');
  slashFocusIndex = -1;
}

function moveFocus(dir) {
  const menu = $$('.slash-menu');
  if (!menu?.classList.contains('open')) return;
  slashFocusIndex = Math.max(0, Math.min(slashFiltered.length - 1, slashFocusIndex + dir));
  highlightFocus();
}

function highlightFocus() {
  document.querySelectorAll('.slash-item').forEach((el, i) => el.classList.toggle('focused', i === slashFocusIndex));
}

function selectFocusedSlash() {
  if (slashFocusIndex >= 0 && slashFiltered[slashFocusIndex]) applySlash(slashFiltered[slashFocusIndex]);
  else if (slashFiltered.length === 1) applySlash(slashFiltered[0]);
}

function applySlash(item) {
  const input = $('chat-input');
  if (item.cmd.startsWith('/model ')) {
    const m = item.cmd.replace('/model ', '').trim();
    setModel(m);
    appendAgentMessage(`Model diset ke **${m}**.`, false);
    input.value = '';
    $$('.btn-send').classList.remove('active');
  } else if (item.cmd.startsWith('/imagine')) {
    input.value = 'Buatkan gambar: ';
    input.focus();
  } else if (item.cmd.startsWith('/panggilan')) {
    input.value = 'Ganti nama panggilan saya menjadi: ';
    input.focus();
  } else {
    input.value = item.cmd;
    input.focus();
  }
  closeSlash();
}

function closeSlash() {
  $$('.slash-menu')?.classList.remove('open');
  slashFocusIndex = -1;
}

// ── Model Picker Modal ─────────────────────────────────
function setupModalPicker() {
  const badge = $$('.model-badge');
  badge?.addEventListener('click', openModal);

  const closeBtn = $('modal-close');
  closeBtn?.addEventListener('click', closeModal);

  const overlay = $('model-modal-overlay');
  overlay?.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  const searchInput = $('model-search');
  searchInput?.addEventListener('input', () => filterModels(searchInput.value));

  // Tab switching
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filterModels($('model-search')?.value || '', tab.dataset.group);
    });
  });
}

let allModelData = null;

async function openModal() {
  const overlay = $('model-modal-overlay');
  if (!overlay) return;
  overlay.classList.add('active');
  $('model-search')?.focus();

  if (!allModelData) {
    const list = $('model-list');
    if (list) list.innerHTML = '<div class="model-loading">Loading models...</div>';
    try {
      const r = await apiFetch(`${API_BASE}/api/models`);
      allModelData = await r.json();
    } catch {
      allModelData = { combos: [], groups: {} };
    }
    // Build tabs
    buildTabs(allModelData);
  }
  filterModels('', 'combos');
}

function closeModal() {
  $('model-modal-overlay')?.classList.remove('active');
}

function buildTabs(data) {
  const tabsEl = $('model-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';

  const groups = ['combos', ...Object.keys(data.groups || {}).sort()];
  groups.forEach((g, i) => {
    const btn = document.createElement('button');
    btn.className = 'modal-tab' + (i === 0 ? ' active' : '');
    btn.dataset.group = g;
    btn.textContent = g;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      filterModels($('model-search')?.value || '', g);
    });
    tabsEl.appendChild(btn);
  });
}

function filterModels(query, group) {
  if (!allModelData) return;
  const activeTab = group || document.querySelector('.modal-tab.active')?.dataset.group || 'combos';
  const q = query.toLowerCase().trim();
  const list = $('model-list');
  if (!list) return;
  list.innerHTML = '';

  let items = [];

  if (activeTab === 'combos') {
    items = allModelData.combos || [];
    if (q) items = items.filter(m => m.id.includes(q) || m.desc?.toLowerCase().includes(q));
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'model-item' + (state.model === item.id ? ' active' : '');
      el.innerHTML = `<span class="model-item-id">${item.id}</span><span class="model-item-desc">${item.desc || ''}</span>`;
      el.addEventListener('click', () => setModel(item.id));
      list.appendChild(el);
    });
  } else {
    const groupModels = allModelData.groups?.[activeTab] || [];
    items = q ? groupModels.filter(m => m.toLowerCase().includes(q)) : groupModels;
    items.forEach(id => {
      const el = document.createElement('div');
      el.className = 'model-item' + (state.model === id ? ' active' : '');
      el.innerHTML = `<span class="model-item-id">${id}</span>`;
      el.addEventListener('click', () => setModel(id));
      list.appendChild(el);
    });
  }

  if (items.length === 0) {
    list.innerHTML = '<div class="model-loading">No models found</div>';
  }
}

// ── Mermaid & Artifact Config ──────────────────────────
function initMermaidConfig() {
  if (window.mermaid) {
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          darkMode: true,
          background: '#100a06',
          primaryColor: '#b87333',
          primaryTextColor: '#f3e6d8',
          primaryBorderColor: '#e08544',
          lineColor: '#ffbe6f',
          secondaryColor: '#2b1b11',
          tertiaryColor: '#1a100a',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }
      });
    } catch (e) {
      console.warn('Failed to initialize mermaid:', e);
    }
  }
}

function unescapeHtml(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

// ── Markdown renderer ──────────────────────────────────
function renderMarkdown(md) {
  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true });
    let html = marked.parse(md);
    html = html.replace(
      /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
      (_, lang, code) => {
        const l = (lang || 'code').toLowerCase().trim();
        const rawCode = unescapeHtml(code);
        const blockId = 'blk_' + Math.random().toString(36).slice(2, 9);

        // 1. Mermaid Visual Diagram
        if (l === 'mermaid') {
          return `<div class="artifact-chat-card" id="${blockId}" data-type="diagram" data-code="${escAttr(rawCode)}" data-title="Visual Diagram">
            <div class="artifact-chat-card-left">
              <div class="artifact-chat-card-icon diagram">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="6" height="6" x="3" y="3" rx="1"/>
                  <rect width="6" height="6" x="15" y="15" rx="1"/>
                  <path d="M6 9v3a3 3 0 0 0 3 3h6"/>
                </svg>
              </div>
              <div class="artifact-chat-card-meta">
                <div class="artifact-chat-card-title">Visual Diagram (Mermaid)</div>
                <div class="artifact-chat-card-sub">Diagram Alur · Klik untuk eksplorasi di panel samping</div>
              </div>
            </div>
            <div class="artifact-chat-card-right">
              <button class="btn-open-artifact-sidebar" title="Buka di Panel Samping">
                <span>Buka di Samping</span>
                <svg class="artifact-card-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </button>
            </div>
          </div>`;
        }

        // 2. Interactive Live Artifact (Claude & Modern IDE Style)
        const isHtmlArtifact = (l === 'html' || l === 'artifact') && (
          rawCode.includes('<!DOCTYPE') ||
          rawCode.includes('<html') ||
          rawCode.includes('<script') ||
          rawCode.includes('<canvas') ||
          rawCode.includes('<style') ||
          (rawCode.includes('<div') && rawCode.includes('</div>')) ||
          (rawCode.includes('<svg') && rawCode.includes('</svg>'))
        );

        if (isHtmlArtifact) {
          const titleMatch = rawCode.match(/<title[^>]*>([^<]+)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : 'Live Interactive App';

          // Block fake image loading spinners hallucinated by LLM
          if (/waiting for image|sedang generate image/i.test(title) || /waiting for image generation/i.test(rawCode)) {
            return `<div class="action-card" style="margin: 8px 0; border: 1px dashed var(--border-subtle, rgba(255,255,255,0.15)); padding: 10px 14px; border-radius: 8px; font-size: 12px; color: var(--text-muted); background: rgba(255,255,255,0.02);">
              <span style="color: #60a5fa; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> Mesin Visual:</span> Request gambar diproses langsung via Google Imagen 3.
            </div>`;
          }

          return `<div class="artifact-chat-card" id="${blockId}" data-type="html" data-code="${escAttr(rawCode)}" data-title="${escAttr(title)}">
            <div class="artifact-chat-card-left">
              <div class="artifact-chat-card-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                </svg>
              </div>
              <div class="artifact-chat-card-meta">
                <div class="artifact-chat-card-title">${escHtml(title)}</div>
                <div class="artifact-chat-card-sub">Interactive Artifact · HTML / CSS / JS</div>
              </div>
            </div>
            <div class="artifact-chat-card-right">
              <button class="btn-open-artifact-sidebar" title="Buka di Panel Samping">
                <span>Buka di Samping</span>
                <svg class="artifact-card-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </button>
            </div>
          </div>`;
        }

        // 3. Regular Code Block
        return `<div class="code-block-wrapper">
          <div class="code-block-header">
            <span class="code-lang">${escHtml(l)}</span>
            <button class="btn-copy" data-code="${escAttr(rawCode)}">Copy</button>
          </div>
          <pre><code>${code}</code></pre>
        </div>`;
      });
    return html;
  }
  return md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
      `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${lang||'code'}</span><button class="btn-copy" data-code="${escAttr(code.trim())}">Copy</button></div><pre><code>${escHtml(code.trim())}</code></pre></div>`)
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/^## (.+)$/gm,'<h2>$1</h2>')
    .replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/^- (.+)$/gm,'<li>$1</li>')
    .replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>')
    .replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>');
}

// ===== ARTIFACT RIGHT SIDEBAR (Interactive Artifact Style) =====
let activeArtifact = {
  title: '',
  code: '',
  type: 'html',
  svg: null,
};

let currentModalCode = '';

function prepareArtifactHtml(rawCode) {
  if (!rawCode) return '';
  const baseStyle = `<style id="sanfa-base-theme">
    :root { color-scheme: dark; }
    html, body {
      background-color: #140d07;
      color: #e6dfd8;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 12px;
      box-sizing: border-box;
    }
  </style>`;

  if (/<html/i.test(rawCode)) {
    if (/<head/i.test(rawCode)) {
      return rawCode.replace(/<head[^>]*>/i, `$&${baseStyle}`);
    }
    return baseStyle + rawCode;
  }
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${baseStyle}</head><body>${rawCode}</body></html>`;
}

function openArtifactSidebar(title, code, type = 'html', customSvg = null) {
  const sidebar = $('artifact-sidebar');
  const titleEl = $('art-side-title');
  const badgeEl = $('art-side-badge');
  const iframe = $('art-side-iframe');
  const diagContainer = $('art-side-diagram-container');
  const diagSvgWrap = $('art-side-diagram-svg');
  const codeContent = $('art-side-code-content');
  const topbarBtn = $('btn-topbar-artifact');

  if (!sidebar) return;

  activeArtifact = { title, code, type, svg: customSvg };
  currentModalCode = code;

  if (titleEl) titleEl.textContent = title || (type === 'diagram' ? 'Visual Diagram' : 'Live Preview');
  if (badgeEl) {
    if (type === 'diagram') {
      badgeEl.className = 'artifact-badge diagram';
      badgeEl.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><rect width="6" height="6" x="3" y="3" rx="1"/><rect width="6" height="6" x="15" y="15" rx="1"/><path d="M6 9v3a3 3 0 0 0 3 3h6"/></svg> <span>DIAGRAM</span>`;
    } else {
      badgeEl.className = 'artifact-badge interactive';
      badgeEl.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg> <span>ARTIFACT</span>`;
    }
  }

  if (codeContent) codeContent.textContent = code;

  if (type === 'diagram') {
    if (iframe) iframe.style.display = 'none';
    if (diagContainer) diagContainer.style.display = 'flex';
    if (diagSvgWrap) {
      diagSvgWrap.innerHTML = customSvg || `<div style="padding:20px;color:#c9a87a;">Rendering diagram...</div>`;
      setupDiagramZoom(diagSvgWrap);
    }
  } else {
    if (diagContainer) diagContainer.style.display = 'none';
    if (iframe) {
      iframe.style.display = 'block';
      iframe.srcdoc = prepareArtifactHtml(code);
    }
  }

  switchArtifactSidebarTab('preview');
  sidebar.classList.add('open');

  if (topbarBtn) {
    topbarBtn.style.display = 'inline-flex';
    topbarBtn.classList.add('active');
  }

  if (window.innerWidth <= 768) {
    try { history.pushState({ modal: 'artifact' }, ''); } catch {}
  }

  window.dispatchEvent(new Event('resize'));
}

function closeArtifactSidebar(triggerPop = true) {
  const sidebar = $('artifact-sidebar');
  const topbarBtn = $('btn-topbar-artifact');
  if (sidebar) sidebar.classList.remove('open');
  if (topbarBtn) topbarBtn.classList.remove('active');
  if (triggerPop && history.state?.modal === 'artifact') {
    try { history.back(); } catch {}
  }
  window.dispatchEvent(new Event('resize'));
}

function toggleArtifactSidebar() {
  const sidebar = $('artifact-sidebar');
  if (sidebar && sidebar.classList.contains('open')) {
    closeArtifactSidebar();
  } else if (activeArtifact.code) {
    openArtifactSidebar(activeArtifact.title, activeArtifact.code, activeArtifact.type, activeArtifact.svg);
  }
}

function switchArtifactSidebarTab(tabName) {
  const tabPreviewBtn = $('art-side-tab-preview');
  const tabCodeBtn = $('art-side-tab-code');
  const previewPane = $('art-side-preview-pane');
  const codePane = $('art-side-code-pane');

  if (tabName === 'preview') {
    tabPreviewBtn?.classList.add('active');
    tabCodeBtn?.classList.remove('active');
    if (previewPane) previewPane.style.display = 'flex';
    if (codePane) codePane.style.display = 'none';
  } else {
    tabPreviewBtn?.classList.remove('active');
    tabCodeBtn?.classList.add('active');
    if (previewPane) previewPane.style.display = 'none';
    if (codePane) codePane.style.display = 'block';
  }
}

function downloadCurrentArtifact() {
  if (!activeArtifact.code) return;
  const isDiag = activeArtifact.type === 'diagram';
  const ext = isDiag ? 'svg' : 'html';
  const mime = isDiag ? 'image/svg+xml' : 'text/html';
  const filename = (activeArtifact.title || 'artifact').toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.' + ext;
  
  const content = isDiag && activeArtifact.svg ? activeArtifact.svg : activeArtifact.code;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

let diagScale = 1;
function setupDiagramZoom(container) {
  diagScale = 1;
  const svg = container.querySelector('svg');
  if (!svg) return;
  svg.style.transition = 'transform 0.15s ease';
  svg.style.transformOrigin = 'center center';
  svg.style.transform = 'scale(1)';

  const zoomIn = $('art-side-zoom-in');
  const zoomOut = $('art-side-zoom-out');
  const zoomReset = $('art-side-zoom-reset');

  if (zoomIn) zoomIn.onclick = () => {
    diagScale = Math.min(3, diagScale + 0.25);
    svg.style.transform = `scale(${diagScale})`;
  };
  if (zoomOut) zoomOut.onclick = () => {
    diagScale = Math.max(0.4, diagScale - 0.25);
    svg.style.transform = `scale(${diagScale})`;
  };
  if (zoomReset) zoomReset.onclick = () => {
    diagScale = 1;
    svg.style.transform = `scale(1)`;
  };
}

function setupArtifactSidebar() {
  const sidebar = $('artifact-sidebar');
  const closeBtn = $('art-side-close');
  const backBtn = $('art-side-back-btn');
  const floatingExitBtn = $('art-side-floating-exit');
  const topbarBtn = $('btn-topbar-artifact');
  const tabPreview = $('art-side-tab-preview');
  const tabCode = $('art-side-tab-code');
  const refreshBtn = $('art-side-refresh');
  const copyBtn = $('art-side-copy');
  const downloadBtn = $('art-side-download');

  closeBtn?.addEventListener('click', () => closeArtifactSidebar(true));
  backBtn?.addEventListener('click', () => closeArtifactSidebar(true));
  floatingExitBtn?.addEventListener('click', () => closeArtifactSidebar(true));
  topbarBtn?.addEventListener('click', toggleArtifactSidebar);

  tabPreview?.addEventListener('click', () => switchArtifactSidebarTab('preview'));
  tabCode?.addEventListener('click', () => switchArtifactSidebarTab('code'));

  refreshBtn?.addEventListener('click', () => {
    if (activeArtifact.type === 'diagram') {
      const diagSvgWrap = $('art-side-diagram-svg');
      if (diagSvgWrap && activeArtifact.svg) {
        diagSvgWrap.innerHTML = activeArtifact.svg;
        setupDiagramZoom(diagSvgWrap);
      }
    } else {
      const iframe = $('art-side-iframe');
      if (iframe && activeArtifact.code) {
        iframe.srcdoc = prepareArtifactHtml(activeArtifact.code);
      }
    }
  });

  copyBtn?.addEventListener('click', () => {
    if (activeArtifact.code) {
      navigator.clipboard.writeText(activeArtifact.code).catch(() => {});
      const origHtml = copyBtn.innerHTML;
      copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#68d391" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      copyBtn.style.borderColor = 'rgba(104, 211, 145, 0.5)';
      setTimeout(() => {
        copyBtn.innerHTML = origHtml;
        copyBtn.style.borderColor = '';
      }, 1600);
    }
  });

  downloadBtn?.addEventListener('click', downloadCurrentArtifact);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar?.classList.contains('open')) {
      closeArtifactSidebar();
    }
  });
}

function initArtifactsAndDiagrams(container = document) {
  if (!container) return;

  const artifactCards = container.querySelectorAll('.artifact-chat-card:not(.initialized)');
  let latestCardToOpen = null;

  artifactCards.forEach((card, idx) => {
    card.classList.add('initialized');
    const type = card.dataset.type || 'html';
    const code = card.dataset.code || '';
    const title = card.dataset.title || (type === 'diagram' ? 'Visual Diagram' : 'Live Interactive App');

    async function handleOpen() {
      if (type === 'diagram') {
        if (window.mermaid) {
          const diagramId = 'm_side_' + Math.random().toString(36).slice(2, 9) + '_' + idx;
          try {
            const { svg } = await window.mermaid.render(diagramId, code.trim());
            openArtifactSidebar(title, code, 'diagram', svg);
          } catch (err) {
            console.warn('Mermaid render issue in sidebar:', err);
            openArtifactSidebar(title, code, 'diagram', `<div style="padding:20px;color:#f08282;text-align:center;">⚠ Sintaks diagram tidak valid atau sedang dimuat.</div>`);
          }
        } else {
          openArtifactSidebar(title, code, 'diagram', `<div style="padding:20px;color:#c9a87a;">Memuat Mermaid...</div>`);
        }
      } else {
        openArtifactSidebar(title, code, 'html');
      }
    }

    card.addEventListener('click', (e) => {
      e.stopPropagation();
      handleOpen();
    });

    const openBtn = card.querySelector('.btn-open-artifact-sidebar');
    openBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleOpen();
    });

    latestCardToOpen = handleOpen;
  });

  // Auto-open on desktop if this is a newly streamed/added message and viewport is desktop (width > 768)
  if (latestCardToOpen && container !== document && window.innerWidth > 768) {
    setTimeout(() => {
      latestCardToOpen();
    }, 200);
  }
}

function openArtifactModal(title, code, type = 'html', customHtml = null) {
  openArtifactSidebar(title, code, type, customHtml);
}

function closeArtifactModal() {
  closeArtifactSidebar();
}

function setupArtifactModal() {
  // Retained for backward compatibility
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return String(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function setupCopyBtn(btn) {
  btn.addEventListener('click', () => {
    const code = btn.dataset.code || btn.closest('.code-block-wrapper, .mermaid-block-wrapper, .artifact-block-wrapper')?.querySelector('code')?.textContent || '';
    navigator.clipboard.writeText(code).catch(() => {});
    btn.textContent = 'Copied!'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}

function setupActionCards() {
  document.addEventListener('click', e => {
    // Toggle button or Header clicked: toggle open/closed (minimize / expand)
    const hdr = e.target.closest('.action-card-header');
    if (!hdr) return;

    const card = hdr.closest('.action-card');
    if (!card) return;

    const isOpen = card.classList.contains('open');
    const tog = card.querySelector('.action-card-toggle');
    const label = card.querySelector('.action-btn-label');
    const isTerminal = card.classList.contains('terminal-card');

    if (isOpen) {
      // Minimize / Close output
      card.classList.remove('open');
      if (tog) tog.textContent = '▼';
      if (label) label.textContent = isTerminal ? 'Tampilkan' : 'Detail';
    } else {
      // Expand / Show output
      card.classList.add('open');
      if (tog) tog.textContent = '▲';
      if (label) label.textContent = 'Ciutkan';
    }
  });
}

// ── Image Lightbox Modal ───────────────────────────────
function resetLightboxVisuals() {
  const overlay = $('image-lightbox-overlay');
  const container = $('image-lightbox-container');
  const img = $('lightbox-img');
  if (container) {
    container.style.transition = '';
    container.style.transform = '';
    container.style.opacity = '';
  }
  if (img) {
    img.style.transition = '';
    img.style.transform = '';
  }
  if (overlay) {
    overlay.style.transition = '';
    overlay.style.backgroundColor = '';
  }
}

function closeImageLightbox(triggerPop = true) {
  const overlay = $('image-lightbox-overlay');
  if (overlay) overlay.style.display = 'none';
  resetLightboxVisuals();
  if (triggerPop && history.state?.modal === 'lightbox') {
    try { history.back(); } catch {}
  }
}

function openImageLightbox(src, caption) {
  const overlay = $('image-lightbox-overlay');
  const img = $('lightbox-img');
  const cap = $('lightbox-prompt-text');
  const dl = $('lightbox-download-link');
  if (!overlay || !img) return;

  resetLightboxVisuals();
  img.src = src;
  if (cap) cap.textContent = caption || 'Preview Gambar';
  if (dl) {
    dl.href = src;
    dl.download = src.split('/').pop() || 'gambar.png';
  }
  overlay.style.display = 'flex';

  if (window.innerWidth <= 768) {
    try { history.pushState({ modal: 'lightbox' }, ''); } catch {}
  }
}

function setupImageLightbox() {
  const overlay = $('image-lightbox-overlay');
  const closeBtn = $('lightbox-close-btn');
  const backBtn = $('lightbox-back-btn');
  const floatingCloseBtn = $('lightbox-floating-close-btn');

  closeBtn?.addEventListener('click', () => {
    resetLightboxVisuals();
    closeImageLightbox(true);
  });
  backBtn?.addEventListener('click', () => {
    resetLightboxVisuals();
    closeImageLightbox(true);
  });
  floatingCloseBtn?.addEventListener('click', () => {
    resetLightboxVisuals();
    closeImageLightbox(true);
  });

  // Tapping overlay background (outside header and image) closes lightbox
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('image-lightbox-body')) {
      closeImageLightbox(true);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay?.style.display === 'flex') {
      closeImageLightbox(true);
    }
  });

  // Global mobile back navigation (Android Back & iOS Safari edge-swipe)
  window.addEventListener('popstate', () => {
    const sidebar = $('artifact-sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
      closeArtifactSidebar(false);
    }
    const lbOverlay = $('image-lightbox-overlay');
    if (lbOverlay && lbOverlay.style.display === 'flex') {
      closeImageLightbox(false);
    }
  });

  // ── Swipe-Down to Close Gesture (Mobile Touch + Pointer) ──
  let startY = 0;
  let startX = 0;
  let startTime = 0;
  let isSwiping = false;
  let currentDeltaY = 0;
  let isPointerDown = false;

  function handleGestureStart(clientX, clientY, target) {
    if (target.closest('.lightbox-actions, a, button')) return false;
    startY = clientY;
    startX = clientX;
    startTime = Date.now();
    isSwiping = false;
    currentDeltaY = 0;
    const container = $('image-lightbox-container');
    if (container) container.style.transition = 'none';
    if (overlay) overlay.style.transition = 'none';
    return true;
  }

  function handleGestureMove(clientX, clientY, e) {
    const deltaY = clientY - startY;
    const deltaX = clientX - startX;

    if (!isSwiping) {
      if (deltaY > 6 && deltaY > Math.abs(deltaX) * 1.1) {
        isSwiping = true;
      }
    }

    if (isSwiping && deltaY > 0) {
      if (e.cancelable) e.preventDefault();
      currentDeltaY = deltaY;
      const visualY = deltaY / (1 + (deltaY / 450));
      const scale = Math.max(0.75, 1 - (deltaY / 1500));
      const bgAlpha = Math.max(0.12, 0.96 * (1 - (deltaY / 450)));
      const container = $('image-lightbox-container');
      if (container) {
        container.style.transform = `translate3d(0, ${visualY}px, 0) scale(${scale})`;
      }
      if (overlay) {
        overlay.style.backgroundColor = `rgba(0, 0, 0, ${bgAlpha.toFixed(3)})`;
      }
    }
  }

  function handleGestureEnd() {
    if (!isSwiping) return;
    isSwiping = false;
    const elapsed = Math.max(Date.now() - startTime, 1);
    const velocity = currentDeltaY / elapsed;
    const container = $('image-lightbox-container');

    if (currentDeltaY > 65 || (currentDeltaY > 25 && velocity > 0.3)) {
      if (container) {
        container.style.transition = 'transform 0.22s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.2s ease';
        container.style.transform = `translate3d(0, ${window.innerHeight}px, 0) scale(0.65)`;
        container.style.opacity = '0';
      }
      if (overlay) {
        overlay.style.transition = 'background-color 0.2s ease';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
      }
      setTimeout(() => {
        closeImageLightbox(true);
      }, 220);
    } else {
      if (container) {
        container.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2), opacity 0.2s ease';
        container.style.transform = 'translate3d(0, 0, 0) scale(1)';
        container.style.opacity = '1';
      }
      if (overlay) {
        overlay.style.transition = 'background-color 0.2s ease';
        overlay.style.backgroundColor = '';
      }
    }
  }

  // Touch Events for Mobile (Swipe Down to close)
  overlay?.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      handleGestureStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
    }
  }, { passive: true });

  overlay?.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      handleGestureMove(e.touches[0].clientX, e.touches[0].clientY, e);
    }
  }, { passive: false });

  overlay?.addEventListener('touchend', () => {
    handleGestureEnd();
  }, { passive: true });

  // Pointer events for desktop mouse drag down
  overlay?.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button === 0) {
      isPointerDown = handleGestureStart(e.clientX, e.clientY, e.target);
    }
  });

  overlay?.addEventListener('pointermove', (e) => {
    if (isPointerDown && e.pointerType === 'mouse') {
      handleGestureMove(e.clientX, e.clientY, e);
    }
  });

  overlay?.addEventListener('pointerup', (e) => {
    if (isPointerDown && e.pointerType === 'mouse') {
      isPointerDown = false;
      handleGestureEnd();
    }
  });

  overlay?.addEventListener('pointercancel', (e) => {
    if (isPointerDown && e.pointerType === 'mouse') {
      isPointerDown = false;
      handleGestureEnd();
    }
  });
}

// ── Mobile Viewport & Virtual Keyboard Handler (iOS ChatGPT standard) ──
function setupMobileViewport() {
  if (!window.visualViewport) return;
  const vp = window.visualViewport;

  const onViewportResize = () => {
    if (window.innerWidth > 768) return;
    const msgs = $$('.chat-messages');
    if (document.activeElement === $('chat-input') && msgs) {
      setTimeout(() => {
        msgs.scrollTop = msgs.scrollHeight;
      }, 100);
    }
  };

  vp.addEventListener('resize', onViewportResize);
  vp.addEventListener('scroll', onViewportResize);
}

// streaming cursor style
const style = document.createElement('style');
style.textContent = `
  .stream-cursor { display:inline-block; width:2px; height:1em; background:var(--accent); margin-left:1px; vertical-align:middle; animation:blink .7s step-end infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  .tool-pending-card { display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:13px; color:var(--text-muted); font-family:var(--font-mono); background:var(--bg-agent-msg); border:1px solid var(--border); border-radius:var(--radius-md); }
  .tool-pending-label { color:var(--text-primary); }
  .tool-pending-dots { display:flex; gap:3px; align-items:center; }
  .tool-screenshot { border:1px solid var(--border); border-radius:var(--radius-sm); overflow:hidden; }
  .tool-card-header { display:flex; align-items:center; justify-content:space-between; padding:6px 12px; background:rgba(0,0,0,0.2); border-bottom:1px solid var(--border); }
  .tool-card-label { font-family:var(--font-mono); font-size:11px; color:var(--text-subtle); text-transform:uppercase; letter-spacing:.06em; }
  .tool-status-ok { color:#7ab87a; font-size:12px; }
  .chat-image { cursor:zoom-in; transition:max-width .2s; }
  .chat-image-full { max-width:100% !important; max-height:80vh !important; cursor:zoom-out; }
`;
document.head.appendChild(style);
// -----------------------------------------------------------
