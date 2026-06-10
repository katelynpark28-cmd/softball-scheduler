// ============================================================
// Brown Softball — shared site logic
// ============================================================

// Store: Firestore-backed with in-memory cache for synchronous reads.
// Call Store.init(db) once (in the boot sequence) before any page code runs.
const Store = {
  _cache: {},
  _db: null,

  async init(db) {
    this._db = db;
    try {
      const snapshot = await db.collection('store').get();
      snapshot.forEach(doc => { this._cache[doc.id] = doc.data().value; });
    } catch (e) { console.warn('Firestore load error:', e); }

    // Live listener — keeps cache fresh when other clients write
    db.collection('store').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type !== 'removed') {
          const key = change.doc.id;
          const incoming = change.doc.data().value;
          if (JSON.stringify(this._cache[key]) !== JSON.stringify(incoming)) {
            this._cache[key] = incoming;
            if (key === 'messages' || key === 'chats') {
              try { updateDmBadge(); } catch (_) {}
            }
          }
        }
      });
    }, () => {});
  },

  get(key, fallback = null) {
    const v = this._cache[key];
    return v !== undefined ? v : fallback;
  },

  set(key, value) {
    this._cache[key] = value;
    if (this._db) {
      this._db.collection('store').doc(key).set({ value })
        .catch(e => console.warn('Firestore write error:', e));
    }
  },

  remove(key) {
    delete this._cache[key];
    if (this._db) this._db.collection('store').doc(key).delete().catch(() => {});
  }
};

// ============================================================
// Auth
// ============================================================
const Auth = {
  // Dev-mode tab override (sessionStorage) wins over the real Firebase user.
  // Lets you view two accounts at once in separate tabs during testing.
  currentUser() {
    const tabId = sessionStorage.getItem('bsb.tabUserId');
    if (tabId) return Store.get('users', []).find(u => u.id === tabId) || null;
    const fbUser = window.fbAuth?.currentUser;
    if (!fbUser) return null;
    const email = (fbUser.email || '').toLowerCase();
    return Store.get('users', []).find(u => (u.email || '').toLowerCase() === email) || null;
  },
  signOut() {
    sessionStorage.removeItem('bsb.tabUserId');
    window.fbAuth?.signOut().finally(() => { location.href = 'signin.html'; });
  },
  requireAuth() {
    if (!window.fbAuth?.currentUser) { location.href = 'signin.html'; return false; }
    return true;
  },
  isPlayer()      { return this.currentUser()?.role === 'player'; },
  isCoach()       { return this.currentUser()?.role === 'coach'; },
  isTabOverride() { return !!sessionStorage.getItem('bsb.tabUserId'); },
  setTabUser(id)  {
    if (id) sessionStorage.setItem('bsb.tabUserId', id);
    else    sessionStorage.removeItem('bsb.tabUserId');
  },
  isDevMode() { return sessionStorage.getItem('bsb.dev') === '1'; },
};

// Honor ?dev=1/0 and ?as=USER_ID, then strip them from the URL.
function applyUrlFlags() {
  const params = new URLSearchParams(location.search);
  let changed = false;

  const dev = params.get('dev');
  if (dev === '1') {
    sessionStorage.setItem('bsb.dev', '1');
    params.delete('dev'); changed = true;
  } else if (dev === '0') {
    sessionStorage.removeItem('bsb.dev');
    sessionStorage.removeItem('bsb.tabUserId'); // dropping dev also drops any override
    params.delete('dev'); changed = true;
  }

  const asId = params.get('as');
  if (asId) {
    if (Auth.isDevMode()) {
      const users = Store.get('users', []);
      if (users.some(u => u.id === asId)) Auth.setTabUser(asId);
    }
    params.delete('as'); changed = true;
  }

  if (changed) {
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  }
}

// ============================================================
// Helpers
// ============================================================
function getUser(id) {
  return Store.get('users', []).find(u => u.id === id) || null;
}
function getAllUsers() { return Store.get('users', []); }
function getSessions() { return Store.get('sessions', []); }
function saveSessions(s) { Store.set('sessions', s); }
function getPractices() { return Store.get('practices', []); }
function savePractices(p) { Store.set('practices', p); }
function getAnnouncements() { return Store.get('announcements', []); }
function saveAnnouncements(a) { Store.set('announcements', a); }
function postAnnouncement(text, type) {
  const user = Auth.currentUser();
  const list = getAnnouncements();
  list.unshift({ id: 'a_' + Date.now(), text, type: type || 'manual', authorId: user?.id || null, timestamp: Date.now() });
  saveAnnouncements(list);
}

// ---- Chats (1:1 + group) ----
function getChats() { return Store.get('chats', []); }
function saveChats(c) { Store.set('chats', c); }
function getChat(id) { return getChats().find(c => c.id === id); }

function find1to1Chat(uidA, uidB) {
  const key = [uidA, uidB].sort().join('|');
  return getChats().find(c =>
    c.participants.length === 2 &&
    [...c.participants].sort().join('|') === key
  );
}

function newChatId() {
  return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

function ensure1to1Chat(uidA, uidB) {
  let chat = find1to1Chat(uidA, uidB);
  if (chat) return chat;
  chat = {
    id: newChatId(),
    participants: [uidA, uidB],
    name: null,
    createdAt: Date.now(),
    createdBy: uidA,
  };
  const chats = getChats();
  chats.push(chat);
  saveChats(chats);
  return chat;
}

function createCustomChat(participants, name, createdBy) {
  const chat = {
    id: newChatId(),
    participants: [...participants],
    name: name || null,
    createdAt: Date.now(),
    createdBy,
  };
  const chats = getChats();
  chats.push(chat);
  saveChats(chats);
  return chat;
}

function chatsForUser(uid) {
  return getChats().filter(c => c.participants.includes(uid));
}

function msgsInChat(chatId) {
  return Store.get('messages', [])
    .filter(m => m.chatId === chatId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function lastMsgInChat(chatId) {
  const list = msgsInChat(chatId);
  return list.length ? list[list.length - 1] : null;
}

function unreadInChat(chatId, uid) {
  return Store.get('messages', []).filter(m =>
    m.chatId === chatId &&
    m.fromUserId !== uid &&
    !(m.readBy || []).includes(uid)
  ).length;
}

// One-time migration: convert legacy 1:1 messages ({fromUserId, toUserId, read})
// into chat-based messages ({chatId, fromUserId, readBy}). Idempotent.
function migrateMessagesToChats() {
  const msgs = Store.get('messages', []);
  if (msgs.length === 0) return;
  if (msgs.every(m => m.chatId)) return;
  let dirty = false;
  msgs.forEach(m => {
    if (m.chatId || !m.toUserId) return;
    const chat = ensure1to1Chat(m.fromUserId, m.toUserId);
    m.chatId = chat.id;
    m.readBy = m.read ? [m.toUserId] : [];
    dirty = true;
  });
  if (dirty) Store.set('messages', msgs);
}

function autoGroupName(others) {
  const names = others.map(u => u.firstName);
  if (names.length === 0) return 'Empty group';
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(' & ');
  if (names.length === 3) return names.join(', ');
  return names.slice(0, 2).join(', ') + ' & ' + (names.length - 2) + ' others';
}

// ---- Toast ----
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 1800);
}

// ============================================================
// Notifications
// ============================================================
function startNotifications() {
  const user = Auth.currentUser();
  if (!user) return;

  // Initial state: every existing incoming message is "already seen"
  // (we only notify for messages that arrive after page load)
  const myChatIds = new Set(chatsForUser(user.id).map(c => c.id));
  window._seenMsgIds = new Set(
    Store.get('messages', [])
      .filter(m => myChatIds.has(m.chatId) && m.fromUserId !== user.id)
      .map(m => m.id)
  );

  updateDmBadge();

  // Ask for browser notification permission on first user interaction
  // (browsers block the prompt if it's not user-initiated)
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    const askOnce = () => {
      if (Notification.permission === 'default') Notification.requestPermission();
    };
    document.addEventListener('click', askOnce, { once: true });
  }

  // Poll for new incoming DMs every 2.5s
  setInterval(checkForNewMessages, 2500);
}

function checkForNewMessages() {
  const user = Auth.currentUser();
  if (!user) return;
  const myChatIds = new Set(chatsForUser(user.id).map(c => c.id));
  const incoming = Store.get('messages', []).filter(m =>
    myChatIds.has(m.chatId) && m.fromUserId !== user.id
  );
  const fresh = incoming.filter(m => !window._seenMsgIds.has(m.id));

  fresh.forEach(m => {
    const sender = getUser(m.fromUserId);
    if (sender) notifyNewMessage(sender, m);
    window._seenMsgIds.add(m.id);
  });

  if (fresh.length > 0) {
    updateDmBadge();
    // If conversation list is visible, refresh it
    if (document.body.dataset.page === 'messages') {
      const convList = document.getElementById('conv-list');
      if (convList && convList.style.display !== 'none') renderConversationList();
    }
  }
}

function notifyNewMessage(sender, msg) {
  const params = new URLSearchParams(location.search);
  const onMessagesPage = document.body.dataset.page === 'messages';
  const inThisChat = onMessagesPage && (
    params.get('chat') === msg.chatId ||
    params.get('with') === sender.id // legacy URL pointing at the same 1:1
  );
  if (inThisChat) return; // already viewing this convo

  const chat = getChat(msg.chatId);
  const isGroup = chat && chat.participants.length > 2;
  const preview = msg.text.length > 60 ? msg.text.slice(0, 57) + '…' : msg.text;
  const headPrefix = isGroup
    ? `${sender.firstName} · ${chat.name || autoGroupName(chat.participants.filter(p => p !== sender.id).map(getUser).filter(Boolean))}`
    : sender.firstName;
  toast(`${headPrefix}: ${preview}`);

  if (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted' &&
    !document.hasFocus()
  ) {
    try {
      const n = new Notification(headPrefix, {
        body: msg.text,
        tag: 'dm-' + msg.chatId,
        icon: '',
      });
      n.onclick = () => {
        window.focus();
        location.href = 'messages.html?chat=' + encodeURIComponent(msg.chatId);
      };
    } catch (e) {}
  }
}

function updateDmBadge() {
  const user = Auth.currentUser();
  if (!user) return;
  const myChatIds = new Set(chatsForUser(user.id).map(c => c.id));
  const unread = Store.get('messages', []).filter(m =>
    myChatIds.has(m.chatId) &&
    m.fromUserId !== user.id &&
    !(m.readBy || []).includes(user.id)
  ).length;

  // Tab bar badge
  document.querySelectorAll('a.tab[href="messages.html"]').forEach(tab => {
    let badge = tab.querySelector('.tab-badge');
    if (unread > 0) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'tab-badge';
        tab.appendChild(badge);
      }
      badge.innerHTML = `<span>${unread > 9 ? '9+' : String(unread)}</span>`;
    } else if (badge) {
      badge.remove();
    }
  });

  // Document title prefix
  const baseTitle = document.title.replace(/^\(\d+\+?\)\s*/, '');
  document.title = unread > 0 ? `(${unread > 9 ? '9+' : unread}) ${baseTitle}` : baseTitle;

  // Home menu DM badge
  const homeMenuItem = document.querySelector('a.menu-item[href="messages.html"]');
  if (homeMenuItem) {
    const arrow = homeMenuItem.querySelector('.menu-arrow');
    let badge = homeMenuItem.querySelector('.menu-badge');
    if (unread > 0) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'menu-badge';
        if (arrow) arrow.before(badge);
      }
      badge.innerHTML = `<span>${unread > 9 ? '9+' : String(unread)}</span>`;
    } else if (badge) {
      badge.remove();
    }
  }
}

// ============================================================
// Shared top-bar
// ============================================================
function renderTopbar() {
  const user = Auth.currentUser();
  if (!user) return;
  const meEl = document.querySelector('.me');
  if (!meEl) return;
  meEl.textContent = user.initials;
  meEl.style.background = user.color;
  meEl.style.cursor = 'pointer';

  if (!document.querySelector('.usermenu')) {
    const menu = document.createElement('div');
    menu.className = 'usermenu';
    const overrideOn = Auth.isTabOverride();
    const devOn = Auth.isDevMode();
    menu.innerHTML = `
      <div class="usermenu-head">
        <div class="usermenu-name">${user.name} <span class="role-badge ${user.role}">${user.role === 'coach' ? 'Coach' : 'Player'}</span></div>
        <div class="usermenu-role">${getAllUsers().length} on the team</div>
      </div>
      <button id="editname">✏️ Edit display name</button>
      ${devOn ? '<button id="switchtab">Switch user (this tab)</button>' : ''}
      ${devOn && overrideOn ? '<button id="resettab">← Back to my account</button>' : ''}
      <button class="danger" id="signout">Sign out</button>
    `;
    document.body.appendChild(menu);
    document.getElementById('signout').addEventListener('click', () => Auth.signOut());
    document.getElementById('editname').addEventListener('click', () => {
      menu.classList.remove('show');
      openEditNameModal();
    });
    document.getElementById('switchtab')?.addEventListener('click', () => {
      menu.classList.remove('show');
      openTabSwitcher();
    });
    document.getElementById('resettab')?.addEventListener('click', () => {
      Auth.setTabUser(null);
      location.reload();
    });
    meEl.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('show');
    });
    document.addEventListener('click', () => menu.classList.remove('show'));
  }

  injectTestBanner();
  injectDevSwitch();
}

function injectDevSwitch() {
  if (!Auth.isDevMode()) return;
  if (document.querySelector('.dev-switch')) return;
  const user = Auth.currentUser();
  if (!user) return;

  const users = getAllUsers();
  const targetRole = user.role === 'coach' ? 'player' : 'coach';
  const targetLabel = targetRole === 'coach' ? 'Coach' : 'Player';
  const target = users.find(u => u.role === targetRole && u.id !== user.id);
  const realId = Store.get('currentUserId', null);

  const btn = document.createElement('button');
  btn.className = 'dev-switch';
  btn.title = target
    ? `Switch this tab to ${target.name}`
    : `Create a test ${targetLabel.toLowerCase()} and switch to them`;
  btn.innerHTML = `
    <span class="dev-switch-arrow">⇄</span>
    <span>View as ${targetLabel}</span>
  `;
  btn.addEventListener('click', () => {
    let id;
    if (target) {
      id = target.id;
    } else {
      // No counterpart yet — auto-create a stub of the opposite role
      const list = getAllUsers();
      const PLAYER_COLORS = ['#d62828', '#4a7d3e', '#c7912d', '#4a5a6b', '#b8302a', '#7a4ca3', '#1a6b8c'];
      const color = targetRole === 'coach'
        ? '#3d2817'
        : PLAYER_COLORS[list.filter(u => u.role === 'player').length % PLAYER_COLORS.length];
      const name = targetRole === 'coach' ? 'Test Coach' : 'Test Player';
      const newUser = {
        id: 'u_test_' + targetRole + '_' + Date.now(),
        name,
        firstName: name.split(' ')[0],
        initials: name.split(' ').map(w => w[0]).join('').toUpperCase(),
        role: targetRole,
        color,
        email: '',
        password: '',
        createdAt: Date.now(),
      };
      list.push(newUser);
      Store.set('users', list);
      id = newUser.id;
    }
    // Selecting your real account just clears the override
    Auth.setTabUser(id === realId ? null : id);
    location.reload();
  });
  document.body.appendChild(btn);
}

function injectTestBanner() {
  if (!Auth.isDevMode()) return;
  if (!Auth.isTabOverride()) return;
  if (document.querySelector('.test-banner')) return;
  const app = document.querySelector('.app');
  if (!app) return;
  const user = Auth.currentUser();
  if (!user) return;
  const banner = document.createElement('div');
  banner.className = 'test-banner';
  banner.innerHTML = `
    <span class="test-tag">Test view</span>
    <span class="test-text">Viewing as <strong>${escapeHtml(user.firstName)}</strong></span>
    <button class="test-exit" type="button">Exit</button>
  `;
  app.insertBefore(banner, app.firstChild);
  banner.querySelector('.test-exit').addEventListener('click', () => {
    Auth.setTabUser(null);
    location.reload();
  });
}

function openTabSwitcher() {
  const currentId = Auth.currentUser()?.id;
  const realId = Store.get('currentUserId', null);
  const users = getAllUsers();
  let modal = document.getElementById('tab-switcher-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'tab-switcher-modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title">Switch user (this tab)</div>
      <div class="modal-sub">Only this tab will see this account. Other tabs keep your real sign-in. Handy for testing the player and coach views side by side.</div>
      <div class="signin-list">
        ${users.map(u => `
          <button type="button" class="signin-row ${u.role === 'coach' ? 'coach' : ''} ${u.id === currentId ? 'selected' : ''}" data-id="${u.id}">
            <div class="pip" style="background:${u.color}">${u.initials}</div>
            <div>
              <div class="signin-name">${escapeHtml(u.name)}</div>
              <div class="signin-role">${u.role === 'coach' ? 'Coach' : 'Player'}${u.id === currentId ? ' · current' : ''}${u.id === realId ? ' · your account' : ''}</div>
            </div>
          </button>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button type="button" id="tab-switch-cancel">Close</button>
      </div>
    </div>
  `;
  modal.classList.add('show');
  const close = () => modal.classList.remove('show');
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#tab-switch-cancel').addEventListener('click', close);
  modal.querySelectorAll('.signin-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      // If picking the "real" sign-in, drop the override so this tab tracks normally.
      Auth.setTabUser(id === realId ? null : id);
      location.reload();
    });
  });
}

// ============================================================
// HOME
// ============================================================
function initHome() {
  const user = Auth.currentUser();
  const users = getAllUsers();
  const practices = getPractices();
  const msgs = Store.get('messages', []);

  // Hero
  const heroEl = document.getElementById('home-title');
  if (heroEl) {
    heroEl.innerHTML = user.role === 'coach'
      ? `Coach <span class="accent">${user.firstName}</span>.`
      : `Hey <span class="accent">${user.firstName}</span>.`;
  }

  // Tagline
  const tagline = document.getElementById('home-tagline');
  if (tagline) {
    const unread = msgs.filter(m => m.toUserId === user.id && !m.read).length;
    const unreadStr = unread > 0 ? ` ${unread} new message${unread === 1 ? '' : 's'}.` : '';
    if (practices.length === 0) {
      tagline.textContent = `${users.length} on the team.${unreadStr}`;
    } else {
      const next = practices[0];
      tagline.textContent = `Next practice ${next.dow} at ${next.time}.${unreadStr}`;
    }
  }

  // Stats
  const stats = document.querySelector('.home-stats');
  if (stats) {
    const totalPlayers = users.filter(u => u.role === 'player').length;
    const totalCoaches = users.filter(u => u.role === 'coach').length;
    const goingNext = practices[0]?.attendees?.length || 0;
    stats.innerHTML = `
      <div class="stat"><div class="stat-num">${totalPlayers}</div><div class="stat-label">Players</div></div>
      <div class="stat"><div class="stat-num">${totalCoaches}</div><div class="stat-label">Coaches</div></div>
      <div class="stat"><div class="stat-num">${goingNext}</div><div class="stat-label">Next practice</div></div>
    `;
  }

  // Next-up peek
  const peek = document.getElementById('home-peek');
  if (peek) {
    if (practices.length === 0) {
      peek.style.display = 'none';
    } else {
      const next = practices[0];
      const coach = getUser(next.coachId);
      const attendees = (next.attendees || []).map(getUser).filter(Boolean);
      const visible = attendees.slice(0, 4);
      const extra = attendees.length - visible.length;
      const pips = visible.map(u =>
        `<div class="pip" style="background:${u.color}">${u.initials}</div>`
      ).join('') + (extra > 0 ? `<div class="pip more">+${extra}</div>` : '');
      const userIn = attendees.some(u => u.id === user.id);
      peek.style.display = 'block';
      peek.innerHTML = `
        <div class="peek-tag">★ Next up</div>
        <div class="peek-title">${next.dow} · ${next.time}</div>
        <div class="peek-sub">${next.location}${coach ? ' · Coach ' + coach.firstName : ''}</div>
        <div class="peek-row">
          <div class="roster">${pips || '<div class="pip more">?</div>'}</div>
          <button class="peek-cta">${userIn ? "You're in" : 'Tap to join'}</button>
        </div>
      `;
    }
  }

  // Role-aware menu copy
  if (user.role === 'coach') {
    const msgDesc = document.querySelector('a[href="messages.html"] .menu-desc');
    if (msgDesc) msgDesc.textContent = 'Private chats with your players';
    const pracDesc = document.querySelector('a[href="practices.html"] .menu-desc');
    if (pracDesc) pracDesc.textContent = 'Schedule team practices';
    const calDesc = document.querySelector('a[href="calendars.html"] .menu-desc');
    if (calDesc) calDesc.textContent = 'Mark your coaching hours';
  }
}

// ============================================================
// MESSAGES (Team chat)
// ============================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function formatMsgTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
}

function renderConversationList() {
  const list = document.getElementById('conv-list');
  if (!list) return;
  const user = Auth.currentUser();
  const users = getAllUsers();

  // Build entries from persisted chats user participates in
  const persisted = chatsForUser(user.id);
  const persistedEntries = persisted.map(c => {
    const last = lastMsgInChat(c.id);
    const otherIds = c.participants.filter(pid => pid !== user.id);
    return {
      kind: 'chat',
      chat: c,
      others: otherIds.map(id => users.find(u => u.id === id)).filter(Boolean),
      lastMsg: last,
      lastTs: last?.timestamp || c.createdAt,
      unread: unreadInChat(c.id, user.id),
    };
  });

  // Synthesize 1:1 entries for default counterparts that don't have a chat yet.
  //   Player → coaches, Coach → players
  const defaultRole = user.role === 'coach' ? 'player' : 'coach';
  const defaultUsers = users.filter(u => u.id !== user.id && u.role === defaultRole);
  const persistedOtherIds = new Set(
    persisted
      .filter(c => c.participants.length === 2)
      .flatMap(c => c.participants.filter(pid => pid !== user.id))
  );
  const synthEntries = defaultUsers
    .filter(u => !persistedOtherIds.has(u.id))
    .map(u => ({ kind: 'synth', other: u, lastTs: 0, unread: 0 }));

  const all = [...persistedEntries, ...synthEntries];

  if (all.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="empty-title">No conversations yet</div>
        <div class="empty-sub">Tap "New chat" above to start one.</div>
      </div>
    `;
    return;
  }

  all.sort((a, b) => {
    if (b.lastTs !== a.lastTs) return b.lastTs - a.lastTs;
    const an = a.other?.name || a.others?.[0]?.name || a.chat?.name || '';
    const bn = b.other?.name || b.others?.[0]?.name || b.chat?.name || '';
    return an.localeCompare(bn);
  });

  list.innerHTML = all.map(e => convEntryHtml(e, user)).join('');
}

function convEntryHtml(e, user) {
  if (e.kind === 'synth') {
    const c = e.other;
    const role = c.role === 'coach'
      ? '<span class="role-badge coach">Coach</span>'
      : '<span class="role-badge player">Player</span>';
    return `
      <a class="conv-item" href="messages.html?with=${encodeURIComponent(c.id)}">
        <div class="pip" style="background:${c.color}">${c.initials}</div>
        <div class="conv-body">
          <div class="conv-head">
            <div class="conv-name">${escapeHtml(c.firstName)} ${role}</div>
            <div class="conv-time"></div>
          </div>
          <div class="conv-preview">Tap to start a conversation</div>
        </div>
      </a>
    `;
  }

  const { chat, others, lastMsg, unread } = e;
  const time = lastMsg ? formatMsgTime(lastMsg.timestamp) : '';
  const isGroup = chat.participants.length > 2;

  const previewPrefix = lastMsg
    ? (lastMsg.fromUserId === user.id
        ? 'You: '
        : (isGroup ? (getUser(lastMsg.fromUserId)?.firstName || '') + ': ' : ''))
    : '';
  const preview = lastMsg ? previewPrefix + lastMsg.text : 'Tap to start a conversation';

  if (!isGroup) {
    const c = others[0];
    if (!c) return '';
    const role = c.role === 'coach'
      ? '<span class="role-badge coach">Coach</span>'
      : '<span class="role-badge player">Player</span>';
    return `
      <a class="conv-item" href="messages.html?chat=${encodeURIComponent(chat.id)}">
        <div class="pip" style="background:${c.color}">${c.initials}</div>
        <div class="conv-body">
          <div class="conv-head">
            <div class="conv-name">${escapeHtml(c.firstName)} ${role}</div>
            <div class="conv-time">${time}</div>
          </div>
          <div class="conv-preview ${unread ? 'unread' : ''}">${escapeHtml(preview)}</div>
        </div>
        ${unread ? '<div class="conv-unread-dot"></div>' : ''}
      </a>
    `;
  }

  // Group
  const name = chat.name || autoGroupName(others);
  const visible = others.slice(0, 3);
  const extra = others.length - visible.length;
  const pips = visible.map(u =>
    `<div class="pip" style="background:${u.color}">${u.initials}</div>`
  ).join('') + (extra > 0 ? `<div class="pip more">+${extra}</div>` : '');

  return `
    <a class="conv-item conv-group" href="messages.html?chat=${encodeURIComponent(chat.id)}">
      <div class="conv-group-pips">${pips}</div>
      <div class="conv-body">
        <div class="conv-head">
          <div class="conv-name">${escapeHtml(name)} <span class="conv-group-tag">${chat.participants.length}</span></div>
          <div class="conv-time">${time}</div>
        </div>
        <div class="conv-preview ${unread ? 'unread' : ''}">${escapeHtml(preview)}</div>
      </div>
      ${unread ? '<div class="conv-unread-dot"></div>' : ''}
    </a>
  `;
}

function renderConversation(chat) {
  const container = document.getElementById('messages');
  if (!container) return;
  const user = Auth.currentUser();

  // Mark received messages as read (only persisted chats — drafts have no id yet)
  if (chat?.id) {
    const all = Store.get('messages', []);
    let dirty = false;
    all.forEach(m => {
      if (m.chatId !== chat.id) return;
      if (m.fromUserId === user.id) return;
      m.readBy = m.readBy || [];
      if (!m.readBy.includes(user.id)) {
        m.readBy.push(user.id);
        dirty = true;
      }
    });
    if (dirty) {
      Store.set('messages', all);
      if (typeof updateDmBadge === 'function') updateDmBadge();
    }
  }

  const msgs = chat?.id ? msgsInChat(chat.id) : [];
  const isGroup = chat && chat.participants.length > 2;

  if (msgs.length === 0) {
    const others = chat ? chat.participants.filter(p => p !== user.id).map(getUser).filter(Boolean) : [];
    const intro = isGroup
      ? `Say hi to ${autoGroupName(others)}`
      : (others[0] ? (others[0].role === 'coach' ? 'Ask Coach ' + others[0].firstName + ' about practice' : 'Say hi to ' + others[0].firstName) : 'Start the conversation');
    container.innerHTML = `
      <div class="empty" style="margin-top:20px">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="empty-title">Start the conversation</div>
        <div class="empty-sub">${escapeHtml(intro)}</div>
      </div>
    `;
    return;
  }

  // Group consecutive messages from the same person within 5 minutes
  const groups = [];
  msgs.forEach(m => {
    const last = groups[groups.length - 1];
    if (last && last.fromUserId === m.fromUserId && (m.timestamp - last.lastTs) < 5 * 60 * 1000) {
      last.messages.push(m);
      last.lastTs = m.timestamp;
    } else {
      groups.push({ fromUserId: m.fromUserId, messages: [m], lastTs: m.timestamp });
    }
  });

  container.innerHTML = groups.map(g => {
    const sender = getUser(g.fromUserId);
    if (!sender) return '';
    const isMine = sender.id === user.id;
    const bubbles = g.messages.map(m => `<div class="msg-bubble">${escapeHtml(m.text)}</div>`).join('');
    const time = `<div class="msg-time">${formatMsgTime(g.lastTs)}</div>`;
    if (isMine) {
      return `<div class="msg-group mine"><div class="msg-stack">${bubbles}${time}</div></div>`;
    }
    const senderLabel = isGroup
      ? `<div class="msg-sender">${escapeHtml(sender.firstName)}${sender.role === 'coach' ? ' <span class="msg-sender-tag">Coach</span>' : ''}</div>`
      : '';
    return `
      <div class="msg-group">
        <div class="pip" style="background:${sender.color}">${sender.initials}</div>
        <div class="msg-stack">${senderLabel}${bubbles}${time}</div>
      </div>
    `;
  }).join('');

  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function initMessages() {
  const user = Auth.currentUser();
  const params = new URLSearchParams(location.search);
  const chatIdParam = params.get('chat');
  const withId = params.get('with');

  const convList = document.getElementById('conv-list');
  const msgs = document.getElementById('messages');
  const composer = document.getElementById('composer');
  const titleEl = document.getElementById('msg-title');
  const subEl = document.getElementById('msg-sub');
  const crumbEl = document.getElementById('msg-crumb');

  if (!chatIdParam && !withId) {
    // ---- List view ----
    convList.style.display = '';
    msgs.style.display = 'none';
    composer.style.display = 'none';
    crumbEl.textContent = '← Menu';
    crumbEl.href = 'index.html';
    titleEl.textContent = 'Direct messages';
    subEl.textContent = user.role === 'player'
      ? 'Talk privately with a coach'
      : 'Private messages with players';

    injectNewChatButton();
    renderConversationList();
    return;
  }

  // ---- Conversation view ----
  // Resolve a chat (existing or draft) from the URL params.
  let chat;
  if (chatIdParam) {
    chat = getChat(chatIdParam);
    if (!chat) {
      location.href = 'messages.html';
      return;
    }
    if (!chat.participants.includes(user.id)) {
      // Not allowed
      location.href = 'messages.html';
      return;
    }
  } else {
    const other = getUser(withId);
    if (!other) {
      location.href = 'messages.html';
      return;
    }
    chat = find1to1Chat(user.id, withId) || {
      id: null, // draft — will materialize on first send
      participants: [user.id, withId],
      name: null,
      draft: true,
    };
  }

  convList.style.display = 'none';
  msgs.style.display = '';
  composer.style.display = '';
  crumbEl.textContent = '← Messages';
  crumbEl.href = 'messages.html';

  const isGroup = chat.participants.length > 2;
  const others = chat.participants.filter(p => p !== user.id).map(getUser).filter(Boolean);

  if (isGroup) {
    const name = chat.name || autoGroupName(others);
    titleEl.innerHTML = `${escapeHtml(name)} <span class="conv-group-tag">${chat.participants.length}</span>`;
    subEl.textContent = others.map(o => o.firstName).join(', ');
  } else {
    const other = others[0];
    titleEl.innerHTML = `${escapeHtml(other.firstName)} <span class="role-badge ${other.role}">${other.role === 'coach' ? 'Coach' : 'Player'}</span>`;
    subEl.textContent = other.role === 'coach' ? 'Coach · ' + other.name : 'Player · ' + other.name;
  }

  renderConversation(chat);

  const input = document.getElementById('msg-input');
  const send = document.getElementById('msg-send');
  input.placeholder = isGroup
    ? `Message the group...`
    : `Message ${others[0].firstName}...`;

  function sendMsg() {
    const text = input.value.trim();
    if (!text) return;

    // Materialize draft chats on first send.
    if (!chat.id) {
      const created = createCustomChat(chat.participants, chat.name, user.id);
      chat = created;
      const url = new URL(location.href);
      url.searchParams.delete('with');
      url.searchParams.set('chat', created.id);
      history.replaceState(null, '', url.toString());
    }

    const all = Store.get('messages', []);
    all.push({
      id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      chatId: chat.id,
      fromUserId: user.id,
      text,
      timestamp: Date.now(),
      readBy: [user.id],
    });
    Store.set('messages', all);
    input.value = '';
    renderConversation(chat);
  }

  send.addEventListener('click', sendMsg);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  });

  // Poll for new messages
  setInterval(() => {
    const cur = Store.get('messages', []).length;
    if (cur !== window._lastMsgCount) {
      renderConversation(chat);
      window._lastMsgCount = cur;
    }
  }, 3000);
  window._lastMsgCount = Store.get('messages', []).length;
}

function injectNewChatButton() {
  if (document.getElementById('new-chat-btn')) return;
  const convList = document.getElementById('conv-list');
  if (!convList) return;
  const btn = document.createElement('button');
  btn.className = 'new-chat-btn';
  btn.id = 'new-chat-btn';
  btn.innerHTML = `
    <span class="plus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>
    New chat
  `;
  convList.parentNode.insertBefore(btn, convList);
  btn.addEventListener('click', openNewChatModal);
}

function openNewChatModal() {
  const user = Auth.currentUser();
  const users = getAllUsers().filter(u => u.id !== user.id);
  let modal = document.getElementById('new-chat-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'new-chat-modal';
    document.body.appendChild(modal);
  }
  const selected = new Set();
  function render() {
    const count = selected.size;
    const isGroup = count > 1;
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-title">New chat</div>
        <div class="modal-sub">Pick anyone — players, coaches, or a mix. Choose more than one to make it a group.</div>
        <div class="signin-list" style="max-height:280px">
          ${users.map(u => `
            <button type="button" class="signin-row ${u.role === 'coach' ? 'coach' : ''} ${selected.has(u.id) ? 'selected' : ''}" data-id="${u.id}">
              <div class="pip" style="background:${u.color}">${u.initials}</div>
              <div>
                <div class="signin-name">${escapeHtml(u.name)}</div>
                <div class="signin-role">${u.role === 'coach' ? 'Coach' : 'Player'}</div>
              </div>
              <div class="new-chat-check">${selected.has(u.id) ? '✓' : ''}</div>
            </button>
          `).join('')}
        </div>
        ${isGroup ? `
          <div class="field" style="margin-top:16px">
            <div class="field-label">Group name (optional)</div>
            <input type="text" id="new-chat-name" maxlength="40" placeholder="e.g. Pitchers, Captains, Friday game..." autocomplete="off" />
          </div>
        ` : ''}
        <div class="modal-actions">
          <button type="button" id="new-chat-cancel">Cancel</button>
          <button type="button" class="primary" id="new-chat-start" ${count === 0 ? 'disabled style="opacity:.4;cursor:not-allowed"' : ''}>
            ${count === 0 ? 'Pick someone' : isGroup ? `Start group (${count + 1})` : 'Start chat'}
          </button>
        </div>
      </div>
    `;
    modal.classList.add('show');
    modal.querySelectorAll('.signin-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        // Preserve any typed group name across re-render
        const nameField = modal.querySelector('#new-chat-name');
        modal._pendingName = nameField ? nameField.value : modal._pendingName;
        render();
        const restored = modal.querySelector('#new-chat-name');
        if (restored && modal._pendingName) restored.value = modal._pendingName;
      });
    });
    modal.querySelector('#new-chat-cancel').addEventListener('click', close);
    const startBtn = modal.querySelector('#new-chat-start');
    if (selected.size > 0) {
      startBtn.addEventListener('click', () => {
        const ids = [user.id, ...selected];
        const isGroupChat = selected.size > 1;
        let chat;
        if (isGroupChat) {
          const nameField = modal.querySelector('#new-chat-name');
          const name = nameField ? nameField.value.trim() : '';
          chat = createCustomChat(ids, name || null, user.id);
        } else {
          const otherId = [...selected][0];
          chat = ensure1to1Chat(user.id, otherId);
        }
        close();
        location.href = 'messages.html?chat=' + encodeURIComponent(chat.id);
      });
    }
  }
  function close() {
    modal.classList.remove('show');
    modal._pendingName = '';
  }
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  render();
}

// ============================================================
// INDYS (DEPRECATED — kept for backwards compat but not wired up)
// ============================================================
function renderSessions() {
  const list = document.getElementById('session-list');
  if (!list) return;
  const user = Auth.currentUser();
  const filter = document.querySelector('.chips .chip.active')?.dataset.filter || 'all';
  let sessions = getSessions();

  sessions = sessions.filter(s => {
    if (filter === 'week') return true;
    if (filter === 'needCoach') return s.needCoach && !s.coachId;
    if (filter === 'mine')
      return s.attendees?.includes(user.id) || s.postedBy === user.id || s.coachId === user.id;
    return true;
  });

  if (sessions.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
        </div>
        <div class="empty-title">No open sessions</div>
        <div class="empty-sub">${user.role === 'coach' ? 'Offer some coaching time below.' : 'Post a session to get a hit in.'}</div>
      </div>
    `;
    return;
  }

  list.innerHTML = sessions.map(s => {
    const poster = getUser(s.postedBy);
    const coach = getUser(s.coachId);
    const attendees = (s.attendees || []).map(getUser).filter(Boolean);

    const visible = attendees.slice(0, 4);
    const extra = attendees.length - visible.length;
    const pipsHtml = visible.map(u =>
      `<div class="pip" style="background:${u.color}">${u.initials}</div>`
    ).join('') + (extra > 0 ? `<div class="pip more">+${extra}</div>` : '');
    const pips = pipsHtml || `<div class="pip more">?</div>`;

    const isFull = s.capacity != null && attendees.length >= s.capacity;

    let badge = '';
    if (coach) badge = `<div class="badge gold">Coach ${coach.initials}</div>`;
    else if (s.needCoach) badge = `<div class="badge warn">No coach</div>`;
    else if (isFull) badge = `<div class="badge warn">Full</div>`;
    else badge = `<div class="badge ok">${attendees.length}${s.capacity ? '/' + s.capacity : ''} in</div>`;

    const meta = poster
      ? (poster.role === 'coach' ? `Coach ${poster.firstName} posted` : `${poster.firstName} · ${s.time}`)
      : s.time;

    const userJoined = attendees.some(u => u.id === user.id);
    const userIsCoach = s.coachId === user.id;

    let btn = '';
    if (user.role === 'coach' && s.needCoach && !s.coachId) {
      btn = `<button class="joinbtn" style="background:var(--gold);color:var(--brown)" data-id="${s.id}" data-action="coach">Coach it</button>`;
    } else if (user.role === 'coach' && userIsCoach) {
      btn = `<button class="joinbtn joined" data-id="${s.id}" data-action="uncoach">✓ Coaching</button>`;
    } else if (user.role === 'player' && userJoined) {
      btn = `<button class="joinbtn joined" data-id="${s.id}" data-action="leave">✓ You're in</button>`;
    } else if (user.role === 'player' && isFull) {
      btn = `<button class="joinbtn full" disabled>Full</button>`;
    } else if (user.role === 'player') {
      btn = `<button class="joinbtn" data-id="${s.id}" data-action="join">Join</button>`;
    } else {
      btn = `<div style="font-size:11px;color:var(--muted);font-weight:600">No action</div>`;
    }

    return `
      <div class="session" data-id="${s.id}">
        <div class="session-head">
          <div class="date-block">
            <div class="dow">${s.dow}</div>
            <div class="day">${String(s.day).padStart(2, '0')}</div>
          </div>
          <div class="session-body">
            <div class="session-title">${s.title}</div>
            <div class="session-meta">${meta}${s.location ? ' · ' + s.location : ''}</div>
          </div>
          ${badge}
        </div>
        <div class="session-foot">
          <div class="who">
            <div class="who-stack">${pips}</div>
            <div class="who-text">${attendees.length === 0 ? 'no one yet' : '<strong>' + attendees.length + (s.capacity ? ' of ' + s.capacity : '') + '</strong> in'}${s.needCoach && !s.coachId ? ' · need coach' : ''}</div>
          </div>
          ${btn}
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.joinbtn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSessionAction(btn.dataset.id, btn.dataset.action);
    });
  });
}

function handleSessionAction(id, action) {
  const user = Auth.currentUser();
  const sessions = getSessions();
  const s = sessions.find(x => x.id === id);
  if (!s) return;

  if (action === 'join') {
    if (s.capacity != null && (s.attendees || []).length >= s.capacity) {
      toast("Session is full");
      return;
    }
    s.attendees = [user.id, ...(s.attendees || [])];
    toast("You're in!");
  } else if (action === 'leave') {
    s.attendees = (s.attendees || []).filter(uid => uid !== user.id);
    toast("You're out");
  } else if (action === 'coach') {
    s.coachId = user.id;
    toast("You're coaching it");
  } else if (action === 'uncoach') {
    s.coachId = null;
    toast("Stepped off coaching");
  }
  saveSessions(sessions);
  renderSessions();
}

function initIndys() {
  const user = Auth.currentUser();

  const sub = document.getElementById('indys-sub');
  if (sub) {
    sub.textContent = user.role === 'coach'
      ? "Sessions players have thrown out — coach the ones that need you"
      : "Open hitting sessions — sign up or post your own";
  }

  const postBtn = document.querySelector('.post-btn');
  if (postBtn) {
    const plusSvg = '<span class="plus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>';
    postBtn.innerHTML = user.role === 'coach'
      ? `${plusSvg} Offer coaching time`
      : `${plusSvg} Post a hitting session`;
  }

  renderSessions();

  document.querySelectorAll('.chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderSessions();
    });
  });

  // Post modal
  const modal = document.getElementById('post-modal');
  const modalTitle = modal?.querySelector('.modal-title');
  const modalSub = modal?.querySelector('.modal-sub');
  const coachCheck = modal?.querySelector('.check-row');
  if (modalTitle) {
    if (user.role === 'coach') {
      modalTitle.textContent = 'Offer coaching time';
      if (modalSub) modalSub.textContent = "Tell players when you're free to run drills";
      if (coachCheck) coachCheck.style.display = 'none';
    } else {
      modalTitle.textContent = 'Post a hitting session';
      if (modalSub) modalSub.textContent = "Throw out a time and see who's in";
      if (coachCheck) coachCheck.style.display = '';
    }
  }

  if (postBtn && modal) {
    postBtn.addEventListener('click', () => modal.classList.add('show'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('show');
    });
    document.getElementById('post-cancel')?.addEventListener('click', () => modal.classList.remove('show'));

    wireCapToggle(modal);

    document.getElementById('post-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const day = fd.get('day');
      const time = fd.get('time');
      const title = (fd.get('title') || '').trim();
      const location = (fd.get('location') || 'TBD').trim();
      const needCoach = fd.get('needCoach') === 'on';
      const capToggle = e.target.querySelector('.cap-toggle');
      const isUnlimited = capToggle?.classList.contains('active');
      const capacity = isUnlimited ? null : Math.max(1, parseInt(fd.get('capacity')) || 8);
      const [dow, dayNum] = day.split('-');
      const isCoach = user.role === 'coach';
      const newSession = {
        id: 's_' + Date.now(),
        postedBy: user.id,
        dow,
        day: parseInt(dayNum),
        time,
        title: title || (isCoach ? 'Coaching time' : 'Hitting session'),
        location,
        needCoach: isCoach ? false : needCoach,
        coachId: isCoach ? user.id : null,
        attendees: isCoach ? [] : [user.id],
        capacity,
      };
      const sessions = getSessions();
      sessions.unshift(newSession);
      saveSessions(sessions);
      modal.classList.remove('show');
      resetForm(e.target);
      renderSessions();
      toast(isCoach ? 'Coaching slot posted' : 'Session posted');
    });
  }
}

// Wire up the "Unlimited" toggle for a capacity field inside a modal
function wireCapToggle(modal) {
  const toggle = modal.querySelector('.cap-toggle');
  const input = modal.querySelector('input[name="capacity"]');
  if (!toggle || !input) return;
  function refresh() {
    input.classList.toggle('dim', toggle.classList.contains('active'));
  }
  refresh();
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('active');
    refresh();
  });
  // Typing in the number auto-disables Unlimited
  const off = () => { toggle.classList.remove('active'); refresh(); };
  input.addEventListener('focus', off);
  input.addEventListener('input', off);
}

// Reset form including cap toggle state
function resetForm(form) {
  form.reset();
  const toggle = form.querySelector('.cap-toggle');
  const input = form.querySelector('input[name="capacity"]');
  if (toggle && input) {
    const defaultUnlimited = (form.id === 'practice-form');
    if (defaultUnlimited) toggle.classList.add('active');
    else toggle.classList.remove('active');
    input.classList.toggle('dim', toggle.classList.contains('active'));
  }
}

// ============================================================
// PRACTICES
// ============================================================
function initPractices() {
  const user = Auth.currentUser();

  // One-time cleanup: existing practices wrongly had the coach in attendees
  const allP = getPractices();
  let migrated = false;
  allP.forEach(p => {
    if (p.coachId && p.attendees?.includes(p.coachId)) {
      p.attendees = p.attendees.filter(uid => uid !== p.coachId);
      migrated = true;
    }
  });
  if (migrated) savePractices(allP);

  const practices = getPractices();

  const sub = document.getElementById('practices-sub');
  if (sub) {
    sub.textContent = user.role === 'coach'
      ? 'Schedule team practices and see who is in'
      : 'Team practices and the next lineup';
  }

  const scheduleSlot = document.getElementById('schedule-slot');
  if (scheduleSlot) {
    if (user.role === 'coach') {
      scheduleSlot.innerHTML = `
        <button class="schedule-btn" id="schedule-btn">
          <span class="plus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>
          Schedule a team practice
        </button>
      `;
      document.getElementById('schedule-btn').addEventListener('click', () => {
        document.getElementById('practice-modal').classList.add('show');
      });
    } else {
      scheduleSlot.innerHTML = '';
    }
  }

  const lineupHost = document.getElementById('lineup-host');
  if (lineupHost) {
    if (practices.length === 0) {
      lineupHost.innerHTML = `
        <div class="empty">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          </div>
          <div class="empty-title">No team practices scheduled</div>
          <div class="empty-sub">${user.role === 'coach' ? 'Tap the gold button above to set one up.' : 'A coach will schedule the next one.'}</div>
        </div>
      `;
    } else {
      lineupHost.innerHTML = practices.map(p => renderLineupCard(p, user)).join('');
      wireLineupCards();

      // "Add all to calendar" button above the cards
      const addAllBtn = document.createElement('button');
      addAllBtn.className = 'add-all-cal-btn';
      addAllBtn.innerHTML = '📅 Add all practices to calendar';
      lineupHost.insertBefore(addAllBtn, lineupHost.firstChild);
      addAllBtn.addEventListener('click', () => downloadAllIcs(practices));
    }
  }

  // Practice modal (wire once — initPractices re-runs on every submit/refresh)
  const modal = document.getElementById('practice-modal');
  if (modal && !modal.dataset.wired) {
    modal.dataset.wired = '1';
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('show');
    });
    document.getElementById('practice-cancel')?.addEventListener('click', () => modal.classList.remove('show'));

    wireCapToggle(modal);

    document.getElementById('practice-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const day = fd.get('day');
      const time = `${fd.get('time_start')} – ${fd.get('time_end')}`;
      const title = (fd.get('title') || 'Team practice').trim();
      const location = (fd.get('location') || 'TBD').trim();
      const required = fd.get('required') === 'on';
      const capToggle = e.target.querySelector('.cap-toggle');
      const isUnlimited = capToggle?.classList.contains('active');
      const capacity = isUnlimited ? null : Math.max(1, parseInt(fd.get('capacity')) || 15);
      const [dow, dayNum] = day.split('-');
      const newPractice = {
        id: 'p_' + Date.now(),
        dow,
        day: parseInt(dayNum),
        time,
        title,
        location,
        coachId: user.id,
        attendees: [],
        declined: [],
        required,
        capacity,
      };
      const list = getPractices();
      list.unshift(newPractice);
      savePractices(list);
      postAnnouncement(`📅 Practice scheduled: ${newPractice.title} on ${newPractice.dow} Jun ${String(newPractice.day).padStart(2,'0')} at ${newPractice.time}`, 'practice_added');
      modal.classList.remove('show');
      resetForm(e.target);
      initPractices();
      toast('Practice scheduled');
    });
  }
}

function renderLineupCard(p, user) {
  const coach = getUser(p.coachId);
  const attendees = (p.attendees || []).map(getUser).filter(Boolean);
  const declined = (p.declined || [])
    .map(d => ({ user: getUser(d.userId), reason: d.reason, ts: d.timestamp }))
    .filter(d => d.user);
  const isIn = attendees.some(u => u.id === user.id);
  const myDecline = declined.find(d => d.user.id === user.id);
  const isHostingCoach = p.coachId === user.id;
  const isFull = p.capacity != null && attendees.length >= p.capacity;

  const lines = attendees.length === 0
    ? `<div style="padding:18px 0;font-size:13px;opacity:.6;text-align:center">No one's RSVP'd yet</div>`
    : attendees.map((u, i) => `
        <div class="lineup-row">
          <div class="lineup-num">${String(i + 1).padStart(2, '0')}</div>
          <div class="lineup-name">${u.name}</div>
          <div class="lineup-pos">${u.role === 'coach' ? 'Coach' : 'In'}</div>
        </div>
      `).join('');

  const capLine = p.capacity != null
    ? `<div style="padding:8px 0 0;font-size:11px;font-weight:700;letter-spacing:.6px;color:${isFull ? 'var(--red)' : 'rgba(255,253,247,0.5)'};text-transform:uppercase">${attendees.length} of ${p.capacity} spots${isFull ? ' · full' : ''}</div>`
    : '';

  const declinedBlock = declined.length === 0 ? '' : `
    <div class="lineup-declines">
      <div class="lineup-declines-head">Can't make it · ${declined.length}</div>
      ${declined.map(d => `
        <div class="lineup-decline-row">
          <div class="pip" style="background:${d.user.color}">${d.user.initials}</div>
          <div class="lineup-decline-body">
            <div class="lineup-decline-name">${escapeHtml(d.user.name)}</div>
            ${d.reason ? `<div class="lineup-decline-reason">"${escapeHtml(d.reason)}"</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  let foot = '';
  if (isHostingCoach) {
    foot = `
      <div style="padding:14px 20px;background:rgba(255,255,255,0.04);font-size:11px;font-weight:700;letter-spacing:.6px;color:var(--gold);text-transform:uppercase;text-align:center">
        You're running this one
      </div>
    `;
  } else {
    const inBtn = isIn
      ? `<button data-action="in" data-id="${p.id}">✓ You're in</button>`
      : isFull
        ? `<button disabled style="opacity:.4;cursor:not-allowed">Full</button>`
        : `<button data-action="in" data-id="${p.id}">You're in</button>`;
    const outLabel = myDecline ? "✓ Can't make it" : "Can't make it";
    foot = `
      <div class="lineup-foot">
        ${inBtn}
        <button class="ghost${myDecline ? ' out-set' : ''}" data-action="out" data-id="${p.id}">${outLabel}</button>
      </div>
    `;
  }

  const reqTag = p.required ? '<span class="lineup-req-tag">Required</span>' : '';

  const deleteBtn = isHostingCoach
    ? `<button class="lineup-delete-btn" data-action="delete" data-id="${p.id}" title="Delete practice">✕</button>`
    : '';

  return `
    <div class="lineup-card" data-id="${p.id}" style="position:relative">${deleteBtn}
      <div class="lineup-head">
        <div class="lineup-tag">★ ${escapeHtml(p.title)} ${reqTag}</div>
        <div class="lineup-when">${p.time} · ${p.dow} Jun ${String(p.day).padStart(2,'0')}</div>
        <div class="lineup-where">${escapeHtml(p.location)}${coach ? ' · Coach ' + coach.firstName : ''}</div>
      </div>
      <div class="lineup-list">${lines}${capLine}</div>
      ${declinedBlock}
      ${foot}
      <div class="lineup-cal">
        <span class="lineup-cal-label">📅 Add to calendar</span>
        <button class="cal-btn" data-cal-id="${p.id}" data-cal-type="google">Google</button>
        <button class="cal-btn" data-cal-id="${p.id}" data-cal-type="ics">Apple / .ics</button>
      </div>
    </div>
  `;
}

function wireLineupCards() {
  document.querySelectorAll('.lineup-foot button, .lineup-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const user = Auth.currentUser();
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const practices = getPractices();
      const p = practices.find(x => x.id === id);
      if (!p) return;
      p.attendees = p.attendees || [];
      p.declined = p.declined || [];

      if (action === 'delete') {
        if (!confirm('Delete this practice? This cannot be undone.')) return;
        postAnnouncement(`❌ Practice cancelled: ${p.title} on ${p.dow} Jun ${String(p.day).padStart(2,'0')} at ${p.time}`, 'practice_cancelled');
        savePractices(practices.filter(x => x.id !== id));
        initPractices();
        toast('Practice deleted');
        return;
      }

      if (action === 'in') {
        if (!p.attendees.includes(user.id)) {
          if (p.capacity != null && p.attendees.length >= p.capacity) {
            toast("Practice is full");
            return;
          }
          p.attendees.push(user.id);
        }
        // Picking "in" clears any prior decline reason.
        p.declined = p.declined.filter(d => d.userId !== user.id);
        savePractices(practices);
        initPractices();
        toast("Locked in");
        return;
      }

      // "out" action — toggle off if already declined.
      const wasDeclined = p.declined.some(d => d.userId === user.id);
      if (wasDeclined) {
        p.declined = p.declined.filter(d => d.userId !== user.id);
        savePractices(practices);
        initPractices();
        toast("Cleared");
        return;
      }

      p.attendees = p.attendees.filter(uid => uid !== user.id);

      if (p.required) {
        openDeclineReasonModal(p, (reason) => {
          // Re-read state in case it changed while modal was open.
          const list = getPractices();
          const pp = list.find(x => x.id === id);
          if (!pp) return;
          pp.attendees = (pp.attendees || []).filter(uid => uid !== user.id);
          pp.declined = (pp.declined || []).filter(d => d.userId !== user.id);
          pp.declined.push({ userId: user.id, reason, timestamp: Date.now() });
          savePractices(list);
          initPractices();
          toast("Reason posted");
        });
      } else {
        savePractices(practices);
        initPractices();
        toast("Marked unavailable");
      }
    });
  });

  // Calendar export buttons
  document.querySelectorAll('.cal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const practices = getPractices();
      const p = practices.find(x => x.id === btn.dataset.calId);
      if (!p) return;
      if (btn.dataset.calType === 'google') {
        window.open(buildGoogleCalUrl(p), '_blank');
      } else {
        downloadIcs(p);
      }
    });
  });
}

// ── Calendar export helpers ──────────────────────────────────

function parsePracticeTime(timeStr) {
  // "10 AM" → 10, "5 PM" → 17, "12 PM" → 12, "12 AM" → 0
  const m = (timeStr || '').match(/(\d+)\s*(AM|PM)/i);
  if (!m) return 10;
  let h = parseInt(m[1]);
  const ampm = m[2].toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h;
}

function practiceToDateRange(p) {
  // All practices are June 2026. Duration defaults to 2 hours.
  const hour = parsePracticeTime(p.time);
  const start = new Date(2026, 5, p.day, hour, 0, 0);   // month is 0-indexed → 5 = June
  const end   = new Date(2026, 5, p.day, hour + 2, 0, 0);
  return { start, end };
}

function formatIcsDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function buildGoogleCalUrl(p) {
  const { start, end } = practiceToDateRange(p);
  const fmt = d => formatIcsDate(d); // local (no Z) so Google uses the viewer's timezone
  const params = new URLSearchParams({
    action:   'TEMPLATE',
    text:     `Brown Softball – ${p.title}`,
    dates:    `${fmt(start)}/${fmt(end)}`,
    details:  `Brown Softball practice. Location: ${p.location}`,
    location: p.location,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function buildIcsContent(p) {
  const { start, end } = practiceToDateRange(p);
  const fmt = d => formatIcsDate(d);
  const uid = `${p.id}@brownsoftball.app`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Brown Softball//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:Brown Softball – ${p.title}`,
    `DESCRIPTION:Brown Softball practice at ${p.location}`,
    `LOCATION:${p.location}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function downloadIcs(p) {
  const content = buildIcsContent(p);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `brown-softball-${p.dow}-${p.day}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Calendar file downloaded');
}

function downloadAllIcs(practices) {
  if (!practices || practices.length === 0) { toast('No practices to export'); return; }
  const events = practices.map(p => {
    const { start, end } = practiceToDateRange(p);
    const fmt = d => formatIcsDate(d);
    return [
      'BEGIN:VEVENT',
      `UID:${p.id}@brownsoftball.app`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:Brown Softball – ${p.title}`,
      `DESCRIPTION:Brown Softball practice at ${p.location}`,
      `LOCATION:${p.location}`,
      'END:VEVENT',
    ].join('\r\n');
  }).join('\r\n');

  const content = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Brown Softball//EN',
    'CALSCALE:GREGORIAN',
    events,
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'brown-softball-spring2026.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`${practices.length} practices exported ✓`);
}

function openEditNameModal() {
  const user = Auth.currentUser();
  if (!user) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop show';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-title">Edit display name</div>
      <div class="modal-sub">This is how your teammates see you</div>
      <div class="field">
        <label class="field-label" for="edit-name-input">Name</label>
        <input class="field-input" id="edit-name-input" type="text"
          value="${escapeHtml(user.name)}" maxlength="40" autocomplete="off" spellcheck="false" />
      </div>
      <div class="modal-actions">
        <button type="button" id="edit-name-cancel">Cancel</button>
        <button type="button" class="primary" id="edit-name-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector('#edit-name-input');
  input.focus();
  input.select();

  function close() { backdrop.remove(); }

  function save() {
    const newName = input.value.trim();
    if (!newName) { input.focus(); return; }

    const users = Store.get('users', []);
    const idx = users.findIndex(u => u.id === user.id);
    if (idx === -1) return;

    const newInitials = newName.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    users[idx].name      = newName;
    users[idx].firstName = newName.split(/\s+/)[0];
    users[idx].initials  = newInitials;
    Store.set('users', users);
    close();

    // Update topbar avatar + dropdown name live (no reload needed)
    const meEl = document.querySelector('.me');
    if (meEl) meEl.textContent = newInitials;
    const nameEl = document.querySelector('.usermenu-name');
    if (nameEl) {
      const badge = nameEl.querySelector('.role-badge');
      nameEl.textContent = newName + ' ';
      if (badge) nameEl.appendChild(badge);
    }

    // Redraw calendar heatmap so name chips update
    if (document.body.dataset.page === 'calendars') initCalendars();

    toast('Name updated ✓');
  }

  backdrop.querySelector('#edit-name-cancel').addEventListener('click', close);
  backdrop.querySelector('#edit-name-save').addEventListener('click', save);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') close();
  });
}

function openDeclineReasonModal(practice, onSubmit) {
  let modal = document.getElementById('decline-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'decline-modal';
    document.body.appendChild(modal);
  }
  const coach = getUser(practice.coachId);
  const coachName = coach ? 'Coach ' + escapeHtml(coach.firstName) : 'your coach';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title">Can't make it?</div>
      <div class="modal-sub">${escapeHtml(practice.title)} · ${practice.dow} ${practice.time}</div>
      <div class="decline-tip">
        <div class="decline-tip-head">Heads up — message a coach first</div>
        <p>Shoot ${coachName} a quick DM so they know what's going on and can OK the absence. The reason below posts to the whole team — coaches shouldn't be finding out from a public board.</p>
        ${coach ? `<a class="decline-tip-link" href="messages.html?with=${encodeURIComponent(coach.id)}">Message ${coachName} →</a>` : ''}
      </div>
      <div class="field">
        <div class="field-label">Reason (everyone can see this)</div>
        <input type="text" id="decline-reason-input" maxlength="120" placeholder="Family event, sick, exam..." autocomplete="off" />
      </div>
      <div class="modal-actions">
        <button type="button" id="decline-cancel">Cancel</button>
        <button type="button" class="primary" id="decline-submit">Post reason</button>
      </div>
    </div>
  `;
  modal.classList.add('show');
  const input = document.getElementById('decline-reason-input');
  const close = () => modal.classList.remove('show');
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.getElementById('decline-cancel').addEventListener('click', close);
  setTimeout(() => input.focus(), 50);
  const submit = () => {
    const reason = input.value.trim();
    if (!reason) {
      input.style.borderColor = 'var(--red)';
      input.focus();
      return;
    }
    close();
    onSubmit(reason);
  };
  document.getElementById('decline-submit').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
}

// ============================================================
// CALENDARS
// ============================================================
function initCalendars() {
  const user = Auth.currentUser();
  const days = ["M", "T", "W", "Th", "F", "Sa", "Su"];
  const hours = ["8a", "9a", "10a", "11a", "12p", "1p", "4p", "5p", "6p", "7p"];
  const HOUR_DISPLAY = { '8a':'8 AM','9a':'9 AM','10a':'10 AM','11a':'11 AM','12p':'12 PM','1p':'1 PM','4p':'4 PM','5p':'5 PM','6p':'6 PM','7p':'7 PM' };

  function computeData(role) {
    const data = {};
    const users = getAllUsers();
    if (role === 'overlap') {
      const allKeys = new Set();
      users.forEach(u => {
        Object.keys(Store.get('avail_' + u.id, {})).forEach(k => allKeys.add(k));
      });
      allKeys.forEach(k => {
        const players = users.filter(u => u.role === 'player' && Store.get('avail_' + u.id, {})[k]).length;
        const coaches = users.filter(u => u.role === 'coach' && Store.get('avail_' + u.id, {})[k]).length;
        if (players > 0 && coaches > 0) data[k] = players;
      });
    } else {
      const filtered = users.filter(u => u.role === role);
      filtered.forEach(u => {
        const avail = Store.get('avail_' + u.id, {});
        Object.keys(avail).forEach(k => {
          if (avail[k]) data[k] = (data[k] || 0) + 1;
        });
      });
    }
    return data;
  }

  function draw(role) {
    const hm = document.getElementById("heatmap");
    if (!hm) return;
    const data = computeData(role);
    const max = Math.max(1, ...Object.values(data));
    const isDesktop = window.matchMedia('(min-width: 700px)').matches;

    // Pre-build per-slot user list for desktop pip rendering
    let slotUsers = null;
    if (isDesktop) {
      const allUsers = getAllUsers();
      const candidates = role === 'overlap' ? allUsers : allUsers.filter(u => u.role === role);
      slotUsers = {};
      candidates.forEach(u => {
        const avail = Store.get('avail_' + u.id, {});
        Object.keys(avail).forEach(k => {
          if (avail[k]) { if (!slotUsers[k]) slotUsers[k] = []; slotUsers[k].push(u); }
        });
      });
    }

    let html = `<div></div>` + days.map(d => `<div class="hm-head">${d}</div>`).join('');
    hours.forEach(h => {
      html += `<div class="hm-time">${HOUR_DISPLAY[h] || h}</div>`;
      days.forEach(d => {
        const key = `${d}-${h}`;
        const v = data[key] || 0;
        const lvl = v === 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5));
        const cls = lvl > 0 ? ` l${lvl}` : "";
        let inner = '';
        if (isDesktop && slotUsers && slotUsers[key]) {
          const free = slotUsers[key];
          inner = free.map(u => {
            const first = (u.firstName || u.name.split(' ')[0]);
            return `<span class="hm-name" style="background:${u.color || '#888'}">${first}</span>`;
          }).join('');
        }
        html += `<div class="hm-cell${cls}" data-key="${key}">${inner}</div>`;
      });
    });
    hm.innerHTML = html;
    // Tap / click a cell to see the full detail sheet
    hm.querySelectorAll('.hm-cell[data-key]').forEach(cell => {
      cell.addEventListener('click', () => openSlotDetail(cell.dataset.key, role));
    });
  }

  const initialRole = user.role === 'coach' ? 'coaches' : 'players';
  const initialBtn = document.querySelector(`.role-toggle button[data-role="${initialRole}"]`);
  if (initialBtn) {
    document.querySelectorAll('.role-toggle button').forEach(x => x.classList.remove('active'));
    initialBtn.classList.add('active');
  }
  draw(initialRole === 'players' ? 'player' : initialRole === 'coaches' ? 'coach' : 'overlap');

  document.querySelectorAll('.role-toggle button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.role-toggle button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const role = b.dataset.role;
      draw(role === 'players' ? 'player' : role === 'coaches' ? 'coach' : 'overlap');
    });
  });

  const composeLabel = document.getElementById('compose-label');
  if (composeLabel) {
    composeLabel.textContent = user.role === 'coach' ? 'When can you coach?' : 'When can you hit?';
  }

  const composeBtn = document.getElementById('compose-btn');
  if (composeBtn) {
    composeBtn.addEventListener('click', () => openAvailEditor());
  }

  document.querySelectorAll('.window').forEach(w => {
    w.addEventListener('click', () => toast('Proposal sent to team'));
  });
}

function openSlotDetail(key, role) {
  const DAY_LABELS = { M: 'Monday', T: 'Tuesday', W: 'Wednesday', Th: 'Thursday', F: 'Friday', Sa: 'Saturday', Su: 'Sunday' };
  const HOUR_LABELS = { '8a': '8 AM', '9a': '9 AM', '10a': '10 AM', '11a': '11 AM', '12p': '12 PM', '1p': '1 PM', '4p': '4 PM', '5p': '5 PM', '6p': '6 PM', '7p': '7 PM' };

  const [day, hour] = key.split('-');
  const label = `${DAY_LABELS[day] || day} · ${HOUR_LABELS[hour] || hour}`;

  // Determine which roles to show for 'overlap' show both; otherwise filter
  const currentUser = Auth.currentUser();
  const users = getAllUsers();
  let candidates;
  if (role === 'overlap') {
    candidates = users;
  } else {
    candidates = users.filter(u => u.role === role);
  }
  const free = candidates.filter(u => !!Store.get('avail_' + u.id, {})[key]);

  const sub = free.length === 0 ? 'Nobody free at this time' :
    free.length === 1 ? '1 person free' : `${free.length} people free`;

  const listHtml = free.length === 0
    ? `<div class="slot-detail-empty">🤷 Nobody marked this slot</div>`
    : free.map(u => {
        const isMe = currentUser && u.id === currentUser.id;
        return `
          <div class="slot-detail-row">
            <div class="slot-pip" style="background:${u.color || '#888'}">${u.initials || '?'}</div>
            <span class="slot-detail-name">${u.name}</span>
            ${isMe ? '<span class="slot-detail-you">you</span>' : ''}
          </div>`;
      }).join('');

  const modal = document.getElementById('avail-modal');
  modal.innerHTML = `
    <div class="modal slot-sheet">
      <div class="slot-sheet-head">
        <div class="slot-sheet-title">${label}</div>
        <button class="slot-sheet-close" id="slot-close">✕</button>
      </div>
      <div class="slot-sheet-sub">${sub}</div>
      <div class="slot-detail-list">${listHtml}</div>
    </div>
  `;
  modal.classList.add('show');

  document.getElementById('slot-close').addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
}

function openAvailEditor() {
  const user = Auth.currentUser();
  const days = ["M", "T", "W", "Th", "F", "Sa", "Su"];
  const hours = ["8a", "9a", "10a", "11a", "12p", "1p", "4p", "5p", "6p", "7p"];
  const HOUR_DISPLAY = { '8a':'8 AM','9a':'9 AM','10a':'10 AM','11a':'11 AM','12p':'12 PM','1p':'1 PM','4p':'4 PM','5p':'5 PM','6p':'6 PM','7p':'7 PM' };
  const avail = Store.get('avail_' + user.id, {});

  const modal = document.getElementById('avail-modal');
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title">${user.role === 'coach' ? 'When can you coach?' : 'When can you hit?'}</div>
      <div class="modal-sub">Tap to toggle. Saves automatically.</div>
      <div class="heatmap" style="margin:0 -4px 16px">
        <div class="heatmap-grid" id="edit-grid"></div>
      </div>
      <div class="modal-actions">
        <button type="button" id="avail-clear">Clear all</button>
        <button type="button" class="primary" id="avail-done">Done</button>
      </div>
    </div>
  `;
  modal.classList.add('show');

  function renderEdit() {
    const g = document.getElementById('edit-grid');
    let html = `<div></div>` + days.map(d => `<div class="hm-head">${d}</div>`).join('');
    hours.forEach(h => {
      html += `<div class="hm-time">${HOUR_DISPLAY[h] || h}</div>`;
      days.forEach(d => {
        const key = `${d}-${h}`;
        const on = !!avail[key];
        html += `<div class="hm-cell ${on ? 'l3' : ''}" data-key="${key}"></div>`;
      });
    });
    g.innerHTML = html;
    g.querySelectorAll('.hm-cell').forEach(cell => {
      if (!cell.dataset.key) return;
      cell.addEventListener('click', () => {
        const k = cell.dataset.key;
        avail[k] = !avail[k];
        Store.set('avail_' + user.id, avail);
        renderEdit();
      });
    });
  }
  renderEdit();

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('show');
  });
  document.getElementById('avail-clear').addEventListener('click', () => {
    Object.keys(avail).forEach(k => delete avail[k]);
    Store.set('avail_' + user.id, avail);
    renderEdit();
    toast('Cleared');
  });
  document.getElementById('avail-done').addEventListener('click', () => {
    modal.classList.remove('show');
    toast('Saved');
    initCalendars();
  });
}

// ============================================================
// ANNOUNCEMENTS
// ============================================================
function initAnnouncements() {
  const user = Auth.currentUser();
  const announcements = getAnnouncements();

  const compose = document.getElementById('announce-compose');
  if (compose && user.role === 'coach') {
    compose.innerHTML = `
      <div class="announce-compose-box">
        <textarea id="announce-input" placeholder="Write an announcement to the team..." rows="3"></textarea>
        <button id="announce-post" class="primary">Post</button>
      </div>
    `;
    document.getElementById('announce-post').addEventListener('click', () => {
      const input = document.getElementById('announce-input');
      const text = input.value.trim();
      if (!text) return;
      postAnnouncement(text, 'manual');
      input.value = '';
      initAnnouncements();
      toast('Announcement posted');
    });
  }

  const feed = document.getElementById('announce-feed');
  if (!feed) return;

  if (announcements.length === 0) {
    feed.innerHTML = `
      <div class="empty">
        <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
        <div class="empty-title">No announcements yet</div>
        <div class="empty-sub">${user.role === 'coach' ? 'Post one above to notify the team.' : 'Coaches will post updates here.'}</div>
      </div>
    `;
    return;
  }

  feed.innerHTML = announcements.map(a => {
    const author = a.authorId ? getUser(a.authorId) : null;
    const when = formatAnnounceTime(a.timestamp);
    const isCancelled = a.type === 'practice_cancelled';
    const isAdded = a.type === 'practice_added';
    const typeClass = isCancelled ? 'announce-cancelled' : isAdded ? 'announce-added' : '';
    return `
      <div class="announce-card ${typeClass}">
        <div class="announce-text">${escapeHtml(a.text)}</div>
        <div class="announce-meta">${author ? escapeHtml(author.name) + ' · ' : ''}${when}</div>
      </div>
    `;
  }).join('');
}

function formatAnnounceTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================================
// Boot
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  if (page === 'auth') return; // signin.html drives its own flow

  // Wait for Firebase to restore the auth session, then load Firestore data.
  window.fbAuth.onAuthStateChanged(async (firebaseUser) => {
    if (!firebaseUser) { location.href = 'signin.html'; return; }

    await Store.init(window.fbDb);
    applyUrlFlags(); // needs Store loaded so ?as= validation works

    // Guard: user has Firebase session but no profile yet → finish setup
    const email = (firebaseUser.email || '').toLowerCase();
    if (!Store.get('users', []).find(u => (u.email || '').toLowerCase() === email)) {
      location.href = 'signin.html';
      return;
    }

    migrateMessagesToChats();
    renderTopbar();
    startNotifications();

    if (page === 'home')          initHome();
    if (page === 'messages')      initMessages();
    if (page === 'practices')     initPractices();
    if (page === 'calendars')     initCalendars();
    if (page === 'announcements') initAnnouncements();
  });
});
