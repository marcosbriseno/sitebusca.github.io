/* ═══════════════════════════════════════════════
   SUPPORTBASE — app.js  (versão completa)
   Textos · Tutoriais · Lembretes · Lista
   ═══════════════════════════════════════════════ */
"use strict";

/* ═══════════ ESTADO GLOBAL ═══════════ */
let state = { textos: [], tutoriais: [], lembretes: [], contatos: [], links: [], programas: [], lembretesCompartilhados: [] };
let history   = [];
let favorites = {};
let activeType      = 'textos';
let activeCategory  = null;
let searchTimer     = null;
let currentTutorialId = null;
let alarmTimers     = [];
let activeListTab   = 'textos';
let activeRemFilter = 'all';

/* ═══════════ FIREBASE ═══════════ */
// ARQUITETURA DE DADOS (dois documentos):
//  • COMPARTILHADO  → supportbase/equipe
//       textos, tutoriais, favoritos, histórico
//       (todos os usuários autorizados veem e editam os mesmos)
//  • PRIVADO        → supportbase_privado/{uid}
//       lembretes (cada usuário tem os seus + compartilhados)
const SHARED_COLLECTION  = 'supportbase';
const SHARED_DOC_ID      = 'equipe';
const SHARED_REM_DOC_ID  = 'lembretes_compartilhados';
const PRIVATE_COLLECTION = 'supportbase_privado';
const USERS_COLLECTION   = 'usuarios';  // diretório de usuários (p/ compartilhar lembretes)

let auth = null;
let db   = null;
let storage = null;
let currentUser = null;
let unsubShared  = null;   // listener do documento compartilhado
let unsubPrivate = null;   // listener do documento privado
let saveSharedTimer  = null;
let savePrivateTimer = null;
let _lastSharedJSON  = null;
let _lastPrivateJSON = null;
let _sharedLoaded  = false;
let _privateLoaded = false;
let _firstSnapshotLoaded = false;
let usersDirectory = [];   // [{uid, email}] — outros usuários do sistema
let _shareReminderId = null;
let unsubSharedRem = null;
let saveSharedRemTimer = null;
let _lastSharedRemJSON = null;

/* ═══════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db   = firebase.firestore();
    storage = firebase.storage();
    db.enablePersistence({ synchronizeTabs: true }).catch(()=>{});
  } catch (e) {
    console.error('Erro ao iniciar Firebase. Verifique firebase-config.js', e);
    toast('⚠️ Erro ao conectar com o Firebase. Veja firebase-config.js', 'error');
  }

  bindLoginEvents();
  initTheme();

  auth.onAuthStateChanged(user => {
    if (user) {
      currentUser = user;
      qs('#logged-user-label').textContent = `👤 ${user.email}`;
    const mobileLabel=qs('#mobile-user-label'); if(mobileLabel) mobileLabel.textContent=`👤 ${user.email}`;
      attachSharedListener();
      attachPrivateListener(user.uid);
      attachSharedRemListener();
      registerUserDirectory(user);
      loadUsersDirectory();
      showApp();
    } else {
      currentUser = null;
      detachListeners();
      _firstSnapshotLoaded = false;
      _sharedLoaded = false;
      _privateLoaded = false;
      alarmTimers.forEach(clearTimeout);
      alarmTimers = [];
      showLogin();
    }
  });
});

/* ═══════════════════════════════════════════════
   AUTENTICAÇÃO (Firebase Auth — e-mail/senha)
   ═══════════════════════════════════════════════ */
function showLogin() {
  hide(qs('#loading-overlay'));
  show(qs('#login-screen'));
  hide(qs('#app'));
  setTimeout(() => qs('#login-user').focus(), 80);
}

let _appInitialized = false;

function showApp() {
  hide(qs('#login-screen'));
  show(qs('#loading-overlay'));
  hide(qs('#app'));
  if (!_appInitialized) {
    bindEvents();
    focusSearch();
    requestNotificationPermission();
    _appInitialized = true;
  }
  // a tela do app some quando o primeiro snapshot do Firestore chegar
}

function bindLoginEvents() {
  const form   = qs('#login-form');
  const userIn = qs('#login-user');
  const passIn = qs('#login-pass');
  const toggle = qs('#login-toggle-pass');
  const errorEl = qs('#login-error');
  const card    = qs('.login-card');
  const submitBtn = qs('#login-submit');

  toggle.addEventListener('click', () => {
    const isPass = passIn.type === 'password';
    passIn.type = isPass ? 'text' : 'password';
    toggle.textContent = isPass ? '🙈' : '👁';
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const email = userIn.value.trim();
    const pass  = passIn.value;
    if (!email || !pass) return;

    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando…';

    const persistence = qs('#login-remember').checked
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;

    auth.setPersistence(persistence)
      .then(() => auth.signInWithEmailAndPassword(email, pass))
      .then(() => { passIn.value = ''; })
      .catch(err => {
        errorEl.textContent = mapAuthError(err.code);
        errorEl.style.display = 'block';
        card.querySelector('.login-submit').classList.add('shake');
        setTimeout(() => card.querySelector('.login-submit').classList.remove('shake'), 350);
        passIn.value = '';
        passIn.focus();
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Entrar';
      });
  });
}

function mapAuthError(code) {
  const map = {
    'auth/invalid-email':         'E-mail inválido.',
    'auth/user-not-found':        'Usuário não encontrado.',
    'auth/wrong-password':        'Senha incorreta.',
    'auth/invalid-credential':    'E-mail ou senha incorretos.',
    'auth/invalid-login-credentials': 'E-mail ou senha incorretos.',
    'auth/too-many-requests':     'Muitas tentativas. Aguarde um momento e tente novamente.',
    'auth/network-request-failed':'Sem conexão com a internet.',
    'auth/user-disabled':         'Esta conta foi desativada.',
  };
  return map[code] || 'Não foi possível entrar. Tente novamente.';
}

function doLogout() {
  if (!confirm('Deseja sair do sistema?')) return;
  detachListeners();
  auth.signOut();
  // o listener onAuthStateChanged cuida de mostrar a tela de login
  qs('#login-user').value = '';
  qs('#login-pass').value = '';
  qs('#login-error').style.display = 'none';
}

/* ═══════════════════════════════════════════════
   STORAGE — Firestore (dois documentos)
   • COMPARTILHADO: textos, tutoriais, favoritos, histórico
   • PRIVADO:       lembretes (por usuário)
   ═══════════════════════════════════════════════ */

/* ---------- LISTENER COMPARTILHADO ---------- */
function attachSharedListener() {
  const docRef = db.collection(SHARED_COLLECTION).doc(SHARED_DOC_ID);
  unsubShared = docRef.onSnapshot(snap => {
    if (snap.exists) {
      const data = snap.data();
      const incomingJSON = JSON.stringify(data);
      if (incomingJSON === _lastSharedJSON) {
        markSharedLoaded();
        setSyncStatus('synced');
        return;
      }
      _lastSharedJSON = incomingJSON;
      state.textos    = data.textos    || [];
      state.tutoriais = data.tutoriais || [];
      state.contatos  = data.contatos  || [];
      state.links     = data.links     || [];
      state.programas = data.programas || [];
      history   = data.history   || [];
      favorites = data.favorites || {};
      markSharedLoaded();
      refreshAllViews();
      setSyncStatus('synced');
    } else {
      const empty = { textos:[], tutoriais:[], contatos:[], links:[], programas:[], history:[], favorites:{}, updatedAt: Date.now() };
      _lastSharedJSON = JSON.stringify(empty);
      docRef.set(empty).then(markSharedLoaded);
    }
  }, err => {
    console.error('Erro Firestore (compartilhado):', err);
    setSyncStatus('error');
    markSharedLoaded();
    toast('⚠️ Erro de sincronização. Verifique sua conexão.', 'error');
  });
}

/* ---------- LISTENER PRIVADO ---------- */
function attachPrivateListener(uid) {
  const docRef = db.collection(PRIVATE_COLLECTION).doc(uid);
  unsubPrivate = docRef.onSnapshot(snap => {
    if (snap.exists) {
      const data = snap.data();
      const incomingJSON = JSON.stringify(data);
      if (incomingJSON === _lastPrivateJSON) {
        markPrivateLoaded();
        return;
      }
      _lastPrivateJSON = incomingJSON;
      state.lembretes = data.lembretes || [];
      markPrivateLoaded();
      refreshAllViews();
    } else {
      const empty = { lembretes:[], updatedAt: Date.now() };
      _lastPrivateJSON = JSON.stringify(empty);
      docRef.set(empty).then(markPrivateLoaded);
    }
  }, err => {
    console.error('Erro Firestore (privado):', err);
    markPrivateLoaded();
  });
}

function detachListeners() {
  if (unsubShared)  { unsubShared();  unsubShared  = null; }
  if (unsubPrivate) { unsubPrivate(); unsubPrivate = null; }
  if (unsubSharedRem) { unsubSharedRem(); unsubSharedRem = null; }
  _lastSharedJSON = null; _lastPrivateJSON = null; _lastSharedRemJSON = null;
}

/* ---------- LISTENER LEMBRETES COMPARTILHADOS ---------- */
function attachSharedRemListener() {
  const docRef = db.collection(SHARED_COLLECTION).doc(SHARED_REM_DOC_ID);
  unsubSharedRem = docRef.onSnapshot(snap => {
    if (snap.exists) {
      const data = snap.data();
      const incomingJSON = JSON.stringify(data);
      if (incomingJSON === _lastSharedRemJSON) return;
      _lastSharedRemJSON = incomingJSON;
      state.lembretesCompartilhados = data.lembretes || [];
      refreshAllViews();
      scheduleAllAlarms();
    } else {
      const empty = { lembretes:[], updatedAt: Date.now() };
      _lastSharedRemJSON = JSON.stringify(empty);
      docRef.set(empty).catch(()=>{});
    }
  }, err => {
    console.error('Erro Firestore (lembretes compartilhados):', err);
  });
}

function saveSharedRem() {
  clearTimeout(saveSharedRemTimer);
  saveSharedRemTimer = setTimeout(doSaveSharedRem, 500);
}
function doSaveSharedRem() {
  if (!currentUser || !db) return;
  const payload = { lembretes: state.lembretesCompartilhados, updatedAt: Date.now() };
  _lastSharedRemJSON = JSON.stringify(payload);
  db.collection(SHARED_COLLECTION).doc(SHARED_REM_DOC_ID).set(payload)
    .then(() => setSyncStatus('synced'))
    .catch(err => { console.error('Erro ao salvar lembretes compartilhados:', err); setSyncStatus('error'); });
}

// só libera a tela quando AMBOS os documentos carregaram
function markSharedLoaded()  { _sharedLoaded  = true; maybeFinishFirstLoad(); }
function markPrivateLoaded() { _privateLoaded = true; maybeFinishFirstLoad(); }
function maybeFinishFirstLoad() {
  if (_firstSnapshotLoaded) return;
  if (_sharedLoaded && _privateLoaded) finishFirstLoad();
}

function finishFirstLoad() {
  _firstSnapshotLoaded = true;
  hide(qs('#loading-overlay'));
  show(qs('#app'));
  renderHistory();
  renderFavorites();
  renderCategoryChips();
  renderPostIts();
  scheduleAllAlarms();
  updateBadges();
  updateMobileBadges();
  updateListCounts();
}

function refreshAllViews() {
  renderHistory();
  renderFavorites();
  renderCategoryChips();
  renderPostIts();
  scheduleAllAlarms();
  updateBadges();
  updateMobileBadges();
  updateListCounts();
  if (qs('#search-input').value.trim()) doSearch();
  if (qs('#modal-reminders').style.display !== 'none') renderLembretes();
  if (qs('#modal-list').style.display !== 'none') renderListContent();
}

/* ---------- SALVAR ---------- */
// Salva textos/tutoriais/favoritos/histórico no documento COMPARTILHADO
function saveShared() {
  setSyncStatus('saving');
  clearTimeout(saveSharedTimer);
  saveSharedTimer = setTimeout(doSaveShared, 600);
}
function doSaveShared() {
  if (!currentUser || !db) return;
  const payload = {
    textos: state.textos, tutoriais: state.tutoriais,
    contatos: state.contatos, links: state.links, programas: state.programas,
    history, favorites, updatedAt: Date.now()
  };
  _lastSharedJSON = JSON.stringify(payload);
  db.collection(SHARED_COLLECTION).doc(SHARED_DOC_ID).set(payload)
    .then(() => setSyncStatus('synced'))
    .catch(err => { console.error('Erro ao salvar (compartilhado):', err); setSyncStatus('error'); toast('⚠️ Erro ao salvar.','error'); });
}

// Salva lembretes no documento PRIVADO do usuário
function savePrivate() {
  setSyncStatus('saving');
  clearTimeout(savePrivateTimer);
  savePrivateTimer = setTimeout(doSavePrivate, 600);
}
function doSavePrivate() {
  if (!currentUser || !db) return;
  const payload = {
    lembretes: state.lembretes, updatedAt: Date.now()
  };
  _lastPrivateJSON = JSON.stringify(payload);
  db.collection(PRIVATE_COLLECTION).doc(currentUser.uid).set(payload)
    .then(() => setSyncStatus('synced'))
    .catch(err => { console.error('Erro ao salvar (privado):', err); setSyncStatus('error'); toast('⚠️ Erro ao salvar.','error'); });
}

function setSyncStatus(status) {
  const icons = { saving:'🔄', synced:'☁️', error:'⚠️' };
  const titles = { saving:'Salvando…', synced:'Sincronizado', error:'Erro de sincronização' };
  [qs('#sync-status'), qs('#sync-status-mobile'), qs('#sync-status-m2')].forEach(el=>{
    if (!el) return;
    el.textContent = icons[status]||'☁️';
    el.title = titles[status]||'';
  });
}

// saveDB salva nos DOIS documentos (cada um pega só os campos que lhe
// pertencem): compartilhado = textos/tutoriais/fav/histórico,
// privado = lembretes. Assim qualquer alteração é persistida
// no lugar certo sem precisar saber a origem da chamada.
function saveDB()      { saveShared(); savePrivate(); }
function saveHistory() { saveShared(); }
function saveFavs()    { saveShared(); }

/* ═══════════════════════════════════════════════
   BIND EVENTS — tudo em um lugar
   ═══════════════════════════════════════════════ */
function bindEvents() {
  /* ── LOGOUT ── */
  qs('#btn-logout').addEventListener('click', doLogout);

  /* ── MENU HAMBURGER MOBILE ── */
  qs('#hamburger-btn').addEventListener('click', toggleMobileMenu);
  qs('#mobile-menu-overlay').addEventListener('click', closeMobileMenu);

  // espelha ações do desktop no mobile
  const mobileMap = {
    'm-btn-register':  '#btn-open-register',
    'm-btn-contatos':  '#btn-open-contatos',
    'm-btn-links':     '#btn-open-links',
    'm-btn-programas': '#btn-open-programas',
    'm-btn-reminders': '#btn-open-reminders',
    'm-btn-list':      '#btn-open-list',
    'm-btn-logout':    '#btn-logout',
  };
  Object.entries(mobileMap).forEach(([mobileId, desktopId]) => {
    qs(`#${mobileId}`)?.addEventListener('click', () => {
      closeMobileMenu();
      setTimeout(() => qs(desktopId)?.click(), 80);
    });
  });
  // Backup/Restore mobile chamam as funções diretamente
  qs('#m-btn-backup')?.addEventListener('click', () => {
    closeMobileMenu();
    setTimeout(() => doBackup(), 80);
  });
  qs('#m-btn-restore')?.addEventListener('click', () => {
    closeMobileMenu();
    setTimeout(() => qs('#input-restore').click(), 80);
  });

  /* ── BUSCA ── */
  const si = qs('#search-input');
  si.addEventListener('input', () => {
    qs('#search-clear').classList.toggle('visible', si.value.length > 0);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 220);
  });
  si.addEventListener('keydown', e => {
    if (e.key === 'Enter')    { clearTimeout(searchTimer); doSearch(); }
    if (e.key === 'Escape')   { clearSearch(); }
    if (e.key === 'ArrowDown') focusResult(0);
  });
  qs('#search-clear').addEventListener('click', clearSearch);
  qs('#btn-back').addEventListener('click', clearSearch);

  /* ── TABS BUSCA ── */
  qsa('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeType = btn.dataset.type;
      activeCategory = null;
      renderCategoryChips();
      if (qs('#search-input').value.trim()) doSearch();
    });
  });

  /* ── MODAL CADASTRO ── */
  qs('#btn-open-register').addEventListener('click', () => openModal());
  qs('#modal-close').addEventListener('click', closeModal);
  qs('#modal-register').addEventListener('click', e => { if (e.target === qs('#modal-register')) closeModal(); });
  qsa('.modal-tab').forEach(tab => tab.addEventListener('click', () => switchModalTab(tab.dataset.tab)));
  qs('#btn-save-texto').addEventListener('click', saveTexto);
  qs('#btn-save-tutorial').addEventListener('click', saveTutorial);
  qs('#btn-cancel-texto').addEventListener('click', closeModal);
  qs('#btn-cancel-tutorial').addEventListener('click', closeModal);
  qs('#texto-keyword').addEventListener('input', () => renderTagsPreview('texto'));
  qs('#tutorial-keyword').addEventListener('input', () => renderTagsPreview('tutorial'));
  qs('#tutorial-type').addEventListener('change', toggleTutorialFields);

  /* ── EDITOR RICH TEXT ── */
  qsa('.toolbar-btn[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') { const url = prompt('URL:'); if (url) document.execCommand('createLink', false, url); }
      else document.execCommand(cmd, false, null);
      qs('#tutorial-content').focus();
    });
  });
  qs('#btn-insert-image').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = e => insertImageFile(e.target.files[0]);
    inp.click();
  });
  qs('#tutorial-content').addEventListener('paste', e => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) { e.preventDefault(); insertImageFile(item.getAsFile()); break; }
    }
  });

  /* ── TUTORIAL VIEW ── */
  qs('#modal-view-close').addEventListener('click', () => hide(qs('#modal-view-tutorial')));
  qs('#btn-close-tutorial-view').addEventListener('click', () => hide(qs('#modal-view-tutorial')));
  qs('#btn-open-new-tab').addEventListener('click', openTutorialNewTab);
  qs('#btn-open-email-outlook').addEventListener('click', openEmailOutlook);
  qs('#modal-view-tutorial').addEventListener('click', e => { if (e.target === qs('#modal-view-tutorial')) hide(qs('#modal-view-tutorial')); });

  /* ── PLACEHOLDERS ── */
  qs('#ph-close').addEventListener('click', closePlaceholderModal);
  qs('#ph-cancel').addEventListener('click', closePlaceholderModal);
  qs('#modal-placeholders').addEventListener('click', e => { if (e.target === qs('#modal-placeholders')) closePlaceholderModal(); });
  qs('#ph-confirm').addEventListener('click', () => confirmPlaceholders());

  /* ── BACKUP / RESTORE ── */
  // Select "Banco de dados" (desktop): backup ou restore
  qs('#db-select').addEventListener('change', e => {
    const val = e.target.value;
    if (val === 'backup') doBackup();
    if (val === 'restore') qs('#input-restore').click();
    e.target.value = ''; // volta ao label padrão
  });
  qs('#input-restore').addEventListener('change', e => doRestore(e.target.files[0]));

  /* ── PROGRAMAS ── */
  qs('#btn-open-programas').addEventListener('click', openProgramasModal);
  qs('#prog-modal-close').addEventListener('click', () => hide(qs('#modal-programas')));
  qs('#modal-programas').addEventListener('click', e => { if (e.target === qs('#modal-programas')) hide(qs('#modal-programas')); });
  qs('#prog-save').addEventListener('click', savePrograma);
  qs('#prog-cancel').addEventListener('click', resetProgForm);
  qs('#prog-search').addEventListener('input', renderProgramas);

  // editor rico do manual de programa
  qsa('.toolbar-btn[data-prog-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.progCmd, false, null);
      qs('#prog-manual').focus();
    });
  });
  qs('#prog-btn-insert-image').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = e => insertImageInto(e.target.files[0], '#prog-manual');
    inp.click();
  });
  qs('#prog-manual').addEventListener('paste', e => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) { e.preventDefault(); insertImageInto(item.getAsFile(), '#prog-manual'); break; }
    }
  });
  // upload de arquivo (Word/Excel/PPT/PDF)
  qs('#prog-file-btn').addEventListener('click', () => qs('#prog-file-input').click());
  qs('#prog-file-input').addEventListener('change', e => handleProgFileSelect(e.target.files[0]));
  qs('#prog-file-remove').addEventListener('click', removeProgFile);

  /* ── HISTÓRICO ── */
  qs('#btn-clear-history').addEventListener('click', () => {
    history = []; saveHistory(); renderHistory(); toast('Histórico limpo', 'info');
  });

  /* ── LEMBRETES ── */
  qs('#btn-open-reminders').addEventListener('click', openRemindersModal);
  qs('#rem-modal-close').addEventListener('click', () => hide(qs('#modal-reminders')));
  qs('#modal-reminders').addEventListener('click', e => { if (e.target === qs('#modal-reminders')) hide(qs('#modal-reminders')); });
  qs('#rem-save').addEventListener('click', saveLembrete);
  qs('#rem-cancel').addEventListener('click', resetRemForm);
  qs('#share-modal-close').addEventListener('click', closeShareModal);
  qs('#share-cancel-btn').addEventListener('click', closeShareModal);
  qs('#share-confirm-btn').addEventListener('click', confirmShare);
  qs('#modal-share').addEventListener('click', e => { if (e.target === qs('#modal-share')) closeShareModal(); });
  // modal histórico
  qs('#history-modal-close').addEventListener('click', () => hide(qs('#modal-history')));
  qs('#history-close-btn').addEventListener('click', () => hide(qs('#modal-history')));
  qs('#modal-history').addEventListener('click', e => { if (e.target === qs('#modal-history')) hide(qs('#modal-history')); });
  qsa('[data-rem-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('[data-rem-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeRemFilter = btn.dataset.remFilter;
      renderLembretes();
    });
  });

  /* ── ALARME ── */
  qs('#alarm-dismiss').addEventListener('click', dismissAlarm);
  qs('#alarm-snooze').addEventListener('click', snoozeAlarm);

  /* ── CHAMADOS ── */

  /* ── LISTA COMPLETA ── */
  qs('#btn-open-list').addEventListener('click', openListModal);
  qs('#list-modal-close').addEventListener('click', () => hide(qs('#modal-list')));
  qs('#modal-list').addEventListener('click', e => { if (e.target === qs('#modal-list')) hide(qs('#modal-list')); });
  qsa('.list-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      qsa('.list-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeListTab = tab.dataset.listTab;
      renderListContent();
    });
  });
  qs('#list-search').addEventListener('input', renderListContent);

  /* ── CONTATOS ── */
  qs('#btn-open-contatos').addEventListener('click', openContatosModal);
  qs('#contato-modal-close').addEventListener('click', () => hide(qs('#modal-contatos')));
  qs('#modal-contatos').addEventListener('click', e => { if (e.target === qs('#modal-contatos')) hide(qs('#modal-contatos')); });
  qs('#contato-save').addEventListener('click', saveContato);
  qs('#contato-cancel').addEventListener('click', resetContatoForm);
  qs('#contato-search').addEventListener('input', renderContatos);

  /* ── LINKS ── */
  qs('#btn-open-links').addEventListener('click', openLinksModal);
  qs('#link-modal-close').addEventListener('click', () => hide(qs('#modal-links')));
  qs('#modal-links').addEventListener('click', e => { if (e.target === qs('#modal-links')) hide(qs('#modal-links')); });
  qs('#link-save').addEventListener('click', saveLink);
  qs('#link-cancel').addEventListener('click', resetLinkForm);
  qs('#link-search').addEventListener('input', renderLinks);

  /* ── TEMA ── */
  qs('#btn-theme').addEventListener('click', toggleTheme);
  qs('#m-btn-theme').addEventListener('click', () => { closeMobileMenu(); toggleTheme(); });

  /* ── TECLADO GLOBAL ── */
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); focusSearch(); }
    if (e.key === 'Escape') {
      hide(qs('#modal-list'));
      hide(qs('#modal-reminders'));
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const cards = qsa('.result-card');
      if (!cards.length) return;
      const idx = Array.from(cards).indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); cards[Math.min(idx+1, cards.length-1)]?.focus(); }
      else { e.preventDefault(); if (idx<=0) focusSearch(); else cards[idx-1]?.focus(); }
    }
    if (e.key === 'Enter' && document.activeElement.classList.contains('result-card'))
      document.activeElement.click();
  });
}

/* ═══════════════════════════════════════════════
   BUSCA
   ═══════════════════════════════════════════════ */
function doSearch() {
  const query = qs('#search-input').value.trim().toLowerCase();
  if (!query) { clearSearch(); return; }

  let pool = [];
  if (activeType === 'textos'   || activeType === 'todos') pool.push(...state.textos.map(t => ({ ...t, kind: 'texto' })));
  if (activeType === 'tutoriais'|| activeType === 'todos') pool.push(...state.tutoriais.map(t => ({ ...t, kind: 'tutorial' })));
  if (activeCategory) pool = pool.filter(i => (i.category||'').toLowerCase() === activeCategory.toLowerCase());

  const words = query.split(/\s+/);
  const scored = pool.map(item => {
    const hay = [item.keyword||'', item.title||'', item.category||''].join(' ').toLowerCase();
    let score = 0;
    for (const w of words) {
      if (hay.includes(w)) score += 2;
      else if (hay.split(/\s+/).some(h => h.startsWith(w))) score += 1;
    }
    return { ...item, score };
  }).filter(i => i.score > 0).sort((a,b) => b.score - a.score || (b.useCount||0) - (a.useCount||0));

  showResults(scored, query);
}

function showResults(items, query) {
  hide(qs('#panel-history')); hide(qs('#panel-favorites'));
  show(qs('#results-section'));
  qs('#results-count').textContent = `${items.length} resultado${items.length!==1?'s':''} encontrado${items.length!==1?'s':''}`;

  if (!items.length) {
    qs('#results-list').innerHTML = `<div class="empty-state" style="padding:32px;text-align:center">Nenhum resultado para "<strong>${escHtml(query)}</strong>".</div>`;
    return;
  }
  qs('#results-list').innerHTML = items.map(item => renderCard(item, query)).join('');

  qsa('.result-card').forEach(card => {
    card.addEventListener('click', e => { if (e.target.closest('.action-btn')) return; handleCardClick(card.dataset.id, card.dataset.kind); });
    card.addEventListener('keydown', e => { if (e.key==='Enter') handleCardClick(card.dataset.id, card.dataset.kind); });
    card.querySelector('.btn-copy')?.addEventListener('click', e => { e.stopPropagation(); handleCardClick(card.dataset.id, card.dataset.kind); });
    card.querySelector('.btn-fav')?.addEventListener('click', e => { e.stopPropagation(); toggleFav(card.dataset.id, card); });
    card.querySelector('.btn-edit')?.addEventListener('click', e => { e.stopPropagation(); openModalEdit(card.dataset.id, card.dataset.kind); });
    card.querySelector('.btn-delete')?.addEventListener('click', e => { e.stopPropagation(); deleteItem(card.dataset.id, card.dataset.kind); });
  });
}

function renderCard(item, query='') {
  const kind = item.kind;
  const isFav = !!favorites[item.id];
  const text = item.description || item.desc || '';
  const hasPlaceholders = kind==='texto' && /\{[^}]+\}/.test(text);
  const typeIcon = kind==='texto' ? '📝' : getTutorialIcon(item.tutorialType||item.type);
  const copyHint = kind==='texto' ? (hasPlaceholders ? '✏️ Clique para preencher e copiar' : '📋 Clique para copiar') : '👆 Clique para abrir';
  const kw   = highlight(escHtml(item.keyword||''), query);
  const desc = highlight(escHtml(truncate(text||'', 140)), query);
  return `
  <div class="result-card" data-id="${item.id}" data-kind="${kind}" tabindex="0" role="button">
    <div class="card-top">
      <div class="card-badges">
        <span class="badge badge-${kind}">${typeIcon} ${kind==='texto'?'Texto':'Tutorial'}</span>
        ${item.category ? `<span class="badge badge-cat">📁 ${escHtml(item.category)}</span>` : ''}
        ${hasPlaceholders ? `<span class="badge badge-ph">✏️ Placeholders</span>` : ''}
      </div>
      <div class="card-actions">
        ${kind==='texto' ? `<button class="action-btn btn-copy" title="Copiar">📋</button>` : ''}
        <button class="action-btn btn-fav ${isFav?'fav-active':''}">${isFav?'⭐':'☆'}</button>
        <button class="action-btn btn-edit">✏️</button>
        <button class="action-btn btn-delete delete-btn">🗑</button>
      </div>
    </div>
    <div class="card-keyword">${kw}</div>
    <div class="card-desc">${desc}</div>
    <div class="card-footer">
      <span class="copy-hint">${copyHint}</span>
      ${item.useCount ? `<span class="use-count">🔥 ${item.useCount}× usado</span>` : ''}
    </div>
  </div>`;
}

function handleCardClick(id, kind) {
  if (kind === 'texto') {
    const item = state.textos.find(t => t.id===id); if (!item) return;
    const text = item.description||item.desc||'';
    const phs = extractManualPlaceholders(text);
    const autoPhs = extractPlaceholders(text).filter(p => isAutoPlaceholder(p));
    if (phs.length > 0 || autoPhs.length > 0) openPlaceholderModal(item, text, extractPlaceholders(text));
    else finalizeCopy(id, text);
  } else {
    const item = state.tutoriais.find(t => t.id===id); if (!item) return;
    currentTutorialId = id;
    incrementUse(id,'tutorial');
    addToHistory(item,'tutorial');
    openTutorialView(item);
  }
}

/* ═══════════════════════════════════════════════
   TUTORIAL VIEW
   ═══════════════════════════════════════════════ */
function openTutorialView(item) {
  qs('#view-tutorial-title').textContent = item.title||item.keyword;
  qs('#view-tutorial-meta').innerHTML = `
    <span class="badge badge-tutorial">${getTutorialIcon(item.tutorialType||item.type)} ${getTutorialTypeLabel(item.tutorialType||item.type)}</span>
    ${item.category ? `<span class="badge badge-cat">📁 ${escHtml(item.category)}</span>` : ''}
  `;
  const body = qs('#view-tutorial-body');
  let html = '';
  if (item.description) html += `<p><em>${escHtml(item.description)}</em></p><hr style="border-color:var(--border);margin:14px 0">`;
  if (item.content) html += item.content;
  else if (item.url) html += `<p><a href="${escHtml(item.url)}" target="_blank">${escHtml(item.url)}</a></p>`;
  body.innerHTML = html || '<p style="color:var(--text-muted)">Sem conteúdo.</p>';
  const isEmail = (item.tutorialType||item.type)==='email';
  qs('#btn-open-new-tab').style.display      = (!isEmail && item.url) ? 'inline-flex' : 'none';
  qs('#btn-open-email-outlook').style.display = isEmail ? 'inline-flex' : 'none';
  // guardar referência para abrir Outlook
  qs('#btn-open-email-outlook').dataset.tutId = item.id;
  show(qs('#modal-view-tutorial'));
}

function openTutorialNewTab() {
  const item = state.tutoriais.find(t => t.id===currentTutorialId); if (!item) return;
  if (item.url) { window.open(item.url, '_blank', 'noopener'); }
  else if (item.content) {
    const win = window.open('','_blank');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escHtml(item.title||item.keyword)}</title>
    <style>body{font-family:Inter,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#222;line-height:1.7}img{max-width:100%;border-radius:6px}h1{margin-bottom:8px}</style>
    </head><body><h1>${escHtml(item.title||item.keyword)}</h1>${item.content}</body></html>`);
    win.document.close();
  }
  hide(qs('#modal-view-tutorial'));
}

/* ═══════════════════════════════════════════════
   MODAL CADASTRO
   ═══════════════════════════════════════════════ */
function openModal(tab='texto') {
  clearForms(); switchModalTab(tab);
  qs('#modal-title-text').textContent = 'Novo Cadastro';
  show(qs('#modal-register'));
  setTimeout(() => qs('#texto-keyword').focus(), 80);
}
function openModalEdit(id, kind) {
  clearForms(); qs('#modal-title-text').textContent = 'Editar';
  if (kind==='texto') {
    const item = state.textos.find(t => t.id===id); if (!item) return;
    switchModalTab('texto');
    qs('#edit-id-texto').value = id;
    qs('#texto-keyword').value = item.keyword||'';
    qs('#texto-category').value = item.category||'';
    qs('#texto-desc').value = item.description||item.desc||'';
    renderTagsPreview('texto');
  } else {
    const item = state.tutoriais.find(t => t.id===id); if (!item) return;
    switchModalTab('tutorial');
    qs('#edit-id-tutorial').value = id;
    qs('#tutorial-keyword').value = item.keyword||'';
    qs('#tutorial-category').value = item.category||'';
    qs('#tutorial-type').value = item.tutorialType||item.type||'doc';
    qs('#tutorial-title').value = item.title||'';
    qs('#tutorial-url').value = item.url||'';
    qs('#tutorial-desc').value = item.description||'';
    qs('#tutorial-content').innerHTML = item.content||'';
    qs('#email-to').value      = item.emailTo||'';
    qs('#email-cc').value      = item.emailCc||'';
    qs('#email-bcc').value     = item.emailBcc||'';
    qs('#email-subject').value = item.emailSubject||'';
    renderTagsPreview('tutorial'); toggleTutorialFields();
  }
  show(qs('#modal-register'));
}
function closeModal() { hide(qs('#modal-register')); clearForms(); }
function clearForms() {
  ['edit-id-texto','texto-keyword','texto-category','texto-desc',
   'edit-id-tutorial','tutorial-keyword','tutorial-category','tutorial-title','tutorial-url','tutorial-desc'].forEach(id => { const el=qs(`#${id}`); if(el) el.value=''; });
  qs('#tutorial-type').value='doc';
  qs('#tutorial-content').innerHTML='';
  qs('#texto-tags-preview').innerHTML='';
  qs('#tutorial-tags-preview').innerHTML='';
  ['email-to','email-cc','email-bcc','email-subject'].forEach(id=>{ const el=qs(`#${id}`); if(el) el.value=''; });
  qs('#group-email-fields').style.display='none';
  qs('#group-tutorial-url').style.display='none';
  qs('#group-tutorial-content').style.display='block';
}
function switchModalTab(tab) {
  qsa('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab===tab));
  qs('#form-texto').style.display   = tab==='texto'    ? 'block' : 'none';
  qs('#form-tutorial').style.display = tab==='tutorial' ? 'block' : 'none';
}
function toggleTutorialFields() {
  const type = qs('#tutorial-type').value;
  qs('#group-tutorial-url').style.display    = (type==='link'||type==='video') ? 'block' : 'none';
  qs('#group-email-fields').style.display    = type==='email' ? 'block' : 'none';
  qs('#group-tutorial-content').style.display = type!=='link' ? 'block' : 'none';
}
function renderTagsPreview(prefix) {
  const tags = qs(`#${prefix}-keyword`).value.split(',').map(t=>t.trim()).filter(Boolean);
  qs(`#${prefix}-tags-preview`).innerHTML = tags.map(t=>`<span class="tag-pill">${escHtml(t)}</span>`).join('');
}

/* ── SAVE TEXTO ── */
function saveTexto() {
  const kw=qs('#texto-keyword').value.trim(), desc=qs('#texto-desc').value.trim();
  if (!kw||!desc) { toast('Preencha palavra-chave e descrição','warn'); return; }
  const editId=qs('#edit-id-texto').value;
  if (editId) {
    const idx=state.textos.findIndex(t=>t.id===editId);
    if (idx>-1) state.textos[idx]={...state.textos[idx], keyword:kw, category:qs('#texto-category').value.trim(), description:desc};
    toast('✅ Texto atualizado!','success');
  } else {
    state.textos.push({ id:uid(), keyword:kw, category:qs('#texto-category').value.trim(), description:desc, useCount:0, createdAt:Date.now() });
    toast('✅ Texto cadastrado!','success');
  }
  saveDB(); renderCategoryChips(); closeModal(); updateListCounts();
  if (qs('#search-input').value.trim()) doSearch();
}

/* ── SAVE TUTORIAL ── */
function saveTutorial() {
  const kw=qs('#tutorial-keyword').value.trim(), title=qs('#tutorial-title').value.trim();
  if (!kw||!title) { toast('Preencha palavra-chave e título','warn'); return; }
  const editId=qs('#edit-id-tutorial').value;
  const tutType = qs('#tutorial-type').value;
  const item = {
    keyword:kw, category:qs('#tutorial-category').value.trim(),
    tutorialType: tutType, title,
    url:         qs('#tutorial-url').value.trim(),
    description: qs('#tutorial-desc').value.trim(),
    content:     qs('#tutorial-content').innerHTML,
    // campos de email
    emailTo:      tutType==='email' ? qs('#email-to').value.trim()      : '',
    emailCc:      tutType==='email' ? qs('#email-cc').value.trim()      : '',
    emailBcc:     tutType==='email' ? qs('#email-bcc').value.trim()     : '',
    emailSubject: tutType==='email' ? qs('#email-subject').value.trim() : '',
    createdAt:    Date.now()
  };
  if (editId) {
    const idx=state.tutoriais.findIndex(t=>t.id===editId);
    if (idx>-1) state.tutoriais[idx]={...state.tutoriais[idx],...item};
    toast('✅ Tutorial atualizado!','success');
  } else {
    state.tutoriais.push({ id:uid(), useCount:0, ...item });
    toast('✅ Tutorial cadastrado!','success');
  }
  saveDB(); renderCategoryChips(); closeModal(); updateListCounts();
  if (qs('#search-input').value.trim()) doSearch();
}

/* ── DELETE ── */
function deleteItem(id, kind) {
  if (!confirm('Confirma exclusão?')) return;
  if (kind==='texto')    state.textos    = state.textos.filter(t=>t.id!==id);
  else                   state.tutoriais = state.tutoriais.filter(t=>t.id!==id);
  delete favorites[id];
  history = history.filter(h=>h.id!==id);
  saveDB(); saveFavs(); saveHistory();
  renderHistory(); renderFavorites(); renderCategoryChips(); updateListCounts();
  toast('🗑 Item removido','info');
  if (qs('#search-input').value.trim()) doSearch();
}

/* ═══════════════════════════════════════════════
   FAVORITOS
   ═══════════════════════════════════════════════ */
function toggleFav(id, card) {
  if (favorites[id]) {
    delete favorites[id];
    if (card) { card.querySelector('.btn-fav')?.classList.remove('fav-active'); card.querySelector('.btn-fav').textContent='☆'; }
    toast('Removido dos favoritos','info');
  } else {
    favorites[id]=true;
    if (card) { card.querySelector('.btn-fav')?.classList.add('fav-active'); card.querySelector('.btn-fav').textContent='⭐'; }
    toast('⭐ Adicionado aos favoritos!','success');
  }
  saveFavs(); renderFavorites();
}
function renderFavorites() {
  const list=qs('#favorites-list'), ids=Object.keys(favorites);
  if (!ids.length) { list.innerHTML='<span class="empty-state">Nenhum favorito ainda.</span>'; return; }
  list.innerHTML = ids.map(id=>{
    const t=state.textos.find(x=>x.id===id), tu=state.tutoriais.find(x=>x.id===id);
    const item=t||tu; if (!item) return '';
    return `<div class="fav-chip" data-id="${id}" data-kind="${t?'texto':'tutorial'}">
      <span>${t?'📝':'📘'}</span><span>${escHtml(truncate(item.keyword||'',30))}</span>
    </div>`;
  }).join('');
  qsa('.fav-chip').forEach(chip => {
    chip.addEventListener('click', ()=>{ qs('#search-input').value=chip.querySelector('span:last-child').textContent; qs('#search-clear').classList.add('visible'); doSearch(); });
  });
}

/* ═══════════════════════════════════════════════
   HISTÓRICO
   ═══════════════════════════════════════════════ */
function addToHistory(item, kind) {
  history = history.filter(h=>h.id!==item.id);
  history.unshift({ id:item.id, kind, keyword:item.keyword||item.title });
  if (history.length>15) history=history.slice(0,15);
  saveHistory(); renderHistory();
}
function renderHistory() {
  const list=qs('#history-list');
  if (!history.length) { list.innerHTML='<span class="empty-state">Nenhum item acessado ainda.</span>'; return; }
  list.innerHTML = history.map(h=>`
    <div class="history-chip" data-id="${h.id}" data-kind="${h.kind}" title="${escHtml(h.keyword||'')}">
      ${h.kind==='texto'?'📝':'📘'}<span>${escHtml(truncate(h.keyword||'',28))}</span>
    </div>`).join('');
  qsa('.history-chip').forEach(chip => chip.addEventListener('click', ()=>handleCardClick(chip.dataset.id, chip.dataset.kind)));
}

/* ═══════════════════════════════════════════════
   CATEGORIAS
   ═══════════════════════════════════════════════ */
function renderCategoryChips() {
  const cats=new Set();
  const pool = activeType==='textos' ? state.textos : activeType==='tutoriais' ? state.tutoriais : [...state.textos,...state.tutoriais];
  pool.forEach(i=>{ if(i.category) cats.add(i.category); });
  qs('#category-suggestions').innerHTML=[...cats].map(c=>`<option value="${escHtml(c)}">`).join('');
  const chips=qs('#category-chips');
  if (!cats.size) { chips.innerHTML=''; return; }
  chips.innerHTML=[...cats].map(c=>`<button class="chip ${activeCategory===c?'active':''}" data-cat="${escHtml(c)}">${escHtml(c)}</button>`).join('');
  qsa('.chip').forEach(chip=>{
    chip.addEventListener('click',()=>{ activeCategory=activeCategory===chip.dataset.cat?null:chip.dataset.cat; renderCategoryChips(); if(qs('#search-input').value.trim()) doSearch(); });
  });
}

function incrementUse(id, kind) {
  const arr=kind==='texto'?state.textos:state.tutoriais;
  const item=arr.find(t=>t.id===id);
  if (item) { item.useCount=(item.useCount||0)+1; saveDB(); }
}

function clearSearch() {
  qs('#search-input').value=''; qs('#search-clear').classList.remove('visible');
  hide(qs('#results-section')); show(qs('#panel-history')); show(qs('#panel-favorites')); focusSearch();
}
function focusSearch() { qs('#search-input').focus(); }
function focusResult(idx) { qsa('.result-card')[idx]?.focus(); }

/* ═══════════════════════════════════════════════
   PLACEHOLDERS — DATAS AUTOMÁTICAS + CAMPOS LIVRES
   ═══════════════════════════════════════════════ */
const AUTO_PLACEHOLDERS = {
  hoje(d)             { return fmtDate(d); },
  amanha(d)           { return fmtDate(addDays(d,1)); },
  pdata(d)            { return fmtDate(nextBusinessDay(d)); },
  hora(d)             { return fmtTime(d); },
  datahoracompleta(d) { return fmtFull(d); },
};

function nowBrasilia() {
  const now=new Date(), utc=now.getTime()+now.getTimezoneOffset()*60000;
  return new Date(utc-3*3600000);
}
function addDays(d,n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function nextBusinessDay(d) { let next=addDays(d,1); while(next.getDay()===0||next.getDay()===6) next=addDays(next,1); return next; }
function fmtDate(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }
function fmtTime(d) { return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function fmtFull(d) {
  const dias=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const meses=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${dias[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()} às ${fmtTime(d)}`;
}
function resolveAutoPlaceholders(text) {
  const now=nowBrasilia();
  return text.replace(/\{([^}]+)\}/g,(match,name)=>{
    const key=name.trim().toLowerCase();
    if (AUTO_PLACEHOLDERS[key]) return AUTO_PLACEHOLDERS[key](now);
    return match;
  });
}
function isAutoPlaceholder(name) { return !!AUTO_PLACEHOLDERS[name.trim().toLowerCase()]; }
function extractManualPlaceholders(text) {
  const matches=[...text.matchAll(/\{([^}]+)\}/g)];
  return [...new Set(matches.map(m=>m[1]))].filter(ph=>!isAutoPlaceholder(ph));
}
function extractPlaceholders(text) {
  return [...new Set([...text.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]))];
}
function getAutoMeta(name) {
  const now=nowBrasilia(), key=name.trim().toLowerCase();
  const map={
    hoje:             {label:'Data de hoje',         icon:'📅', value:fmtDate(now)},
    amanha:           {label:'Data de amanhã',        icon:'📅', value:fmtDate(addDays(now,1))},
    pdata:            {label:'Próximo dia útil',      icon:'📅', value:fmtDate(nextBusinessDay(now))},
    hora:             {label:'Hora atual (Brasília)', icon:'🕐', value:fmtTime(now)},
    datahoracompleta: {label:'Data e hora completa',  icon:'🗓', value:fmtFull(now)},
  };
  return map[key]||null;
}
function buildPreview(text, manualValues) {
  const now=nowBrasilia();
  return text.replace(/\{([^}]+)\}/g,(match,name)=>{
    const key=name.trim().toLowerCase();
    if (AUTO_PLACEHOLDERS[key]) return `<span class="ph-auto" title="Automático">${escHtml(AUTO_PLACEHOLDERS[key](now))}</span>`;
    const val=(manualValues[name]||'').trim();
    if (val) return `<span class="ph-filled">${escHtml(val)}</span>`;
    return `<span class="ph-pending">{${escHtml(name)}}</span>`;
  });
}

let _phItemId='', _phRawText='';

function openPlaceholderModal(item, text, allPhs) {
  _phItemId=item.id; _phRawText=text;
  qs('#ph-keyword-label').textContent=item.keyword||'';
  const manualPhs=extractManualPlaceholders(text), autoPhs=allPhs.filter(ph=>isAutoPlaceholder(ph));
  let html='';
  if (autoPhs.length) {
    html+=`<div class="ph-auto-block"><div class="ph-auto-title">⚡ Preenchidos automaticamente</div><div class="ph-auto-list">
      ${autoPhs.map(ph=>{ const m=getAutoMeta(ph); return `<div class="ph-auto-item"><span class="ph-tag ph-tag-auto">{${escHtml(ph)}}</span><span class="ph-auto-desc">${m?m.icon+' '+m.label:''}</span><span class="ph-auto-val">${m?escHtml(m.value):''}</span></div>`; }).join('')}
    </div></div>`;
  }
  if (manualPhs.length) {
    html+=manualPhs.map(ph=>`<div class="ph-field-group"><label><span class="ph-tag">{${escHtml(ph)}}</span>${escHtml(capitalizeFirst(ph))}</label><input type="text" class="ph-input" data-ph="${escHtml(ph)}" placeholder="Valor para {${escHtml(ph)}}…" autocomplete="off"/></div>`).join('');
  }
  qs('#ph-fields').innerHTML = html || '<div class="empty-state">Sem campos manuais.</div>';
  qs('#ph-preview').innerHTML = buildPreview(text, {});
  qs('#ph-fields').querySelectorAll('.ph-input').forEach(input=>{
    input.addEventListener('input',()=>{
      input.classList.toggle('ph-input-filled', input.value.trim().length>0);
      qs('#ph-preview').innerHTML=buildPreview(text, getCurrentPhValues());
    });
    input.addEventListener('keydown',e=>{
      if (e.key==='Enter') { const inputs=[...qs('#ph-fields').querySelectorAll('.ph-input')]; const idx=inputs.indexOf(input); if(idx<inputs.length-1) inputs[idx+1].focus(); else confirmPlaceholders(); }
      if (e.key==='Escape') closePlaceholderModal();
    });
  });
  show(qs('#modal-placeholders'));
  setTimeout(()=>{ const f=qs('#ph-fields').querySelector('.ph-input'); if(f) f.focus(); else qs('#ph-confirm').focus(); }, 80);
}
function getCurrentPhValues() {
  const vals={}; qsa('#ph-fields .ph-input').forEach(i=>{ vals[i.dataset.ph]=i.value; }); return vals;
}
function confirmPlaceholders() {
  let filled=resolveAutoPlaceholders(_phRawText);
  const vals=getCurrentPhValues();
  filled=filled.replace(/\{([^}]+)\}/g,(_,name)=>(vals[name]||'').trim()||`{${name}}`);
  closePlaceholderModal(); finalizeCopy(_phItemId, filled);
}
function closePlaceholderModal() {
  hide(qs('#modal-placeholders')); qs('#ph-fields').innerHTML=''; qs('#ph-preview').innerHTML=''; _phItemId=''; _phRawText='';
}
function finalizeCopy(id, text) {
  copyToClipboard(text); incrementUse(id,'texto');
  const item=state.textos.find(t=>t.id===id); if(item) addToHistory(item,'texto');
  const card=qs(`.result-card[data-id="${id}"]`);
  if (card) { card.classList.add('copied'); setTimeout(()=>card.classList.remove('copied'),1200); }
  toast('✅ Copiado para a área de transferência!','success');
}

/* ═══════════════════════════════════════════════
   DIRETÓRIO DE USUÁRIOS + COMPARTILHAMENTO
   ═══════════════════════════════════════════════ */

// Registra (ou atualiza) o usuário atual no diretório, para que outros
// possam escolhê-lo como destinatário de um lembrete compartilhado.
function registerUserDirectory(user) {
  if (!db || !user) return;
  db.collection(USERS_COLLECTION).doc(user.uid).set({
    uid: user.uid,
    email: user.email,
    lastSeen: Date.now()
  }, { merge: true }).catch(err => console.warn('Não foi possível registrar no diretório:', err));
}

// Carrega a lista de usuários (exceto eu mesmo) para o seletor de compartilhamento.
function loadUsersDirectory() {
  if (!db) return;
  db.collection(USERS_COLLECTION).get().then(snap => {
    usersDirectory = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.uid && d.uid !== currentUser?.uid) usersDirectory.push({ uid: d.uid, email: d.email });
    });
  }).catch(err => console.warn('Não foi possível carregar usuários:', err));
}

// Abre o modal de compartilhamento para um lembrete (com checkboxes).
function openShareModal(reminderId) {
  _shareReminderId = reminderId;
  const l = state.lembretes.find(x => x.id === reminderId);
  if (!l) return;

  qs('#share-reminder-title').textContent = l.title;

  const listEl = qs('#share-user-list');
  if (!usersDirectory.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:16px">Nenhum outro usuário encontrado. Peça para a outra pessoa fazer login ao menos uma vez no sistema.</div>';
    qs('#share-confirm-btn').style.display = 'none';
  } else {
    qs('#share-confirm-btn').style.display = 'inline-flex';
    listEl.innerHTML = `
      <label class="share-check-row share-check-all">
        <input type="checkbox" id="share-check-all" />
        <span class="share-user-avatar">👥</span>
        <span class="share-user-email"><strong>Todos os usuários</strong></span>
      </label>
      <div class="share-divider-line"></div>
      ${usersDirectory.map(u => `
        <label class="share-check-row">
          <input type="checkbox" class="share-check-user" value="${escHtml(u.uid)}" data-email="${escHtml(u.email)}" />
          <span class="share-user-avatar">👤</span>
          <span class="share-user-email">${escHtml(u.email)}</span>
        </label>
      `).join('')}
    `;
    // "Todos" marca/desmarca os demais
    qs('#share-check-all').addEventListener('change', e => {
      qsa('.share-check-user').forEach(cb => { cb.checked = e.target.checked; cb.disabled = e.target.checked; });
    });
  }
  show(qs('#modal-share'));
}

function closeShareModal() {
  hide(qs('#modal-share'));
  _shareReminderId = null;
}

// Confirma o compartilhamento: move o lembrete para o documento COMPARTILHADO,
// registrando os destinatários e iniciando o histórico de edições.
function confirmShare() {
  const original = state.lembretes.find(x => x.id === _shareReminderId);
  if (!original) return;

  const all = qs('#share-check-all')?.checked;
  let targets = [];   // lista de emails destinatários (além do dono)
  if (all) {
    targets = usersDirectory.map(u => u.email);
  } else {
    qsa('.share-check-user:checked').forEach(cb => targets.push(cb.dataset.email));
  }

  if (!all && !targets.length) { toast('Selecione ao menos um usuário.','warn'); return; }

  // Cria o lembrete compartilhado (versão única e sincronizada)
  const shared = {
    ...original,
    sharedWithAll: !!all,
    sharedWith: all ? [] : targets,   // vazio = todos
    owner: currentUser.email,
    history: [{
      action: 'Compartilhou',
      by: currentUser.email,
      at: Date.now()
    }]
  };

  state.lembretesCompartilhados.push(shared);
  // remove do privado (virou compartilhado)
  state.lembretes = state.lembretes.filter(x => x.id !== _shareReminderId);

  saveDB();           // salva o privado (sem o lembrete movido)
  saveSharedRem();    // salva o compartilhado (com o novo)
  closeShareModal();
  renderLembretes();
  renderPostIts();
  updateBadges();
  toast(all ? '📤 Compartilhado com todos!' : `📤 Compartilhado com ${targets.length} usuário(s)!`, 'success');
}

// Verifica se o usuário atual pode ver um lembrete compartilhado
function canSeeShared(l) {
  if (l.sharedWithAll) return true;
  if (l.owner === currentUser?.email) return true;
  return (l.sharedWith || []).includes(currentUser?.email);
}

// Registra uma entrada no histórico de um lembrete compartilhado
function addSharedHistory(l, action) {
  if (!l.history) l.history = [];
  l.history.push({ action, by: currentUser.email, at: Date.now() });
}

// Abre o modal de histórico de edições de um lembrete compartilhado
function openHistoryModal(id) {
  const l = state.lembretesCompartilhados.find(x => x.id === id);
  if (!l) return;
  qs('#history-reminder-title').textContent = l.title;
  const body = qs('#history-list-body');
  const hist = [...(l.history||[])].reverse();
  if (!hist.length) {
    body.innerHTML = '<div class="empty-state" style="padding:16px">Sem histórico.</div>';
  } else {
    body.innerHTML = hist.map(h => {
      const d = new Date(h.at);
      return `<div class="history-entry">
        <span class="history-action">${escHtml(h.action)}</span>
        <span class="history-by">👤 ${escHtml(h.by)}</span>
        <span class="history-at">${fmtDate(d)} ${fmtTime(d)}</span>
      </div>`;
    }).join('');
  }
  show(qs('#modal-history'));
}

/* ═══════════════════════════════════════════════
   LEMBRETES
   ═══════════════════════════════════════════════ */
function openRemindersModal() {
  resetRemForm();
  renderLembretes();
  show(qs('#modal-reminders'));
  // pré-preencher data/hora atual
  const now=nowBrasilia();
  qs('#rem-date').value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  qs('#rem-time').value=fmtTime(now);
}

function saveLembrete() {
  const title=qs('#rem-title').value.trim(), date=qs('#rem-date').value, time=qs('#rem-time').value;
  if (!title||!date||!time) { toast('Preencha título, data e hora','warn'); return; }

  const editId=qs('#rem-edit-id').value;
  const isSharedEdit = qs('#rem-edit-shared').value === '1';
  const item = {
    title, date, time,
    desc:       qs('#rem-desc').value.trim(),
    priority:   qs('#rem-priority').value,
    recurrence: qs('#rem-recurrence').value,
    alarm:      qs('#rem-alarm').checked,
  };

  if (editId && isSharedEdit) {
    // editar lembrete COMPARTILHADO — registra no histórico
    const idx=state.lembretesCompartilhados.findIndex(l=>l.id===editId);
    if (idx>-1) {
      state.lembretesCompartilhados[idx]={...state.lembretesCompartilhados[idx],...item};
      addSharedHistory(state.lembretesCompartilhados[idx], 'Editou');
      saveSharedRem();
    }
    toast('✅ Lembrete compartilhado atualizado!','success');
  } else if (editId) {
    // editar lembrete PRIVADO
    const idx=state.lembretes.findIndex(l=>l.id===editId);
    if (idx>-1) state.lembretes[idx]={...state.lembretes[idx],...item};
    saveDB();
    toast('✅ Lembrete atualizado!','success');
  } else {
    // novo lembrete (sempre privado)
    state.lembretes.push({ id:uid(), snoozed:false, done:false, createdAt:Date.now(), ...item });
    saveDB();
    toast('✅ Lembrete cadastrado!','success');
  }
  resetRemForm(); renderLembretes(); scheduleAllAlarms(); updateBadges(); updateListCounts();
}

function resetRemForm() {
  qs('#rem-edit-id').value=''; qs('#rem-edit-shared').value=''; qs('#rem-form-title').textContent='Novo lembrete';
  qs('#rem-title').value=''; qs('#rem-desc').value=''; qs('#rem-priority').value='media';
  qs('#rem-recurrence').value='none'; qs('#rem-alarm').checked=true;
  const now=nowBrasilia();
  qs('#rem-date').value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  qs('#rem-time').value=fmtTime(now);
}

function renderLembretes() {
  const list=qs('#rem-list');

  // Une privados + compartilhados que o usuário pode ver, marcando o tipo
  const privados = state.lembretes.map(l => ({ ...l, _shared:false }));
  const compart  = state.lembretesCompartilhados
    .filter(canSeeShared)
    .map(l => ({ ...l, _shared:true }));
  let items = [...privados, ...compart].sort((a,b)=>{
    const da=new Date(`${a.date}T${a.time}`), db=new Date(`${b.date}T${b.time}`);
    return da-db;
  });

  if (activeRemFilter==='pending') items=items.filter(l=>!l.done);
  if (activeRemFilter==='done')    items=items.filter(l=>l.done);

  if (!items.length) { list.innerHTML='<div class="empty-state" style="padding:20px">Nenhum lembrete.</div>'; return; }

  const now=Date.now();
  list.innerHTML=items.map(l=>{
    const dt=new Date(`${l.date}T${l.time}`);
    const isOverdue=!l.done && dt.getTime()<now;
    const prioLabel={baixa:'🟢 Baixa',media:'🟡 Média',alta:'🟠 Alta',urgente:'🔴 Urgente'}[l.priority]||'';
    const recLabel={none:'',daily:'🔁 Diária',weekly:'🔁 Semanal',workdays:'🔁 Dias úteis'}[l.recurrence]||'';

    // info de compartilhamento
    let shareInfo = '';
    if (l._shared) {
      const alvo = l.sharedWithAll ? 'todos' : `${(l.sharedWith||[]).length} usuário(s)`;
      const ehDono = l.owner === currentUser?.email;
      shareInfo = `<span class="rem-meta-pill" style="color:var(--cyan)">🔗 Compartilhado (${alvo})</span>`
        + (ehDono ? '' : `<span class="rem-meta-pill" style="color:var(--violet)">de ${escHtml(l.owner)}</span>`);
    }

    return `<div class="rem-card prio-${l.priority} ${l.done?'done':''} ${isOverdue?'overdue':''} ${l._shared?'rem-shared':''}" data-id="${l.id}" data-shared="${l._shared}">
      <div class="rem-card-top">
        <div class="rem-card-title">${l._shared?'🔗 ':''}${l.done?'✓ ':''}${escHtml(l.title)}</div>
        <div class="rem-card-actions">
          ${l._shared
            ? `<button class="action-btn rem-btn-history" title="Histórico de edições">🕓</button>`
            : `<button class="action-btn rem-btn-share" title="Compartilhar">📤</button>`}
          <button class="action-btn rem-btn-done" title="${l.done?'Reabrir':'Concluir'}">${l.done?'↩':'✓'}</button>
          <button class="action-btn rem-btn-edit" title="Editar">✏️</button>
          <button class="action-btn btn-delete delete-btn rem-btn-del" title="Deletar">🗑</button>
        </div>
      </div>
      ${l.desc ? `<div class="rem-card-desc">${escHtml(l.desc)}</div>` : ''}
      <div class="rem-card-meta">
        <span class="rem-meta-pill rem-datetime">📅 ${fmtDate(dt)} ${fmtTime(dt)}</span>
        <span class="rem-meta-pill">${prioLabel}</span>
        ${recLabel ? `<span class="rem-meta-pill">${recLabel}</span>` : ''}
        ${l.alarm ? `<span class="rem-meta-pill">🔔</span>` : ''}
        ${isOverdue ? `<span class="rem-meta-pill" style="color:var(--red)">⚠️ Vencido</span>` : ''}
        ${shareInfo}
      </div>
    </div>`;
  }).join('');

  // helper: acha o lembrete (privado ou compartilhado) e a lista correspondente
  function findRem(id, isShared) {
    if (isShared) return state.lembretesCompartilhados.find(x=>x.id===id);
    return state.lembretes.find(x=>x.id===id);
  }

  qsa('.rem-btn-done').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const card=btn.closest('.rem-card');
      const id=card.dataset.id, isShared=card.dataset.shared==='true';
      const l=findRem(id,isShared); if(!l) return;
      l.done=!l.done;
      if (isShared) { addSharedHistory(l, l.done?'Concluiu':'Reabriu'); saveSharedRem(); }
      else saveDB();
      renderLembretes(); updateBadges();
      toast(l.done?'✓ Lembrete concluído!':'↩ Lembrete reaberto','info');
      if (l.done && l.recurrence!=='none' && !isShared) scheduleRecurrence(l);
    });
  });
  qsa('.rem-btn-edit').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const card=btn.closest('.rem-card');
      const id=card.dataset.id, isShared=card.dataset.shared==='true';
      const l=findRem(id,isShared); if(!l) return;
      qs('#rem-edit-id').value=id;
      qs('#rem-edit-shared').value=isShared?'1':'';
      qs('#rem-form-title').textContent= isShared?'Editar lembrete compartilhado':'Editar lembrete';
      qs('#rem-title').value=l.title;
      qs('#rem-desc').value=l.desc||'';
      qs('#rem-date').value=l.date;
      qs('#rem-time').value=l.time;
      qs('#rem-priority').value=l.priority;
      qs('#rem-recurrence').value=l.recurrence;
      qs('#rem-alarm').checked=l.alarm;
      qs('#rem-title').scrollIntoView({behavior:'smooth'});
    });
  });
  qsa('.rem-btn-del').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const card=btn.closest('.rem-card');
      const id=card.dataset.id, isShared=card.dataset.shared==='true';
      if (!confirm(isShared?'Excluir lembrete compartilhado? (será removido para todos)':'Excluir lembrete?')) return;
      if (isShared) { state.lembretesCompartilhados=state.lembretesCompartilhados.filter(x=>x.id!==id); saveSharedRem(); }
      else { state.lembretes=state.lembretes.filter(x=>x.id!==id); saveDB(); }
      renderLembretes(); scheduleAllAlarms(); updateBadges(); updateListCounts();
      toast('🗑 Lembrete removido','info');
    });
  });
  qsa('.rem-btn-share').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      openShareModal(id);
    });
  });
  qsa('.rem-btn-history').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      openHistoryModal(id);
    });
  });
}

/* ── ALARMES ── */
function scheduleAllAlarms() {
  alarmTimers.forEach(clearTimeout); alarmTimers=[];
  const now=Date.now();
  const todos = [
    ...state.lembretes,
    ...state.lembretesCompartilhados.filter(canSeeShared)
  ];
  todos.filter(l=>!l.done && l.alarm).forEach(l=>{
    const dt=new Date(`${l.date}T${l.time}`).getTime();
    const diff=dt-now;
    if (diff>0 && diff<24*60*60*1000) {
      const t=setTimeout(()=>fireAlarm(l.id), diff);
      alarmTimers.push(t);
    }
  });
}

let _currentAlarmId=null;
function fireAlarm(id) {
  const l=state.lembretes.find(x=>x.id===id) || state.lembretesCompartilhados.find(x=>x.id===id); if(!l||l.done) return;
  _currentAlarmId=id;
  qs('#alarm-title').textContent=l.title;
  qs('#alarm-desc').textContent=l.desc||'';
  const prioLabel={baixa:'🟢 Baixa',media:'🟡 Média',alta:'🟠 Alta',urgente:'🔴 Urgente'}[l.priority]||'';
  qs('#alarm-meta').innerHTML=`<span class="badge badge-ph">${prioLabel}</span><span class="badge badge-cat">📅 ${l.date} ${l.time}</span>`;
  show(qs('#modal-alarm'));
  playAlarmSound(l.priority);
  if ('Notification' in window && Notification.permission==='granted') {
    new Notification('⏰ SupportBase — Lembrete', { body: l.title + (l.desc ? '\n'+l.desc:''), icon:'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚡</text></svg>' });
  }
}
function dismissAlarm() {
  hide(qs('#modal-alarm'));
  if (_currentAlarmId) {
    const l=state.lembretes.find(x=>x.id===_currentAlarmId);
    if (l && l.recurrence==='none') { l.done=true; saveDB(); renderLembretes(); updateBadges(); }
  }
  stopAlarmSound(); _currentAlarmId=null;
}
function snoozeAlarm() {
  hide(qs('#modal-alarm')); stopAlarmSound();
  if (_currentAlarmId) {
    const t=setTimeout(()=>fireAlarm(_currentAlarmId), 5*60*1000);
    alarmTimers.push(t);
    toast('⏰ Soneca: 5 minutos','info');
  }
  _currentAlarmId=null;
}
function scheduleRecurrence(l) {
  const dt=new Date(`${l.date}T${l.time}`);
  if (l.recurrence==='daily')    dt.setDate(dt.getDate()+1);
  if (l.recurrence==='weekly')   dt.setDate(dt.getDate()+7);
  if (l.recurrence==='workdays') { dt.setDate(dt.getDate()+1); while(dt.getDay()===0||dt.getDay()===6) dt.setDate(dt.getDate()+1); }
  const newItem={...l, id:uid(), done:false, date:`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`};
  state.lembretes.push(newItem); saveDB(); renderLembretes(); scheduleAllAlarms(); updateBadges();
}

let _audioCtx=null, _alarmGain=null, _alarmOsc=null;
function playAlarmSound(priority) {
  try {
    _audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    _alarmGain=_audioCtx.createGain(); _alarmGain.connect(_audioCtx.destination);
    _alarmGain.gain.setValueAtTime(0.4, _audioCtx.currentTime);
    const freqs={baixa:[440,440],media:[523,659],alta:[659,880],urgente:[880,1046]}[priority]||[523,659];
    function beep(freq, start, dur) {
      const osc=_audioCtx.createOscillator(); osc.type='sine';
      osc.frequency.setValueAtTime(freq, _audioCtx.currentTime+start);
      osc.connect(_alarmGain); osc.start(_audioCtx.currentTime+start); osc.stop(_audioCtx.currentTime+start+dur);
    }
    for (let i=0;i<5;i++) { beep(freqs[0],i*0.5,0.2); beep(freqs[1],i*0.5+0.25,0.2); }
  } catch(e) {}
}
function stopAlarmSound() { try { _alarmGain?.gain.setValueAtTime(0, _audioCtx?.currentTime); } catch(e){} }
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission==='default') Notification.requestPermission();
}

/* ═══════════════════════════════════════════════
   LISTA COMPLETA
   ═══════════════════════════════════════════════ */
function openListModal() {
  updateListCounts();
  renderListContent();
  show(qs('#modal-list'));
}

function updateListCounts() {
  qs('#lt-count-textos').textContent=state.textos.length;
  qs('#lt-count-tutoriais').textContent=state.tutoriais.length;
  qs('#lt-count-lembretes').textContent=state.lembretes.length;
}

function renderListContent() {
  const q=(qs('#list-search').value||'').trim().toLowerCase();
  const container=qs('#list-content');

  if (activeListTab==='textos') {
    let items=state.textos.filter(t=>!q || (t.keyword+t.description+t.category).toLowerCase().includes(q));
    if (!items.length) { container.innerHTML=`<div class="list-empty">Nenhum texto${q?' para "'+escHtml(q)+'"':''}.</div>`; return; }
    container.innerHTML=`<table class="list-table">
      <thead><tr><th>Palavra-chave</th><th>Categoria</th><th>Descrição</th><th>Usos</th><th></th></tr></thead>
      <tbody>${items.map(t=>`<tr data-id="${t.id}">
        <td class="td-title">${escHtml(t.keyword)}</td>
        <td>${escHtml(t.category||'—')}</td>
        <td>${escHtml(truncate(t.description||'',80))}</td>
        <td>${t.useCount||0}</td>
        <td class="td-actions">
          <button class="action-btn lt-edit" data-kind="texto">✏️</button>
          <button class="action-btn btn-delete lt-del" data-kind="texto">🗑</button>
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
  else if (activeListTab==='tutoriais') {
    let items=state.tutoriais.filter(t=>!q || (t.keyword+(t.title||'')+t.category).toLowerCase().includes(q));
    if (!items.length) { container.innerHTML=`<div class="list-empty">Nenhum tutorial.</div>`; return; }
    container.innerHTML=`<table class="list-table">
      <thead><tr><th>Palavra-chave</th><th>Título</th><th>Categoria</th><th>Tipo</th><th>Usos</th><th></th></tr></thead>
      <tbody>${items.map(t=>`<tr data-id="${t.id}">
        <td class="td-title">${escHtml(t.keyword)}</td>
        <td>${escHtml(truncate(t.title||'',60))}</td>
        <td>${escHtml(t.category||'—')}</td>
        <td>${getTutorialIcon(t.tutorialType||t.type)} ${getTutorialTypeLabel(t.tutorialType||t.type)}</td>
        <td>${t.useCount||0}</td>
        <td class="td-actions">
          <button class="action-btn lt-view" data-kind="tutorial">👁</button>
          <button class="action-btn lt-edit" data-kind="tutorial">✏️</button>
          <button class="action-btn btn-delete lt-del" data-kind="tutorial">🗑</button>
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
  else if (activeListTab==='lembretes') {
    let items=[...state.lembretes].sort((a,b)=>new Date(`${a.date}T${a.time}`)-new Date(`${b.date}T${b.time}`))
      .filter(l=>!q || (l.title+(l.desc||'')).toLowerCase().includes(q));
    if (!items.length) { container.innerHTML=`<div class="list-empty">Nenhum lembrete.</div>`; return; }
    const prioLabel={baixa:'🟢',media:'🟡',alta:'🟠',urgente:'🔴'};
    container.innerHTML=`<table class="list-table">
      <thead><tr><th>Título</th><th>Data/Hora</th><th>Prioridade</th><th>Recorrência</th><th>Status</th><th></th></tr></thead>
      <tbody>${items.map(l=>{
        const dt=new Date(`${l.date}T${l.time}`);
        const isOverdue=!l.done&&dt.getTime()<Date.now();
        return `<tr data-id="${l.id}" style="${isOverdue?'color:var(--red)':''}">
          <td class="td-title">${l.done?'✓ ':''}${escHtml(l.title)}</td>
          <td style="white-space:nowrap">${fmtDate(dt)} ${fmtTime(dt)}</td>
          <td>${prioLabel[l.priority]||''} ${l.priority}</td>
          <td>${l.recurrence==='none'?'Única':l.recurrence}</td>
          <td>${l.done?'<span style="color:var(--green)">Concluído</span>':isOverdue?'<span style="color:var(--red)">Vencido</span>':'<span style="color:var(--cyan)">Pendente</span>'}</td>
          <td class="td-actions">
            <button class="action-btn lt-rem-edit">✏️</button>
            <button class="action-btn btn-delete lt-rem-del">🗑</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }
  /* bind list actions */
  qsa('.lt-view').forEach(btn=>{
    const id=btn.closest('tr').dataset.id;
    btn.addEventListener('click',()=>{ const item=state.tutoriais.find(t=>t.id===id); if(item){ currentTutorialId=id; openTutorialView(item); } });
  });
  qsa('.lt-edit').forEach(btn=>{
    const id=btn.closest('tr').dataset.id, kind=btn.dataset.kind;
    btn.addEventListener('click',()=>{ hide(qs('#modal-list')); openModalEdit(id,kind); });
  });
  qsa('.lt-del').forEach(btn=>{
    const id=btn.closest('tr').dataset.id, kind=btn.dataset.kind;
    btn.addEventListener('click',()=>{ deleteItem(id,kind); renderListContent(); updateListCounts(); });
  });
  qsa('.lt-rem-edit').forEach(btn=>{
    const id=btn.closest('tr').dataset.id;
    btn.addEventListener('click',()=>{ hide(qs('#modal-list')); openRemindersModal(); setTimeout(()=>{ const l=state.lembretes.find(x=>x.id===id); if(!l) return; qs('#rem-edit-id').value=id; qs('#rem-form-title').textContent='Editar lembrete'; qs('#rem-title').value=l.title; qs('#rem-desc').value=l.desc||''; qs('#rem-date').value=l.date; qs('#rem-time').value=l.time; qs('#rem-priority').value=l.priority; qs('#rem-recurrence').value=l.recurrence; qs('#rem-alarm').checked=l.alarm; },200); });
  });
  qsa('.lt-rem-del').forEach(btn=>{
    const id=btn.closest('tr').dataset.id;
    btn.addEventListener('click',()=>{ if(!confirm('Excluir lembrete?')) return; state.lembretes=state.lembretes.filter(x=>x.id!==id); saveDB(); updateBadges(); renderListContent(); updateListCounts(); toast('🗑 Lembrete removido','info'); });
  });
}

/* ═══════════════════════════════════════════════
   BADGES
   ═══════════════════════════════════════════════ */
function updateBadges() {
  const pending=[...state.lembretes, ...state.lembretesCompartilhados.filter(canSeeShared)].filter(l=>!l.done).length;
  const badge=qs('#reminder-badge');
  if (pending>0) { badge.textContent=pending; show(badge); } else hide(badge);

  updateMobileBadges();
  renderPostIts();
}

/* ═══════════════════════════════════════════════
   BACKUP / RESTORE
   ═══════════════════════════════════════════════ */
function doBackup() {
  const data={ version:5, exportedAt:new Date().toISOString(), textos:state.textos, tutoriais:state.tutoriais, lembretes:state.lembretes, contatos:state.contatos, links:state.links, programas:state.programas, favorites, history };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`supportbase_backup_${dateStr()}.json`; a.click(); URL.revokeObjectURL(url);
  toast('⬇ Backup gerado!','success');
}
function doRestore(file) {
  if (!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const data=JSON.parse(e.target.result);
      if (!data.textos||!data.tutoriais) throw new Error('Inválido');
      if (!confirm(`Restaurar backup de ${data.exportedAt||'data desconhecida'}?\nIsso SUBSTITUIRÁ todos os dados.`)) return;
      state.textos    = data.textos    || [];
      state.tutoriais = data.tutoriais || [];
      state.lembretes = data.lembretes || [];
      state.contatos  = data.contatos  || [];
      state.links     = data.links     || [];
      state.programas = data.programas || [];
      favorites=data.favorites||{}; history=data.history||[];
      saveDB(); saveFavs(); saveHistory();
      renderHistory(); renderFavorites(); renderCategoryChips(); updateBadges(); updateListCounts(); scheduleAllAlarms();
      toast('⬆ Backup restaurado!','success');
    } catch { toast('❌ Arquivo inválido','error'); }
    qs('#input-restore').value='';
  };
  reader.readAsText(file);
}

/* ═══════════════════════════════════════════════
   CLIPBOARD + IMAGEM
   ═══════════════════════════════════════════════ */
async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta=document.createElement('textarea'); ta.value=text; ta.style.cssText='position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
}
function insertImageFile(file) { insertImageInto(file, '#tutorial-content'); }

// Insere uma imagem (como dataURL) dentro do editor indicado pelo seletor
function insertImageInto(file, editorSel) {
  if (!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=document.createElement('img'); img.src=e.target.result; img.style.maxWidth='100%';
    const editor=qs(editorSel); editor.focus();
    const sel=window.getSelection();
    if (sel&&sel.rangeCount && editor.contains(sel.anchorNode)) { const r=sel.getRangeAt(0); r.insertNode(img); r.collapse(false); }
    else editor.appendChild(img);
  };
  reader.readAsDataURL(file);
}

/* ═══════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════ */
let toastTimer;
function toast(msg, type='info') {
  const el=qs('#toast'); el.textContent=msg; el.className=`toast show ${type}`;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
}

/* ═══════════════════════════════════════════════
   MENU HAMBURGER MOBILE
   ═══════════════════════════════════════════════ */
function toggleMobileMenu() {
  const menu    = qs('#mobile-menu');
  const overlay = qs('#mobile-menu-overlay');
  const btn     = qs('#hamburger-btn');
  const isOpen  = menu.style.display === 'block';
  if (isOpen) closeMobileMenu();
  else {
    menu.style.display    = 'block';
    overlay.style.display = 'block';
    btn.classList.add('open');
    menu.setAttribute('aria-hidden','false');
  }
}
function closeMobileMenu() {
  qs('#mobile-menu').style.display    = 'none';
  qs('#mobile-menu-overlay').style.display = 'none';
  qs('#hamburger-btn').classList.remove('open');
  qs('#mobile-menu').setAttribute('aria-hidden','true');
}

// Sincronizar badge mobile com desktop
function updateMobileBadges() {
  const remPending = [...state.lembretes, ...state.lembretesCompartilhados.filter(canSeeShared)].filter(l=>!l.done).length;
  const total = remPending;
  const mb = qs('#mobile-badge-count');
  if (mb) { mb.textContent=total; mb.style.display=total>0?'block':'none'; }
  // badges dentro do menu
  const mrb=qs('#m-reminder-badge'); if(mrb){ mrb.textContent=remPending; mrb.style.display=remPending>0?'inline':'none'; }
  // sync status mobile
  const smob=qs('#sync-status-mobile');
  const sm2=qs('#sync-status-m2');
  const mainSync=qs('#sync-status');
  if(mainSync && smob) smob.textContent=mainSync.textContent;
  if(mainSync && sm2)  sm2.textContent=mainSync.textContent;
}

/* ═══════════════════════════════════════════════
   ABRIR E-MAIL NO OUTLOOK
   ═══════════════════════════════════════════════ */
function openEmailOutlook() {
  const id = qs('#btn-open-email-outlook').dataset.tutId;
  const item = state.tutoriais.find(t=>t.id===id);
  if (!item) return;

  // Resolve placeholders automáticos no assunto e corpo
  const subject = resolveAutoPlaceholders(item.emailSubject||'');
  const bodyHtml = item.content||'';

  // Converte HTML do corpo para texto plano preservando quebras de linha
  const bodyText = htmlToPlainText(bodyHtml);
  const bodyResolved = resolveAutoPlaceholders(bodyText);

  // Monta a URL mailto MANUALMENTE com encodeURIComponent.
  // (NAO usar URLSearchParams: ele codifica espaco como "+", e os
  //  clientes de e-mail interpretam "+" literalmente, deixando o
  //  texto cheio de sinais de mais. encodeURIComponent usa %20.)
  const parts = [];
  if (item.emailCc)  parts.push('cc='      + encodeURIComponent(item.emailCc));
  if (item.emailBcc) parts.push('bcc='     + encodeURIComponent(item.emailBcc));
  if (subject)       parts.push('subject=' + encodeURIComponent(subject));
  if (bodyResolved)  parts.push('body='    + encodeURIComponent(bodyResolved));

  const toField = item.emailTo || '';
  const query   = parts.length ? '?' + parts.join('&') : '';
  const mailto  = `mailto:${encodeURIComponent(toField)}${query}`;

  // Abre no cliente de e-mail padrao (Outlook se configurado)
  window.location.href = mailto;
  hide(qs('#modal-view-tutorial'));
  toast('📧 Abrindo Outlook…','info');
}

/* ═══════════════════════════════════════════════
   POST-ITS DE LEMBRETES (home)
   ═══════════════════════════════════════════════ */
function renderPostIts() {
  const bar    = qs('#postits-bar');
  const scroll = qs('#postits-scroll');
  if (!bar || !scroll) return;

  const now = Date.now();
  // mostrar apenas não concluídos, ordenados por data
  const pending = [...state.lembretes, ...state.lembretesCompartilhados.filter(canSeeShared)]
    .filter(l => !l.done)
    .sort((a,b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));

  if (!pending.length) { hide(bar); return; }
  show(bar);

  const pinColors = { baixa:'📌', media:'📌', alta:'🔴', urgente:'🚨' };

  scroll.innerHTML = pending.map(l => {
    const dt       = new Date(`${l.date}T${l.time}`);
    const isOverdue = dt.getTime() < now;
    const timeStr  = `${fmtDate(dt)} ${fmtTime(dt)}`;
    return `
    <div class="postit prio-${l.priority} ${isOverdue?'overdue':''}" data-id="${l.id}" title="${escHtml(l.title)}">
      <span class="postit-pin">${pinColors[l.priority]||'📌'}</span>
      <div class="postit-title">${escHtml(l.title)}</div>
      <div class="postit-time">${isOverdue?'⚠️ ':''} ${timeStr}</div>
      <button class="postit-done-btn" data-id="${l.id}" title="Marcar como concluído">✓</button>
    </div>`;
  }).join('');

  // Clique no post-it abre modal de lembretes com esse item
  qsa('.postit').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.classList.contains('postit-done-btn')) return;
      openRemindersModal();
    });
  });

  // Botão concluir no próprio post-it
  qsa('.postit-done-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const priv = state.lembretes.find(x=>x.id===id);
      const shar = state.lembretesCompartilhados.find(x=>x.id===id);
      const l = priv || shar;
      if (!l) return;
      l.done = true;
      if (shar) { addSharedHistory(l, 'Concluiu'); saveSharedRem(); }
      else saveDB();
      renderPostIts(); renderLembretes(); updateBadges(); updateMobileBadges();
      toast('✓ Lembrete concluído!','success');
    });
  });
}

/* ═══════════════════════════════════════════════
   CONTATOS (compartilhado)
   ═══════════════════════════════════════════════ */
function openContatosModal() {
  resetContatoForm();
  renderContatos();
  show(qs('#modal-contatos'));
}
function saveContato() {
  const nome=qs('#contato-nome').value.trim();
  if (!nome) { toast('Preencha o nome','warn'); return; }
  const editId=qs('#contato-edit-id').value;
  const item = {
    nome,
    telefone: qs('#contato-telefone').value.trim(),
    teams:    qs('#contato-teams').value.trim(),
    updatedAt: Date.now()
  };
  if (editId) {
    const idx=state.contatos.findIndex(c=>c.id===editId);
    if (idx>-1) state.contatos[idx]={...state.contatos[idx],...item};
    toast('✅ Contato atualizado!','success');
  } else {
    state.contatos.push({ id:uid(), createdAt:Date.now(), ...item });
    toast('✅ Contato cadastrado!','success');
  }
  saveDB(); resetContatoForm(); renderContatos(); updateListCounts();
}
function resetContatoForm() {
  qs('#contato-edit-id').value=''; qs('#contato-form-title').textContent='Novo contato';
  ['contato-nome','contato-telefone','contato-teams'].forEach(id=>{ const el=qs(`#${id}`); if(el) el.value=''; });
}
function renderContatos() {
  const list=qs('#contato-list');
  const query=(qs('#contato-search').value||'').trim().toLowerCase();
  let items=[...state.contatos].sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
  if (query) items=items.filter(c=>(c.nome+(c.telefone||'')+(c.teams||'')).toLowerCase().includes(query));
  if (!items.length) { list.innerHTML='<div class="empty-state" style="padding:20px">Nenhum contato.</div>'; return; }

  list.innerHTML=items.map(c=>`
    <div class="rem-card" data-id="${c.id}" style="border-left-color:var(--cyan)">
      <div class="rem-card-top">
        <div class="rem-card-title">👤 ${escHtml(c.nome)}</div>
        <div class="rem-card-actions">
          <button class="action-btn contato-btn-edit" title="Editar">✏️</button>
          <button class="action-btn btn-delete delete-btn contato-btn-del" title="Deletar">🗑</button>
        </div>
      </div>
      <div class="rem-card-meta">
        ${c.telefone ? `<span class="rem-meta-pill">📞 <a href="tel:${escHtml(c.telefone.replace(/[^0-9+]/g,''))}" style="color:var(--cyan)">${escHtml(c.telefone)}</a></span>` : ''}
        ${c.teams ? `<span class="rem-meta-pill">💬 <a href="https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(c.teams)}" target="_blank" style="color:var(--violet)">${escHtml(c.teams)}</a></span>` : ''}
      </div>
    </div>
  `).join('');

  qsa('.contato-btn-edit').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      const c=state.contatos.find(x=>x.id===id); if(!c) return;
      qs('#contato-edit-id').value=id;
      qs('#contato-form-title').textContent='Editar contato';
      qs('#contato-nome').value=c.nome;
      qs('#contato-telefone').value=c.telefone||'';
      qs('#contato-teams').value=c.teams||'';
      qs('#contato-nome').scrollIntoView({behavior:'smooth'});
    });
  });
  qsa('.contato-btn-del').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      if (!confirm('Excluir contato?')) return;
      state.contatos=state.contatos.filter(x=>x.id!==id);
      saveDB(); renderContatos(); updateListCounts();
      toast('🗑 Contato removido','info');
    });
  });
}

/* ═══════════════════════════════════════════════
   LINKS ÚTEIS (compartilhado)
   ═══════════════════════════════════════════════ */
function openLinksModal() {
  resetLinkForm();
  renderLinks();
  show(qs('#modal-links'));
}
function saveLink() {
  const url=qs('#link-url').value.trim(), desc=qs('#link-desc').value.trim();
  if (!url||!desc) { toast('Preencha nome e link','warn'); return; }
  const editId=qs('#link-edit-id').value;
  const item = { url, desc, updatedAt: Date.now() };
  if (editId) {
    const idx=state.links.findIndex(l=>l.id===editId);
    if (idx>-1) state.links[idx]={...state.links[idx],...item};
    toast('✅ Link atualizado!','success');
  } else {
    state.links.push({ id:uid(), createdAt:Date.now(), ...item });
    toast('✅ Link cadastrado!','success');
  }
  saveDB(); resetLinkForm(); renderLinks(); updateListCounts();
}
function resetLinkForm() {
  qs('#link-edit-id').value=''; qs('#link-form-title').textContent='Novo link';
  qs('#link-url').value=''; qs('#link-desc').value='';
}
function renderLinks() {
  const list=qs('#link-list');
  const query=(qs('#link-search').value||'').trim().toLowerCase();
  let items=[...state.links].sort((a,b)=>(a.desc||'').localeCompare(b.desc||''));
  if (query) items=items.filter(l=>(l.desc+l.url).toLowerCase().includes(query));
  if (!items.length) { list.innerHTML='<div class="empty-state" style="padding:20px">Nenhum link.</div>'; return; }

  list.innerHTML=items.map(l=>`
    <div class="rem-card" data-id="${l.id}" style="border-left-color:var(--green)">
      <div class="rem-card-top">
        <div class="rem-card-title">🔗 ${escHtml(l.desc)}</div>
        <div class="rem-card-actions">
          <button class="action-btn link-btn-open" title="Abrir">↗</button>
          <button class="action-btn link-btn-edit" title="Editar">✏️</button>
          <button class="action-btn btn-delete delete-btn link-btn-del" title="Deletar">🗑</button>
        </div>
      </div>
      <div class="rem-card-meta">
        <span class="rem-meta-pill"><a href="${escHtml(l.url)}" target="_blank" style="color:var(--cyan);word-break:break-all">${escHtml(truncate(l.url,60))}</a></span>
      </div>
    </div>
  `).join('');

  qsa('.link-btn-open').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      const l=state.links.find(x=>x.id===id); if(!l) return;
      window.open(l.url,'_blank','noopener');
    });
  });
  qsa('.link-btn-edit').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      const l=state.links.find(x=>x.id===id); if(!l) return;
      qs('#link-edit-id').value=id;
      qs('#link-form-title').textContent='Editar link';
      qs('#link-url').value=l.url;
      qs('#link-desc').value=l.desc;
      qs('#link-url').scrollIntoView({behavior:'smooth'});
    });
  });
  qsa('.link-btn-del').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      if (!confirm('Excluir link?')) return;
      state.links=state.links.filter(x=>x.id!==id);
      saveDB(); renderLinks(); updateListCounts();
      toast('🗑 Link removido','info');
    });
  });
}

/* ═══════════════════════════════════════════════
   PROGRAMAS (compartilhado)
   ═══════════════════════════════════════════════ */
function openProgramasModal() {
  resetProgForm();
  renderProgramas();
  show(qs('#modal-programas'));
}
function savePrograma() {
  const nome=qs('#prog-nome').value.trim();
  if (!nome) { toast('Preencha o nome do programa','warn'); return; }
  const editId=qs('#prog-edit-id').value;
  const item = {
    nome,
    onedrive: qs('#prog-onedrive').value.trim(),
    manual:   qs('#prog-manual').innerHTML,
    fileUrl:        qs('#prog-file-url').value || '',
    fileName:       qs('#prog-file-name').textContent || '',
    fileStoredName: qs('#prog-file-stored-name').value || '',
    updatedAt: Date.now()
  };
  if (editId) {
    const idx=state.programas.findIndex(p=>p.id===editId);
    if (idx>-1) state.programas[idx]={...state.programas[idx],...item};
    toast('✅ Programa atualizado!','success');
  } else {
    state.programas.push({ id:uid(), createdAt:Date.now(), ...item });
    toast('✅ Programa cadastrado!','success');
  }
  saveDB(); resetProgForm(); renderProgramas(); updateListCounts();
}
function resetProgForm() {
  qs('#prog-edit-id').value=''; qs('#prog-form-title').textContent='Novo programa';
  qs('#prog-nome').value=''; qs('#prog-onedrive').value=''; qs('#prog-manual').innerHTML='';
  // limpar campos de arquivo
  qs('#prog-file-url').value=''; qs('#prog-file-stored-name').value='';
  qs('#prog-file-name').textContent='';
  hide(qs('#prog-file-attached'));
  show(qs('#prog-file-btn'));
  hide(qs('#prog-file-progress'));
}

// ── UPLOAD DE ARQUIVO PARA O FIREBASE STORAGE ──
function handleProgFileSelect(file) {
  if (!file) return;
  if (!storage) { toast('Storage não disponível. Verifique o Firebase.','error'); return; }

  // Limite de segurança: 20 MB
  if (file.size > 20 * 1024 * 1024) {
    toast('Arquivo muito grande (máx. 20 MB).','warn');
    return;
  }

  const storedName = `${uid()}_${file.name}`;
  const ref = storage.ref(`programas/${storedName}`);

  hide(qs('#prog-file-btn'));
  show(qs('#prog-file-progress'));
  qs('#prog-file-bar').style.width = '0%';

  const task = ref.put(file);
  task.on('state_changed',
    snap => {
      const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
      qs('#prog-file-bar').style.width = pct + '%';
    },
    err => {
      console.error('Erro no upload:', err);
      toast('⚠️ Erro ao enviar arquivo.','error');
      hide(qs('#prog-file-progress'));
      show(qs('#prog-file-btn'));
    },
    () => {
      task.snapshot.ref.getDownloadURL().then(url => {
        qs('#prog-file-url').value = url;
        qs('#prog-file-stored-name').value = storedName;
        qs('#prog-file-name').textContent = file.name;
        hide(qs('#prog-file-progress'));
        show(qs('#prog-file-attached'));
        toast('📎 Arquivo anexado!','success');
      });
    }
  );
}

// Remove o arquivo anexado do formulário (e do Storage se já foi enviado)
function removeProgFile() {
  const storedName = qs('#prog-file-stored-name').value;
  if (storedName && storage) {
    storage.ref(`programas/${storedName}`).delete().catch(()=>{});
  }
  qs('#prog-file-url').value='';
  qs('#prog-file-stored-name').value='';
  qs('#prog-file-name').textContent='';
  hide(qs('#prog-file-attached'));
  show(qs('#prog-file-btn'));
}

// Ícone conforme a extensão do arquivo
function fileIcon(name) {
  const ext = (name||'').split('.').pop().toLowerCase();
  if (['doc','docx'].includes(ext)) return '📘';
  if (['xls','xlsx'].includes(ext)) return '📗';
  if (['ppt','pptx'].includes(ext)) return '📙';
  if (ext === 'pdf') return '📕';
  return '📎';
}

function renderProgramas() {
  const list=qs('#prog-list');
  const query=(qs('#prog-search').value||'').trim().toLowerCase();
  let items=[...state.programas].sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
  if (query) items=items.filter(p=>(p.nome||'').toLowerCase().includes(query));
  if (!items.length) { list.innerHTML='<div class="empty-state" style="padding:20px">Nenhum programa.</div>'; return; }

  list.innerHTML=items.map(p=>`
    <div class="rem-card" data-id="${p.id}" style="border-left-color:var(--violet)">
      <div class="rem-card-top">
        <div class="rem-card-title">💿 ${escHtml(p.nome)}</div>
        <div class="rem-card-actions">
          ${p.manual ? `<button class="action-btn prog-btn-view" title="Ver manual">👁</button>` : ''}
          ${p.fileUrl ? `<button class="action-btn prog-btn-file" title="Baixar arquivo">📎</button>` : ''}
          ${p.onedrive ? `<button class="action-btn prog-btn-down" title="Abrir OneDrive">⬇</button>` : ''}
          <button class="action-btn prog-btn-edit" title="Editar">✏️</button>
          <button class="action-btn btn-delete delete-btn prog-btn-del" title="Deletar">🗑</button>
        </div>
      </div>
      <div class="rem-card-meta">
        ${p.onedrive ? `<span class="rem-meta-pill">☁️ <a href="${escHtml(p.onedrive)}" target="_blank" style="color:var(--cyan)">OneDrive</a></span>` : ''}
        ${p.fileUrl ? `<span class="rem-meta-pill">${fileIcon(p.fileName)} <a href="${escHtml(p.fileUrl)}" target="_blank" style="color:var(--green)">${escHtml(truncate(p.fileName||'arquivo',28))}</a></span>` : ''}
        ${p.manual ? `<span class="rem-meta-pill">📄 Manual</span>` : ''}
      </div>
    </div>
  `).join('');

  qsa('.prog-btn-view').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      const p=state.programas.find(x=>x.id===id); if(!p) return;
      openProgManual(p);
    });
  });
  qsa('.prog-btn-file').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      const p=state.programas.find(x=>x.id===id); if(!p||!p.fileUrl) return;
      window.open(p.fileUrl,'_blank','noopener');
    });
  });
  qsa('.prog-btn-down').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      const p=state.programas.find(x=>x.id===id); if(!p||!p.onedrive) return;
      window.open(p.onedrive,'_blank','noopener');
    });
  });
  qsa('.prog-btn-edit').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      const p=state.programas.find(x=>x.id===id); if(!p) return;
      qs('#prog-edit-id').value=id;
      qs('#prog-form-title').textContent='Editar programa';
      qs('#prog-nome').value=p.nome;
      qs('#prog-onedrive').value=p.onedrive||'';
      qs('#prog-manual').innerHTML=p.manual||'';
      // restaurar arquivo anexado
      if (p.fileUrl) {
        qs('#prog-file-url').value=p.fileUrl;
        qs('#prog-file-stored-name').value=p.fileStoredName||'';
        qs('#prog-file-name').textContent=p.fileName||'arquivo';
        show(qs('#prog-file-attached'));
        hide(qs('#prog-file-btn'));
      } else {
        qs('#prog-file-url').value=''; qs('#prog-file-stored-name').value='';
        qs('#prog-file-name').textContent='';
        hide(qs('#prog-file-attached')); show(qs('#prog-file-btn'));
      }
      qs('#prog-nome').scrollIntoView({behavior:'smooth'});
    });
  });
  qsa('.prog-btn-del').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.closest('.rem-card').dataset.id;
      if (!confirm('Excluir programa?')) return;
      const p=state.programas.find(x=>x.id===id);
      // remover arquivo do Storage também
      if (p && p.fileStoredName && storage) {
        storage.ref(`programas/${p.fileStoredName}`).delete().catch(()=>{});
      }
      state.programas=state.programas.filter(x=>x.id!==id);
      saveDB(); renderProgramas(); updateListCounts();
      toast('🗑 Programa removido','info');
    });
  });
}

// Abre o manual de instalação num modal de leitura (reusa o modal de tutorial)
function openProgManual(p) {
  qs('#view-tutorial-title').textContent = `💿 ${p.nome}`;
  let meta = '';
  if (p.onedrive) meta += `<span class="badge badge-tutorial">☁️ <a href="${escHtml(p.onedrive)}" target="_blank" style="color:inherit">OneDrive</a></span>`;
  if (p.fileUrl)  meta += `<span class="badge badge-tutorial">${fileIcon(p.fileName)} <a href="${escHtml(p.fileUrl)}" target="_blank" style="color:inherit">${escHtml(p.fileName||'arquivo')}</a></span>`;
  qs('#view-tutorial-meta').innerHTML = meta;
  qs('#view-tutorial-body').innerHTML = p.manual || '<p style="color:var(--text-muted)">Sem manual em texto. Veja o arquivo anexado acima.</p>';
  qs('#btn-open-new-tab').style.display = 'none';
  qs('#btn-open-email-outlook').style.display = 'none';
  show(qs('#modal-view-tutorial'));
}

/* ═══════════════════════════════════════════════
   TEMA CLARO / ESCURO
   ═══════════════════════════════════════════════ */
const THEME_KEY = 'supportbase_theme';
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  // atualiza ícones dos botões
  const icon = theme === 'light' ? '☀️' : '🌙';
  const dt = qs('#btn-theme'); if (dt) dt.querySelector('.icon').textContent = icon;
  const mt = qs('#m-btn-theme'); if (mt) mt.textContent = `${icon} Tema claro/escuro`;
  try { localStorage.setItem(THEME_KEY, theme); } catch(e){}
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}
function initTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch(e){}
  applyTheme(saved);
}

/* ═══════════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════════ */
function qs(sel)  { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }
function show(el) { if(el) el.style.display=''; }
function hide(el) { if(el) el.style.display='none'; }
function uid()    { return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function dateStr(){ return new Date().toISOString().slice(0,10); }
function truncate(str,n){ return String(str).length>n?String(str).slice(0,n)+'…':String(str); }
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function highlight(text,query){
  if (!query) return text;
  const words=query.split(/\s+/).filter(Boolean).map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  return text.replace(new RegExp(`(${words.join('|')})`, 'gi'),'<mark>$1</mark>');
}
// Converte o HTML do editor em texto plano preservando quebras de linha.
// <br>, </p>, </div>, fim de <li> viram \n; <li> ganha "- " na frente.
function htmlToPlainText(html) {
  if (!html) return '';
  let s = html;
  // listas: cada item vira "- item"
  s = s.replace(/<li[^>]*>/gi, '\n- ');
  // quebras de bloco
  s = s.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // remove imagens (não vão no corpo de texto do mailto)
  s = s.replace(/<img[^>]*>/gi, '');
  // remove todas as outras tags
  s = s.replace(/<[^>]+>/g, '');
  // decodifica entidades HTML comuns
  const txt = document.createElement('textarea');
  txt.innerHTML = s;
  s = txt.value;
  // normaliza espaços e quebras excessivas
  s = s.replace(/\u00a0/g, ' ');           // &nbsp; -> espaço normal
  s = s.replace(/[ \t]+\n/g, '\n');        // espaços antes de quebra
  s = s.replace(/\n{3,}/g, '\n\n');         // no máximo 1 linha em branco
  return s.trim();
}

function getTutorialIcon(type){ return type==='video'?'🎥':type==='link'?'🌐':type==='email'?'📧':'📄'; }
function getTutorialTypeLabel(type){ return type==='video'?'Vídeo':type==='link'?'Link externo':type==='email'?'E-mail':'Documento'; }
function capitalizeFirst(str){ return str.charAt(0).toUpperCase()+str.slice(1).replace(/_/g,' '); }
