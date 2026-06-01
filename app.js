/* ============================================
   AZUCAPP - Lógica principal
============================================ */

(function() {
'use strict';

// ============================================
// CONFIGURACIÓN
// ============================================
const SUPABASE_URL = 'https://vbnucvzjlcghrmqxjldp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VGfoUAU6e0zlXzkY2y8iBw_lYeOKU7K';

const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Lista de locales - se carga dinámicamente desde la base al iniciar sesión
// LOCALES_DB es el array completo de objetos {slug, nombre, orden, activo}
// LOCAL_LABELS es un diccionario {slug: nombre_visible} que se construye a partir de LOCALES_DB
let LOCALES_DB = [];
let LOCAL_LABELS = {};

// Helpers para acceder a los locales
function getLocalesActivos() {
  // Devuelve los slugs de los locales activos (para usar en selectores normales)
  return LOCALES_DB.filter(l => l.activo).map(l => l.slug);
}

function getLocalesTodos() {
  // Devuelve los slugs de todos los locales (activos + reservados) - para Admin
  return LOCALES_DB.map(l => l.slug);
}

function localLabel(slug) {
  // Devuelve el nombre visible de un slug (o el slug si no encuentra match)
  return LOCAL_LABELS[slug] || slug;
}

async function cargarLocalesDesdeBase() {
  try {
    const data = await api('locales?order=orden.asc');
    LOCALES_DB = data || [];
    LOCAL_LABELS = {};
    LOCALES_DB.forEach(l => { LOCAL_LABELS[l.slug] = l.nombre; });
  } catch (e) {
    console.error('Error al cargar locales:', e);
    // Fallback de emergencia para que la app no se rompa si falla la query
    LOCALES_DB = [
      { slug: '1-AZUCA',     nombre: 'Azuca',            orden: 1, activo: true },
      { slug: '2-AZAFRAN',   nombre: 'Azafrán',          orden: 2, activo: true },
      { slug: '3-NIETO',     nombre: 'Nieto Senetiner',  orden: 3, activo: true },
      { slug: '4-VIÑA COBOS', nombre: 'Viña Cobos',      orden: 4, activo: true },
      { slug: '5-TRAPICHE',  nombre: 'Espacio Trapiche', orden: 5, activo: true },
      { slug: 'VINOBIEN',    nombre: 'Vinobien',         orden: 6, activo: true }
    ];
    LOCAL_LABELS = {};
    LOCALES_DB.forEach(l => { LOCAL_LABELS[l.slug] = l.nombre; });
  }
}

const TIPOS_INCIDENCIA = {
  tardanza: '⏰ Llegada tarde',
  ausencia: '❌ Ausencia',
  enfermedad: '🤒 Enfermedad',
  cambio_turno: '🔄 Cambio de turno',
  otro: '📝 Otro'
};

// ============================================
// ESTADO GLOBAL
// ============================================
let currentUser = null;
let currentEmpleado = null;   // Datos del colaborador vinculado al usuario
let semanaActual = null;      // Lunes de la semana visible (formato YYYY-MM-DD)

// ============================================
// HELPERS - API
// ============================================
async function api(path, options = {}) {
  const opts = {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(options.headers || {})
    },
    ...options
  };

  const url = SUPABASE_URL + '/rest/v1/' + path;
  const res = await fetch(url, opts);

  if (!res.ok) {
    const txt = await res.text();
    throw new Error('API error ' + res.status + ': ' + txt);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ============================================
// HELPERS - Hash y sesión
// ============================================
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function saveSession(user) {
  localStorage.setItem('azucapp_user', JSON.stringify(user));
}

function loadSession() {
  try {
    const raw = localStorage.getItem('azucapp_user');
    return raw ? JSON.parse(raw) : null;
  } catch(e) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem('azucapp_user');
}

// ============================================
// HELPERS - Fechas
// ============================================
function hoyStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parsearFecha(yyyymmdd) {
  // Evita problemas de timezone parseando manualmente
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function aFechaStr(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getLunes(fechaStr) {
  const d = parsearFecha(fechaStr);
  const dow = d.getDay();  // 0=domingo, 1=lunes, ...
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return aFechaStr(d);
}

function addDays(fechaStr, n) {
  const d = parsearFecha(fechaStr);
  d.setDate(d.getDate() + n);
  return aFechaStr(d);
}

function diasDeSemana(lunesStr) {
  return Array.from({length: 7}, (_, i) => addDays(lunesStr, i));
}

function fmtFechaCorta(fechaStr) {
  const d = parsearFecha(fechaStr);
  return `${d.getDate()} ${MESES_CORTO[d.getMonth()]}`;
}

function fmtSemana(lunesStr) {
  const dias = diasDeSemana(lunesStr);
  const d1 = parsearFecha(dias[0]);
  const d7 = parsearFecha(dias[6]);
  const m1 = MESES_CORTO[d1.getMonth()];
  const m7 = MESES_CORTO[d7.getMonth()];
  if (m1 === m7) {
    return `${d1.getDate()} – ${d7.getDate()} ${m7} ${d7.getFullYear()}`;
  }
  return `${d1.getDate()} ${m1} – ${d7.getDate()} ${m7} ${d7.getFullYear()}`;
}

function fmtDateTime(date) {
  const dias = ['Dom.', 'Lun.', 'Mar.', 'Mié.', 'Jue.', 'Vie.', 'Sáb.'];
  const dia = dias[date.getDay()];
  const fecha = date.getDate();
  const mes = MESES_CORTO[date.getMonth()];
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${dia} ${fecha} ${mes} · ${hh}:${mm}`;
}

function esHoy(fechaStr) {
  return fechaStr === hoyStr();
}

function esDiaPasado(fechaStr, turno) {
  const hoy = hoyStr();
  if (fechaStr < hoy) return true;
  if (fechaStr > hoy) return false;
  // Es hoy: si tiene turno con hora y ya pasó, considerar pasado
  if (turno && turno.hora_entrada && !turno.es_off && !turno.es_flex) {
    const ahora = new Date();
    const [h, m] = turno.hora_entrada.split(':').map(Number);
    if (ahora.getHours() > h || (ahora.getHours() === h && ahora.getMinutes() > m + 30)) {
      return true;
    }
  }
  return false;
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Formato de números con separador de miles (es-AR)
function formatNumber(n) {
  const num = Math.round(parseFloat(n) || 0);
  return num.toLocaleString('es-AR');
}

// ============================================
// TOAST
// ============================================
let toastTimeout = null;
const TOAST_ICONS = {
  success: 'ti-circle-check',
  error: 'ti-alert-circle',
  warning: 'ti-alert-triangle',
  '': 'ti-info-circle'
};
function toast(msg, kind = 'success') {
  const el = document.getElementById('toast');
  // Si no se pasa kind, asumimos success (es lo más común al guardar)
  const k = kind || 'success';
  const icon = TOAST_ICONS[k] || TOAST_ICONS.success;
  el.className = 'toast show ' + k;
  el.innerHTML = `<i class="ti ${icon}"></i><span>${esc(msg)}</span>`;
  if (toastTimeout) clearTimeout(toastTimeout);
  // Toasts de error duran más para que se alcancen a leer
  const duracion = k === 'error' ? 4500 : 3200;
  toastTimeout = setTimeout(() => {
    el.className = 'toast';
  }, duracion);
}

// ============================================
// MODAL DE CONFIRMACIÓN / ALERTA UNIVERSAL
// ============================================
let _confirmResolve = null;

/**
 * showConfirm(opciones) - muestra un modal de confirmación.
 * Devuelve una Promise<boolean>: true si confirma, false si cancela.
 * opciones: { title, msg, type, okLabel, cancelLabel, danger }
 *   - type: 'warning' (default), 'danger', 'info', 'success'
 *   - danger: si true, el botón OK se pinta rojo
 */
function showConfirm(opciones = {}) {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    const {
      title = '¿Estás seguro?',
      msg = '',
      type = 'warning',
      okLabel = 'Confirmar',
      cancelLabel = 'Cancelar',
      danger = false
    } = opciones;

    const iconBox = document.getElementById('confirmIcon');
    const iconI = iconBox.querySelector('i');
    iconBox.className = 'modal-confirm-icon ' + (type === 'warning' ? '' : type);

    const ICONS = {
      warning: 'ti-alert-triangle',
      danger:  'ti-alert-octagon',
      info:    'ti-info-circle',
      success: 'ti-circle-check'
    };
    iconI.className = 'ti ' + (ICONS[type] || ICONS.warning);

    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;

    const btnOk = document.getElementById('confirmBtnOk');
    const btnCancel = document.getElementById('confirmBtnCancel');
    btnOk.textContent = okLabel;
    btnCancel.textContent = cancelLabel;
    btnOk.className = danger ? 'btn-danger' : 'btn-primary';

    document.getElementById('modalConfirm').style.display = 'flex';
  });
}

/**
 * showAlert(opciones) - como showConfirm pero solo botón OK (informativo).
 * opciones: { title, msg, type, okLabel }
 */
function showAlert(opciones = {}) {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    const {
      title = 'Atención',
      msg = '',
      type = 'info',
      okLabel = 'Entendido'
    } = opciones;

    const iconBox = document.getElementById('confirmIcon');
    const iconI = iconBox.querySelector('i');
    iconBox.className = 'modal-confirm-icon ' + (type === 'warning' ? '' : type);

    const ICONS = {
      warning: 'ti-alert-triangle',
      danger:  'ti-alert-octagon',
      info:    'ti-info-circle',
      success: 'ti-circle-check'
    };
    iconI.className = 'ti ' + (ICONS[type] || ICONS.info);

    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;

    // Ocultar botón cancelar, dejar solo OK
    document.getElementById('confirmBtnCancel').style.display = 'none';
    const btnOk = document.getElementById('confirmBtnOk');
    btnOk.textContent = okLabel;
    btnOk.className = 'btn-primary';

    document.getElementById('modalConfirm').style.display = 'flex';
  });
}

function closeConfirm(result) {
  document.getElementById('modalConfirm').style.display = 'none';
  // Restaurar botón cancelar para próximas confirmaciones
  document.getElementById('confirmBtnCancel').style.display = '';
  if (_confirmResolve) {
    const r = _confirmResolve;
    _confirmResolve = null;
    r(result);
  }
}

// ============================================
// CIERRE UNIFICADO DE MODALES
// (click afuera + tecla Escape)
// ============================================
document.addEventListener('click', (e) => {
  // Si el click es directamente sobre el overlay (no en el contenido), cerrarlo
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    const card = e.target.querySelector('.modal-card');
    if (card && card.hasAttribute('data-prevent-close')) return;
    e.target.style.display = 'none';
    // Si era el modal de confirmación, resolver como cancelar
    if (e.target.id === 'modalConfirm' && _confirmResolve) {
      const r = _confirmResolve;
      _confirmResolve = null;
      r(false);
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Buscar el modal abierto más reciente y cerrarlo
    const modales = document.querySelectorAll('.modal-overlay');
    for (let i = modales.length - 1; i >= 0; i--) {
      const m = modales[i];
      if (m.style.display === 'flex') {
        m.style.display = 'none';
        if (m.id === 'modalConfirm' && _confirmResolve) {
          const r = _confirmResolve;
          _confirmResolve = null;
          r(false);
        }
        break;
      }
    }
  }
});

// Exponer al window
window.closeConfirm = closeConfirm;
window.showConfirm = showConfirm;
window.showAlert = showAlert;

// ============================================
// MÓDULOS DEL DASHBOARD
// ============================================
const MODULES = [
  {
    id: 'semana',
    icon: 'ti-calendar-event',
    color: '#7F77DD',
    title: 'Mi semana',
    desc: 'Mis turnos asignados',
    visible: () => true,
    action: () => openMiSemana()
  },
  {
    id: 'propina',
    icon: 'ti-cash',
    color: '#EF9F27',
    title: 'Mi propina',
    desc: 'Propinas acumuladas',
    visible: () => true,
    action: () => openMiPropina()
  },
  {
    id: 'biblioteca',
    icon: 'ti-books',
    color: '#5DCAA5',
    title: 'Mi biblioteca',
    desc: 'Capacitación y recursos',
    visible: () => isMaster() || isAdmin() || (currentUser.locales_asignados && currentUser.locales_asignados.length > 0),
    action: () => openMiBiblioteca()
  },
  {
    id: 'recetas',
    icon: 'ti-chef-hat',
    color: '#D85A30',
    title: 'Mis recetas',
    desc: 'Recetas y menús del local',
    visible: () => isMaster() || isAdmin() || currentUser.editor_recetas,
    action: () => toast('Módulo "Mis recetas" - próximamente', 'warning')
  },
  {
    id: 'pedidos',
    icon: 'ti-shopping-cart',
    color: '#378ADD',
    title: 'Mis pedidos',
    desc: 'Requerimientos y stock',
    visible: () => isMaster() || isAdmin() || currentUser.editor_pedidos,
    action: () => toast('Módulo "Mis pedidos" - próximamente', 'warning')
  },
  {
    id: 'admin',
    icon: 'ti-settings',
    color: '#B4B2A9',
    title: 'Administración',
    desc: 'Usuarios y permisos',
    visible: () => isMaster() || isAdmin(),
    action: () => openAdministracion()
  }
];

function isMaster() {
  return currentUser && currentUser.perfil === 'master';
}

function isAdmin() {
  return currentUser && currentUser.perfil === 'admin';
}

// ============================================
// LÓGICA DE LOGIN
// ============================================
async function doLogin(usuario, password) {
  try {
    const users = await api(`roster_usuarios?usuario=eq.${encodeURIComponent(usuario)}&select=*`);

    if (!users || users.length === 0) {
      throw new Error('Usuario no encontrado');
    }

    const user = users[0];

    if (!user.activo) {
      throw new Error('Usuario inactivo');
    }

    const hash = await sha256(password);
    if (hash !== user.password_hash) {
      throw new Error('Contraseña incorrecta');
    }

    currentUser = user;
    saveSession(user);

    // Cargar lista de locales desde la base (necesario para que toda la app
    // muestre los nombres correctos de los locales)
    await cargarLocalesDesdeBase();

    if (user.debe_cambiar_password) {
      showView('vChangePass');
    } else {
      showDashboard();
    }

  } catch (err) {
    document.getElementById('loginError').textContent = err.message || 'Error al ingresar';
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = document.getElementById('loginUsuario').value.trim();
  const password = document.getElementById('loginPassword').value;

  document.getElementById('loginError').textContent = '';
  document.getElementById('btnLogin').disabled = true;
  document.getElementById('btnLogin').textContent = 'Ingresando...';

  await doLogin(usuario, password);

  document.getElementById('btnLogin').disabled = false;
  document.getElementById('btnLogin').textContent = 'Ingresar';
});

// ============================================
// CAMBIO DE CONTRASEÑA OBLIGATORIO
// ============================================
document.getElementById('changePassForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('changePassError');
  errBox.textContent = '';

  const p1 = document.getElementById('newPass1').value;
  const p2 = document.getElementById('newPass2').value;

  if (p1.length < 6) {
    errBox.textContent = 'La contraseña debe tener al menos 6 caracteres';
    return;
  }
  if (p1 !== p2) {
    errBox.textContent = 'Las contraseñas no coinciden';
    return;
  }

  try {
    const newHash = await sha256(p1);
    await api(`roster_usuarios?id=eq.${currentUser.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        password_hash: newHash,
        debe_cambiar_password: false
      })
    });

    currentUser.password_hash = newHash;
    currentUser.debe_cambiar_password = false;
    saveSession(currentUser);

    document.getElementById('newPass1').value = '';
    document.getElementById('newPass2').value = '';

    showDashboard();
  } catch (err) {
    errBox.textContent = 'Error al guardar: ' + err.message;
  }
});

// ============================================
// CAMBIO DE CONTRASEÑA VOLUNTARIO
// ============================================
document.getElementById('changePassVoluntaryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('voluntaryPassError');
  errBox.textContent = '';

  const currentP = document.getElementById('currentPass').value;
  const p1 = document.getElementById('voluntaryPass1').value;
  const p2 = document.getElementById('voluntaryPass2').value;

  const currentHash = await sha256(currentP);
  if (currentHash !== currentUser.password_hash) {
    errBox.textContent = 'Contraseña actual incorrecta';
    return;
  }
  if (p1.length < 6) {
    errBox.textContent = 'La nueva contraseña debe tener al menos 6 caracteres';
    return;
  }
  if (p1 !== p2) {
    errBox.textContent = 'Las contraseñas no coinciden';
    return;
  }

  try {
    const newHash = await sha256(p1);
    await api(`roster_usuarios?id=eq.${currentUser.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        password_hash: newHash,
        debe_cambiar_password: false
      })
    });

    currentUser.password_hash = newHash;
    saveSession(currentUser);

    document.getElementById('currentPass').value = '';
    document.getElementById('voluntaryPass1').value = '';
    document.getElementById('voluntaryPass2').value = '';

    openMiPerfil();
    toast('Contraseña actualizada', 'success');
  } catch (err) {
    errBox.textContent = 'Error al guardar: ' + err.message;
  }
});

// ============================================
// DASHBOARD
// ============================================
function showDashboard() {
  if (!currentUser) {
    showView('vLogin');
    return;
  }

  const nombre = currentUser.nombre || currentUser.usuario;
  const perfil = currentUser.perfil || 'usuario';
  const roleLabel = {
    master: 'Master',
    admin: 'Admin',
    editor: 'Editor',
    usuario: 'Usuario'
  }[perfil] || 'Usuario';

  // Saludo según hora del día + nombre de pila
  const primerNombre = nombre.trim().split(/\s+/)[0];
  const hora = new Date().getHours();
  let saludo, emoji;
  if (hora >= 5 && hora < 12) {
    saludo = 'Buenos días';
    emoji = '☀️';
  } else if (hora >= 12 && hora < 20) {
    saludo = 'Buenas tardes';
    emoji = '🌤️';
  } else {
    saludo = 'Buenas noches';
    emoji = '🌙';
  }
  document.getElementById('greetingText').textContent = `${saludo}, ${primerNombre}`;
  document.getElementById('greetingEmoji').textContent = emoji;

  // User pill
  document.getElementById('userPillName').textContent = nombre;
  document.getElementById('userPillRole').textContent = roleLabel;

  // Avatar: inicial + color según perfil
  const avatarEl = document.getElementById('userPillAvatar');
  avatarEl.textContent = obtenerIniciales(nombre);
  avatarEl.className = 'user-pill-avatar avatar-' + perfil;

  document.getElementById('datetime').textContent = fmtDateTime(new Date());

  renderDashboardCards();
  showView('vDash');
}

// Devuelve hasta 2 iniciales del nombre (ej: "Matías Fraga" → "MF")
function obtenerIniciales(nombre) {
  if (!nombre) return '?';
  const partes = nombre.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].charAt(0).toUpperCase();
  return (partes[0].charAt(0) + partes[partes.length - 1].charAt(0)).toUpperCase();
}

// ============================================
// MI PERFIL
// ============================================
async function openMiPerfil() {
  if (!currentUser) {
    showView('vLogin');
    return;
  }

  const nombre = currentUser.nombre || currentUser.usuario;
  const perfil = currentUser.perfil || 'usuario';
  const roleLabel = {
    master: 'Master',
    admin: 'Admin',
    editor: 'Editor',
    usuario: 'Usuario'
  }[perfil] || 'Usuario';

  // Avatar grande
  const avatar = document.getElementById('perfilAvatar');
  avatar.textContent = obtenerIniciales(nombre);
  avatar.className = 'perfil-avatar avatar-' + perfil;

  // Datos básicos
  document.getElementById('perfilNombre').textContent = nombre;
  document.getElementById('perfilUsuario').textContent = '@' + (currentUser.usuario || '');

  const badge = document.getElementById('perfilBadge');
  badge.textContent = roleLabel;
  badge.className = 'perfil-badge ' + perfil;

  // Empleado
  document.getElementById('perfilEmpleado').textContent =
    currentUser.empleado_id ? '#' + currentUser.empleado_id : 'Sin asignar';

  // Tipo de perfil expandido
  const perfilDescripciones = {
    master:  'Master · Control total',
    admin:   'Admin · Administra todo menos Locales',
    editor:  'Editor · Permisos según módulo',
    usuario: 'Usuario · Solo lectura de lo propio'
  };
  document.getElementById('perfilTipo').textContent =
    perfilDescripciones[perfil] || roleLabel;

  // Locales asignados
  const filaLocales = document.getElementById('perfilLocalesRow');
  const elLocales = document.getElementById('perfilLocales');

  if (perfil === 'master' || perfil === 'admin') {
    elLocales.textContent = 'Todos los locales';
  } else {
    const locs = currentUser.locales_asignados || [];
    if (locs.length === 0) {
      elLocales.textContent = 'Sin locales asignados';
      elLocales.style.color = '#E24B4A';
    } else {
      const nombresVisibles = locs.map(slug => localLabel(slug)).join(', ');
      elLocales.textContent = nombresVisibles;
      elLocales.style.color = '';
    }
  }

  showView('vMiPerfil');
}

window.openMiPerfil = openMiPerfil;

function renderDashboardCards() {
  const grid = document.getElementById('dashGrid');
  const visibleModules = MODULES.filter(m => m.visible());

  grid.innerHTML = visibleModules.map((m, idx) => {
    const isLastOdd = (idx === visibleModules.length - 1) && (visibleModules.length % 2 === 1);
    const fullClass = isLastOdd ? ' full' : '';

    return `
      <button class="dash-card${fullClass}" data-module="${m.id}">
        <div class="dash-icon" style="color: ${m.color}">
          <i class="ti ${m.icon}"></i>
        </div>
        <div class="dash-title">${m.title}</div>
        <div class="dash-desc">${m.desc}</div>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('.dash-card').forEach(card => {
    card.addEventListener('click', () => {
      const modId = card.dataset.module;
      const mod = MODULES.find(m => m.id === modId);
      if (mod) mod.action();
    });
  });
}

// ============================================
// MI SEMANA
// ============================================
async function openMiSemana() {
  showView('vMiSemana');

  // Inicializar fecha
  if (!semanaActual) {
    semanaActual = getLunes(hoyStr());
  }

  // Cargar datos del colaborador si tiene empleado_id
  currentEmpleado = null;
  if (currentUser.empleado_id) {
    try {
      const emps = await api(`empleados?id=eq.${currentUser.empleado_id}&select=*`);
      if (emps && emps.length) {
        currentEmpleado = emps[0];
      }
    } catch (e) {
      console.warn('Error cargando empleado:', e);
    }
  }

  // Renderizar
  await renderMiSemana();
}

async function renderMiSemana() {
  const subtitle = document.getElementById('miSemanaSubtitle');
  const weekNav = document.getElementById('weekNav');
  const diasGrid = document.getElementById('diasGrid');
  const comentBox = document.getElementById('comentarioGeneral');
  const noEmpBox = document.getElementById('noEmpleado');
  const reportarBox = document.getElementById('reportarWrap');

  // Caso 1: usuario sin empleado vinculado (ej: matfraga master)
  if (!currentEmpleado) {
    subtitle.textContent = currentUser.nombre || currentUser.usuario;
    weekNav.style.display = 'none';
    diasGrid.innerHTML = '';
    comentBox.style.display = 'none';
    noEmpBox.style.display = 'flex';
    reportarBox.style.display = 'none';
    return;
  }

  // Caso 2: usuario con empleado
  weekNav.style.display = 'flex';
  noEmpBox.style.display = 'none';
  reportarBox.style.display = 'block';

  const localLabel = LOCAL_LABELS[currentEmpleado.local] || currentEmpleado.local || '';
  subtitle.textContent = localLabel + (currentEmpleado.sector ? ' · ' + currentEmpleado.sector : '');

  document.getElementById('weekLabel').textContent = fmtSemana(semanaActual);

  // Mostrar loading
  diasGrid.innerHTML = '<div class="loading">Cargando turnos...</div>';

  const dias = diasDeSemana(semanaActual);
  let turnos = {};         // por día → turno
  let localesPorDia = {};  // por día → nombre del local
  let comentGeneral = '';
  let incPorDia = {};

  try {
    // Buscar TODAS las semanas (de cualquier local) con esta fecha de lunes
    // que tengan turnos para este empleado
    const semanas = await api(
      `roster_semanas?fecha_lunes=eq.${semanaActual}&select=id,local,comentario_general`
    );

    if (semanas && semanas.length) {
      // Construir mapa id→local para asignarlo después a cada turno
      const semanaIdToLocal = {};
      const semanaIds = [];
      semanas.forEach(s => {
        semanaIdToLocal[s.id] = s.local;
        semanaIds.push(s.id);
      });

      // Buscar todos los turnos del empleado en cualquiera de esas semanas
      const tts = await api(
        `roster_turnos?semana_id=in.(${semanaIds.join(',')})` +
        `&empleado_id=eq.${currentEmpleado.id}&select=*`
      ) || [];

      tts.forEach(t => {
        turnos[t.dia] = t;
        localesPorDia[t.dia] = semanaIdToLocal[t.semana_id];
      });

      // Para el comentario general, priorizar el del local principal del empleado
      const semanaPrincipal = semanas.find(s => s.local === currentEmpleado.local);
      if (semanaPrincipal && semanaPrincipal.comentario_general) {
        comentGeneral = semanaPrincipal.comentario_general;
      } else if (semanas.length === 1 && semanas[0].comentario_general) {
        comentGeneral = semanas[0].comentario_general;
      }
    }

    // Cargar incidencias del empleado en el rango de la semana
    const desde = dias[0];
    const hasta = dias[6];
    const incs = await api(
      `incidencias?empleado_id=eq.${currentEmpleado.id}` +
      `&fecha=gte.${desde}&fecha=lte.${hasta}` +
      `&select=*&order=creado_en.desc`
    ) || [];
    incs.forEach(inc => {
      if (!incPorDia[inc.fecha]) incPorDia[inc.fecha] = inc;
    });
  } catch (e) {
    diasGrid.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar la semana</div>';
    console.error(e);
    return;
  }

  // Detectar si el empleado tiene turnos en distintos locales esta semana
  const localesUnicos = [...new Set(Object.values(localesPorDia))];
  const esRotativo = localesUnicos.length > 1;

  // Renderizar la grilla
  diasGrid.innerHTML = dias.map((dia, i) => {
    const t = turnos[dia];
    const esOff = t && t.es_off;
    const esFlex = t && t.es_flex;
    const hoy = esHoy(dia);
    const pasado = esDiaPasado(dia, t);
    const inc = incPorDia[dia];
    const localTurno = localesPorDia[dia];

    let txt;
    if (esOff) {
      txt = 'OFF';
    } else if (esFlex) {
      txt = t.hora_entrada ? 'FLEX ' + t.hora_entrada.slice(0, 5) : 'FLEX';
    } else if (t && t.hora_entrada) {
      txt = t.hora_entrada.slice(0, 5);
    } else {
      txt = '—';
    }

    const classes = ['dia-card'];
    if (esOff) classes.push('off');
    if (esFlex) classes.push('flex');
    if (hoy) classes.push('hoy');
    if (pasado) classes.push('pasado');

    // Mostrar el local SOLO si el empleado es rotativo y tiene un turno con local
    const mostrarLocal = esRotativo && localTurno && !esOff && t && t.hora_entrada;
    if (mostrarLocal) classes.push('con-local');

    const dot = inc
      ? `<span class="inc-dot ${inc.estado}" onclick="verIncidencia(${inc.id})" title="Ver incidencia"></span>`
      : '';

    const hoyTag = hoy ? '<span class="hoy-label">HOY</span>' : '';

    const localTag = mostrarLocal
      ? `<div class="dia-local">${esc(LOCAL_LABELS[localTurno] || localTurno)}</div>`
      : '';

    const comentTurno = (t && t.comentario)
      ? `<div class="dia-comment"><i class="ti ti-message-circle"></i><span>${esc(t.comentario)}</span></div>`
      : '';

    return `
      <div class="${classes.join(' ')}">
        ${dot}
        <div class="dia-nombre">${DIAS_LARGO[i]}${hoyTag}</div>
        <div class="dia-fecha">${fmtFechaCorta(dia)}</div>
        <div class="dia-hora">${txt}</div>
        ${localTag}
        ${comentTurno}
      </div>
    `;
  }).join('');

  // Comentario general
  if (comentGeneral) {
    comentBox.innerHTML = `<i class="ti ti-message-2"></i><em>${esc(comentGeneral)}</em>`;
    comentBox.style.display = 'flex';
  } else {
    comentBox.style.display = 'none';
  }
}

window.cambiarSemanaEmp = function(n) {
  semanaActual = addDays(semanaActual, n * 7);
  renderMiSemana();
};

// ============================================
// MI SEMANA - Reportar incidencia
// ============================================
window.openIncidenciaModal = function() {
  const hoy = hoyStr();
  const inp = document.getElementById('incFecha');
  inp.value = hoy;
  inp.min = hoy;
  document.getElementById('incTipo').value = 'tardanza';
  document.getElementById('incDesc').value = '';
  document.getElementById('incError').textContent = '';
  document.getElementById('modalIncidencia').classList.add('show');
};

window.closeIncidenciaModal = function() {
  document.getElementById('modalIncidencia').classList.remove('show');
};

window.guardarIncidencia = async function() {
  const tipo = document.getElementById('incTipo').value;
  const fecha = document.getElementById('incFecha').value;
  const desc = document.getElementById('incDesc').value.trim();
  const errBox = document.getElementById('incError');
  errBox.textContent = '';

  if (!fecha) {
    errBox.textContent = 'Elegí una fecha';
    return;
  }
  const hoy = hoyStr();
  if (fecha < hoy) {
    errBox.textContent = 'No se pueden reportar incidencias de días pasados';
    return;
  }
  if (!desc) {
    errBox.textContent = 'Describí la incidencia';
    return;
  }
  if (!currentEmpleado) {
    errBox.textContent = 'Tu usuario no está vinculado a un colaborador';
    return;
  }

  // Si la incidencia es para HOY, validar que no se haya pasado la hora del turno + 30 min
  if (fecha === hoy) {
    try {
      const turnoHoy = await api(
        `roster_turnos?empleado_id=eq.${currentEmpleado.id}&dia=eq.${hoy}` +
        `&select=hora_entrada,es_off,es_flex&limit=1`
      );
      if (turnoHoy && turnoHoy.length && turnoHoy[0].hora_entrada
          && !turnoHoy[0].es_off && !turnoHoy[0].es_flex) {
        const ahora = new Date();
        const [h, m] = turnoHoy[0].hora_entrada.split(':').map(Number);
        const limite = new Date(ahora);
        limite.setHours(h, m + 30, 0, 0);
        if (ahora > limite) {
          errBox.textContent = 'Ya pasó la hora de tu turno + 30 min, no se puede reportar';
          return;
        }
      }
    } catch (e) {
      console.warn('Error validando turno hoy:', e);
    }
  }

  try {
    await api('incidencias', {
      method: 'POST',
      body: JSON.stringify({
        empleado_id: currentEmpleado.id,
        fecha,
        tipo,
        descripcion: desc,
        estado: 'pendiente'
      })
    });
    closeIncidenciaModal();
    toast('✓ Incidencia enviada', 'success');
    // Refrescar la vista para mostrar el indicador
    await renderMiSemana();
  } catch (err) {
    errBox.textContent = 'Error al enviar: ' + err.message;
  }
};

// ============================================
// MI SEMANA - Ver detalle de incidencia
// ============================================
window.verIncidencia = async function(id) {
  try {
    const incs = await api(`incidencias?id=eq.${id}&select=*`);
    if (!incs || !incs.length) {
      toast('No se encontró la incidencia', 'error');
      return;
    }
    const inc = incs[0];

    const estadoLabels = {
      pendiente: { label: '⏳ Pendiente', cls: 'pendiente' },
      aprobado: { label: '✓ Aceptada', cls: 'aprobado' },
      rechazado: { label: '✗ Denegada', cls: 'rechazado' }
    };
    const est = estadoLabels[inc.estado] || estadoLabels.pendiente;

    document.getElementById('incDetTitle').textContent = TIPOS_INCIDENCIA[inc.tipo] || inc.tipo;
    document.getElementById('incDetBody').innerHTML = `
      <div class="det-line">
        <div class="det-label">Fecha</div>
        <div class="det-value">${fmtFechaCorta(inc.fecha)}</div>
      </div>
      <div class="det-line">
        <div class="det-label">Estado</div>
        <div class="det-value"><span class="det-badge ${est.cls}">${est.label}</span></div>
      </div>
      <div class="det-line">
        <div class="det-label">Descripción</div>
        <div class="det-value">${esc(inc.descripcion || '—')}</div>
      </div>
    `;
    document.getElementById('modalIncDetalle').classList.add('show');
  } catch (e) {
    toast('Error al cargar la incidencia', 'error');
  }
};

window.closeIncDetalleModal = function() {
  document.getElementById('modalIncDetalle').classList.remove('show');
};

// ============================================
// MI PROPINA
// ============================================
async function openMiPropina() {
  showView('vMiPropina');
  const cont = document.getElementById('propinaContenido');
  const subtitle = document.getElementById('miPropinaSubtitle');
  cont.innerHTML = '<div class="loading">Cargando propinas...</div>';
  // Necesita empleado vinculado
  if (!currentUser.empleado_id) {
    subtitle.textContent = currentUser.nombre || currentUser.usuario;
    cont.innerHTML = `
      <div class="no-empleado">
        <i class="ti ti-info-circle"></i>
        <div>
          <div class="ne-title">No tenés propinas asignadas</div>
          <div class="ne-desc">Tu usuario no está vinculado a un colaborador. Si esto es un error, contactá a Recursos Humanos.</div>
        </div>
      </div>`;
    return;
  }

  // Cargar nombre del colaborador para el subtítulo
  if (!currentEmpleado && currentUser.empleado_id) {
    try {
      const emps = await api(`empleados?id=eq.${currentUser.empleado_id}&select=*`);
      if (emps && emps.length) currentEmpleado = emps[0];
    } catch(e) { /* ignore */ }
  }
  subtitle.textContent = 'Propinas acumuladas';

  // Cargar asignaciones con datos del cierre
  let asigs = [];
  try {
    asigs = await api(
      `propinas_asignaciones?empleado_id=eq.${currentUser.empleado_id}` +
      `&select=*,cierre:cierre_id(fecha,turno,local,pagado,pagado_en)` +
      `&order=id.desc`
    ) || [];
  } catch (e) {
    cont.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar propinas</div>';
    return;
  }

  const pendientes = asigs.filter(a => a.cierre && !a.cierre.pagado && a.monto > 0);

  const hoy = new Date();
  const limite = new Date(hoy.getFullYear(), hoy.getMonth() - 3, 1);
  const limiteStr = limite.toISOString().slice(0, 10);
  const pagadosRecientes = asigs.filter(a =>
    a.cierre && a.cierre.pagado && a.monto > 0 && a.cierre.fecha >= limiteStr
  );

  let html = '';

  // ===== 1. BOTÓN DE GESTIÓN (solo Master o Admin por ahora) =====
  if (isMaster() || isAdmin()) {
    html += `
      <button class="btn-gestion" onclick="abrirGestionPropinas()">
        <i class="ti ti-settings"></i> GESTIÓN DE PROPINAS
      </button>`;
  }

  // ===== 2. BANNER PENDIENTE =====
  const totalPendiente = pendientes.reduce((s, a) => s + parseFloat(a.monto || 0), 0);
  if (pendientes.length) {
    html += `
      <div class="propina-banner">
        <div class="propina-banner-label">Total pendiente de cobro</div>
        <div class="propina-banner-monto">$${formatNumber(totalPendiente)}</div>
        <div class="propina-banner-sub">${pendientes.length} ${pendientes.length === 1 ? 'cierre pendiente' : 'cierres pendientes'}</div>
      </div>`;
  } else {
    html += `
      <div class="propina-empty">
        <div class="propina-empty-icon">💰</div>
        <div class="propina-empty-title">No tenés propinas pendientes</div>
        <div class="propina-empty-desc">Cuando se carguen propinas para vos, las vas a ver acá.</div>
      </div>`;
  }

  // ===== 3. DETALLE DE PENDIENTES POR LOCAL =====
  if (pendientes.length) {
    const porLocal = {};
    pendientes.forEach(a => {
      const loc = a.cierre.local;
      if (!porLocal[loc]) porLocal[loc] = { total: 0, dias: [] };
      porLocal[loc].total += parseFloat(a.monto || 0);
      porLocal[loc].dias.push({
        fecha: a.cierre.fecha,
        turno: a.cierre.turno,
        puntos: parseFloat(a.puntos),
        monto: parseFloat(a.monto || 0)
      });
    });
    Object.values(porLocal).forEach(l => l.dias.sort((a, b) => b.fecha.localeCompare(a.fecha)));

    const turnoIcon = { mediodia: '🌤', noche: '🌙', evento: '🎉', especial: '⭐' };
    const turnoLbl = { mediodia: 'Mediodía', noche: 'Noche', evento: 'Evento', especial: 'Especial' };

    html += `<div class="pend-section-title">Detalle de pendientes</div>`;
    Object.entries(porLocal).forEach(([loc, data]) => {
      html += `
        <div class="pend-local">
          <div class="pend-local-header">
            <div class="pend-local-name"><i class="ti ti-map-pin"></i> ${esc(LOCAL_LABELS[loc] || loc)}</div>
            <div class="pend-local-total">$${formatNumber(data.total)}</div>
          </div>
          ${data.dias.map(d => {
            const pts = d.puntos === 1 ? '1 punto' : d.puntos === 0.5 ? '½ punto' : d.puntos + ' pts';
            return `
              <div class="pend-dia">
                <div class="pend-dia-info">
                  <span class="pend-dia-fecha">${fmtFechaCorta(d.fecha)}</span>
                  <span class="pend-dia-meta">${turnoIcon[d.turno] || ''} ${turnoLbl[d.turno] || d.turno} · ${pts}</span>
                </div>
                <div class="pend-dia-monto">$${formatNumber(d.monto)}</div>
              </div>`;
          }).join('')}
        </div>`;
    });
  }

  // ===== 4. HISTÓRICO COBRADO (últimos 4 meses) =====
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const buckets = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const lbl = `${MESES[d.getMonth()]} ${d.getFullYear()}`;
    buckets.push({ key, lbl, total: 0, cantidad: 0 });
  }
  pagadosRecientes.forEach(a => {
    const k = a.cierre.fecha.slice(0, 7);
    const b = buckets.find(x => x.key === k);
    if (b) { b.total += parseFloat(a.monto || 0); b.cantidad++; }
  });
  const totalCobrado = buckets.reduce((s, b) => s + b.total, 0);

  if (totalCobrado > 0 || pendientes.length) {
    html += `
      <div class="cobrado-box">
        <div class="cobrado-header">
          <div class="cobrado-title"><i class="ti ti-cash"></i> Histórico cobrado</div>
          <div class="cobrado-periodo">Últimos meses</div>
        </div>
        <div class="cobrado-grid">
          ${buckets.map((b, i) => `
            <div class="cobrado-mes${i === 0 ? ' actual' : ''}">
              <div class="cobrado-mes-label">${b.lbl}${i === 0 ? ' · Actual' : ''}</div>
              <div class="cobrado-mes-monto${b.total > 0 ? '' : ' cero'}">$${formatNumber(b.total)}</div>
              ${b.cantidad ? `<div class="cobrado-mes-cant">${b.cantidad} ${b.cantidad === 1 ? 'cierre' : 'cierres'}</div>` : ''}
            </div>
          `).join('')}
        </div>
        <div class="cobrado-total">
          <span style="color:var(--c-muted)">Total cobrado:</span>
          <strong>$${formatNumber(totalCobrado)}</strong>
        </div>
      </div>`;
  }

  cont.innerHTML = html;
}

// ============================================
// GESTIÓN DE PROPINAS
// ============================================

let PROP_CIERRES = [];
let PROP_LOCAL_SEL = null;  // local seleccionado para filtrar
let PROP_CONFIG = null;     // cache de propinas_config

// ¿Quién puede entrar al módulo?
function puedeGestionarPropinas() {
  return isMaster() || isAdmin() || currentUser.editor_propinas === true;
}

// ¿Quién puede tocar configuración y marcar como pagado?
function puedeAdminPropinas() {
  return isMaster() || isAdmin();
}

// Locales que puede operar este usuario
function localesPropinasUsuario() {
  if (isMaster() || isAdmin()) return getLocalesActivos();
  // Editor: solo sus locales asignados que estén activos
  const asignados = currentUser.locales_asignados || [];
  return asignados.filter(loc => getLocalesActivos().includes(loc));
}

async function abrirGestionPropinas() {
  if (!puedeGestionarPropinas()) {
    toast('No tenés permiso para gestionar propinas', 'error');
    return;
  }

  showView('vGestionPropinas');
  document.getElementById('propGestTabla').innerHTML = '<div class="loading">Cargando cierres...</div>';
  document.getElementById('propGestKpis').innerHTML = '';

  // Cargar config + cierres en paralelo
  try {
    const [configs, cierres] = await Promise.all([
      api('propinas_config?id=eq.1'),
      api('propinas_cierres?order=fecha.desc,id.desc')
    ]);
    PROP_CONFIG = (configs && configs[0]) ? configs[0] : null;
    PROP_CIERRES = cierres || [];
  } catch (e) {
    document.getElementById('propGestTabla').innerHTML =
      '<div class="loading" style="color:var(--c-error)">Error al cargar datos</div>';
    return;
  }

  // Pre-seleccionar el primer local del usuario si no hay selección
  const localesUser = localesPropinasUsuario();
  if (!PROP_LOCAL_SEL || !localesUser.includes(PROP_LOCAL_SEL)) {
    PROP_LOCAL_SEL = localesUser[0] || null;
  }

  renderPropGestHeader();
  renderPropGestLocales();
  renderPropGestKpis();
  renderPropGestTabla();
}

function renderPropGestHeader() {
  const subtitle = document.getElementById('propGestSubtitle');
  // Agregar botón Configurar al header si tiene permiso
  const headerBlock = subtitle.parentElement.parentElement;

  // Eliminar botón previo si existe (para evitar duplicados al re-renderizar)
  const oldBtn = headerBlock.querySelector('.btn-config-propinas');
  if (oldBtn) oldBtn.remove();

  if (puedeAdminPropinas()) {
    const btn = document.createElement('button');
    btn.className = 'btn-config-propinas';
    btn.title = 'Configurar tipos de cambio';
    btn.innerHTML = '<i class="ti ti-settings"></i>';
    btn.onclick = openConfigPropinas;
    headerBlock.appendChild(btn);
  }

  subtitle.textContent = puedeAdminPropinas()
    ? 'Cierres registrados · podés editarlos y marcar como pagados'
    : 'Cierres registrados de tus locales';
}

function renderPropGestLocales() {
  const cont = document.getElementById('propGestLocales');
  const locales = localesPropinasUsuario();

  if (locales.length === 0) {
    cont.innerHTML = '<div class="bib-empty"><i class="ti ti-map-pin-off"></i><div class="bib-empty-title">No tenés locales asignados</div></div>';
    return;
  }

  if (locales.length === 1) {
    // Si solo tiene un local, no mostrar selector
    cont.innerHTML = '';
    return;
  }

  cont.innerHTML = locales.map(slug => `
    <button class="bib-chip ${PROP_LOCAL_SEL === slug ? 'active' : ''}"
            onclick="selectPropLocal('${esc(slug).replace(/'/g, "\\'")}')">
      <i class="ti ti-map-pin"></i>${esc(localLabel(slug))}
    </button>
  `).join('');
}

function selectPropLocal(slug) {
  PROP_LOCAL_SEL = slug;
  renderPropGestLocales();
  renderPropGestKpis();
  renderPropGestTabla();
}

function cierresLocalActual() {
  if (!PROP_LOCAL_SEL) return [];
  return PROP_CIERRES.filter(c => c.local === PROP_LOCAL_SEL);
}

function renderPropGestKpis() {
  const cont = document.getElementById('propGestKpis');
  const cierres = cierresLocalActual();

  const total = cierres.length;
  const pendientes = cierres.filter(c => !c.pagado).length;
  const pagados = total - pendientes;

  const bruto = cierres.reduce((s, c) => s + parseFloat(c.total_bruto || 0), 0);
  const netoPendiente = cierres.filter(c => !c.pagado).reduce((s, c) => s + parseFloat(c.total_neto || 0), 0);
  const netoPagado = cierres.filter(c => c.pagado).reduce((s, c) => s + parseFloat(c.total_neto || 0), 0);

  cont.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Cierres</div>
      <div class="kpi-value">${total}</div>
      <div class="kpi-sub">${pendientes} pendiente${pendientes !== 1 ? 's' : ''} · ${pagados} pagado${pagados !== 1 ? 's' : ''}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Total bruto acumulado</div>
      <div class="kpi-value">$${formatNumber(bruto)}</div>
    </div>
    <div class="kpi-card highlight">
      <div class="kpi-label">Neto a liquidar</div>
      <div class="kpi-value">$${formatNumber(netoPendiente)}</div>
      <div class="kpi-sub">+$${formatNumber(netoPagado)} ya pagados</div>
    </div>
  `;
}

function renderPropGestTabla() {
  const cont = document.getElementById('propGestTabla');
  const cierres = cierresLocalActual();

  if (cierres.length === 0) {
    cont.innerHTML = `
      <div class="prop-empty">
        <i class="ti ti-cash-off"></i>
        <div class="prop-empty-title">No hay cierres todavía</div>
        <div class="prop-empty-desc">${PROP_LOCAL_SEL
          ? 'Cuando se cargue el primer cierre de ' + localLabel(PROP_LOCAL_SEL) + ', aparecerá acá.'
          : 'Elegí un local para ver sus cierres.'}</div>
      </div>`;
    return;
  }

  const TURNOS_LABEL = {
    mediodia: '🍲 Mediodía',
    'mediodía': '🍲 Mediodía',
    noche: '🌙 Noche',
    evento: '🎉 Evento',
    especial: '⭐ Especial'
  };

  let html = `
    <div class="prop-tabla">
      <div class="prop-tabla-header">
        <span>Fecha</span>
        <span>Turno</span>
        <span>Bruto</span>
        <span>Neto</span>
        <span>Puntos</span>
        <span>Estado</span>
      </div>`;

  cierres.forEach(c => {
    const fecha = c.fecha ? fmtFechaCorta(c.fecha) : '—';
    const turnoKey = (c.turno || '').toLowerCase();
    const turnoLabel = TURNOS_LABEL[turnoKey] || (c.turno || '—');
    const estadoCls = c.pagado ? 'pagado' : 'cerrado';
    const estadoTxt = c.pagado ? '✓ Pagado' : 'Cerrado';

    // Solo Admin/Master puede togglear pagado
    const estadoClickable = puedeAdminPropinas() ? `onclick="togglePagado(${c.id})"` : '';
    const estadoTitle = puedeAdminPropinas()
      ? (c.pagado ? 'title="Click para volver a Cerrado"' : 'title="Click para marcar como Pagado"')
      : '';

    html += `
      <div class="prop-tabla-row">
        <span class="prop-fecha">${fecha}</span>
        <span class="prop-turno">${turnoLabel}</span>
        <span class="prop-monto">$${formatNumber(c.total_bruto || 0)}</span>
        <span class="prop-monto">$${formatNumber(c.total_neto || 0)}</span>
        <span>${c.total_puntos || 0}</span>
        <span class="prop-estado ${estadoCls}" ${estadoClickable} ${estadoTitle}>${estadoTxt}</span>
      </div>`;
  });

  html += '</div>';
  cont.innerHTML = html;
}

// Helper para formatear fecha corta tipo "18-may"
function fmtFechaCorta(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate + 'T00:00:00');
  const dia = d.getDate();
  const mes = MESES_CORTO[d.getMonth()];
  return `${dia}-${mes}`;
}

// Toggle pagado / cerrado
async function togglePagado(cierreId) {
  if (!puedeAdminPropinas()) return;
  const c = PROP_CIERRES.find(x => x.id === cierreId);
  if (!c) return;

  if (!c.pagado) {
    // Confirmar marcar como pagado
    const ok = await showConfirm({
      title: '¿Marcar como pagado?',
      msg: `Cierre del ${fmtFechaCorta(c.fecha)} · ${c.turno}\nNeto: $${formatNumber(c.total_neto || 0)}\n\nAl marcar como pagado, los empleados dejarán de verlo en sus pendientes.`,
      type: 'success',
      okLabel: 'Sí, marcar pagado',
      cancelLabel: 'Cancelar'
    });
    if (!ok) return;
  } else {
    // Confirmar revertir a cerrado
    const ok = await showConfirm({
      title: '¿Revertir a Cerrado?',
      msg: `Cierre del ${fmtFechaCorta(c.fecha)} · ${c.turno}\n\nAl revertir, volverá a aparecer como pendiente en los empleados.`,
      type: 'warning',
      okLabel: 'Revertir',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!ok) return;
  }

  try {
    const body = c.pagado
      ? { pagado: false, pagado_en: null, pagado_por: null, actualizado_en: new Date().toISOString() }
      : { pagado: true, pagado_en: new Date().toISOString(), pagado_por: currentUser.id, actualizado_en: new Date().toISOString() };

    await api(`propinas_cierres?id=eq.${cierreId}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });

    // Actualizar cache local
    Object.assign(c, body);

    toast(c.pagado ? 'Marcado como pagado' : 'Vuelto a Cerrado');
    renderPropGestKpis();
    renderPropGestTabla();
  } catch (e) {
    toast('Error al actualizar', 'error');
  }
}

// Placeholder para nuevo cierre (Fase 2)
function nuevoCierrePlaceholder() {
  toast('Carga de cierres - próximamente (Fase 2)', 'warning');
}

// ============================================
// CONFIGURACIÓN DE PROPINAS
// ============================================
async function openConfigPropinas() {
  if (!puedeAdminPropinas()) return;

  // Si no hay config cargada, traerla
  if (!PROP_CONFIG) {
    try {
      const data = await api('propinas_config?id=eq.1');
      PROP_CONFIG = (data && data[0]) ? data[0] : null;
    } catch (e) {
      toast('Error al cargar configuración', 'error');
      return;
    }
  }

  if (!PROP_CONFIG) {
    toast('No se encontró configuración', 'error');
    return;
  }

  document.getElementById('configUSD').value = PROP_CONFIG.cambio_usd || '';
  document.getElementById('configEUR').value = PROP_CONFIG.cambio_eur || '';
  document.getElementById('configBRL').value = PROP_CONFIG.cambio_brl || '';
  document.getElementById('configPct').value = PROP_CONFIG.porcentaje_admin || '';

  // Última actualización
  const ultima = PROP_CONFIG.actualizado_en
    ? `Última actualización: ${new Date(PROP_CONFIG.actualizado_en).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })}`
    : 'Sin actualización previa';
  document.getElementById('configUltima').textContent = ultima;

  document.getElementById('modalConfigPropinas').style.display = 'flex';
}

function closeConfigPropinas() {
  document.getElementById('modalConfigPropinas').style.display = 'none';
}

async function guardarConfigPropinas() {
  const usd = parseFloat(document.getElementById('configUSD').value);
  const eur = parseFloat(document.getElementById('configEUR').value);
  const brl = parseFloat(document.getElementById('configBRL').value);
  const pct = parseFloat(document.getElementById('configPct').value);

  if (isNaN(usd) || usd <= 0) { toast('USD inválido', 'error'); return; }
  if (isNaN(eur) || eur <= 0) { toast('EUR inválido', 'error'); return; }
  if (isNaN(brl) || brl <= 0) { toast('BRL inválido', 'error'); return; }
  if (isNaN(pct) || pct < 0 || pct > 100) { toast('Porcentaje inválido (0-100)', 'error'); return; }

  const btn = document.getElementById('btnGuardarConfig');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const body = {
      cambio_usd: usd,
      cambio_eur: eur,
      cambio_brl: brl,
      porcentaje_admin: pct,
      actualizado_en: new Date().toISOString(),
      actualizado_por: currentUser.id
    };
    await api('propinas_config?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify(body)
    });

    // Actualizar cache
    PROP_CONFIG = Object.assign({}, PROP_CONFIG, body);

    toast('Configuración actualizada');
    closeConfigPropinas();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar configuración';
  }
}

// Exponer al window
window.openMiPropina = openMiPropina;
window.abrirGestionPropinas = abrirGestionPropinas;
window.selectPropLocal = selectPropLocal;
window.togglePagado = togglePagado;
window.nuevoCierrePlaceholder = nuevoCierrePlaceholder;
window.openConfigPropinas = openConfigPropinas;
window.closeConfigPropinas = closeConfigPropinas;
window.guardarConfigPropinas = guardarConfigPropinas;

// ============================================
// ADMINISTRACIÓN - Panel principal
// ============================================
const ADMIN_SECTIONS = [
  {
    id: 'personal',
    icon: 'ti-users',
    color: '#7F77DD',
    title: 'Personal',
    desc: 'Fichas, perfiles, contraseñas, exportar',
    activa: true,
    action: () => openPersonal()
  },
  {
    id: 'editores',
    icon: 'ti-shield-check',
    color: '#5DCAA5',
    title: 'Editores y permisos',
    desc: 'Asignar qué puede editar cada Editor',
    activa: true,
    action: () => openAdminEditores()
  },
  {
    id: 'locales',
    icon: 'ti-building-store',
    color: '#C4622D',
    title: 'Locales',
    desc: 'Gestionar locales del grupo',
    activa: true,
    soloMaster: true,
    action: () => openAdminLocales()
  },
  {
    id: 'insumos',
    icon: 'ti-package',
    color: '#EF9F27',
    title: 'Insumos',
    desc: 'Catálogo de insumos y proveedores',
    activa: true,
    action: () => openAdminInsumos()
  },
  {
    id: 'historial',
    icon: 'ti-history',
    color: '#B4B2A9',
    title: 'Historial',
    desc: 'Auditoría de cambios',
    activa: false
  }
];

function openAdministracion() {
  if (!isMaster() && !isAdmin()) {
    showDashboard();
    return;
  }

  const grid = document.getElementById('adminGrid');
  grid.innerHTML = ADMIN_SECTIONS
    .filter(s => !s.soloMaster || isMaster())
    .map(s => {
      const cls = 'admin-card' + (s.activa ? '' : ' disabled');
      const arrowOrTag = s.activa
        ? `<div class="admin-card-arrow"><i class="ti ti-chevron-right"></i></div>`
        : `<span class="pronto-tag">Pronto</span>`;
      return `
        <button class="${cls}" data-id="${s.id}">
          <div class="admin-card-icon" style="background:${s.color}22">
            <i class="ti ${s.icon}" style="color:${s.color}"></i>
          </div>
          <div class="admin-card-text">
            <div class="admin-card-title">${s.title}</div>
            <div class="admin-card-desc">${s.desc}</div>
          </div>
          ${arrowOrTag}
        </button>`;
    }).join('');

  grid.querySelectorAll('.admin-card').forEach(c => {
    c.addEventListener('click', () => {
      const id = c.dataset.id;
      const sec = ADMIN_SECTIONS.find(s => s.id === id);
      if (sec && sec.activa && sec.action) {
        sec.action();
      } else {
        toast('Próximamente disponible');
      }
    });
  });

  showView('vAdmin');
}

window.openAdministracion = openAdministracion;

// ============================================
// ADMINISTRACIÓN - Usuarios
// ============================================
let ADMIN_USUARIOS_CACHE = [];
let ADMIN_EMPLEADOS_CACHE = [];
let ADMIN_FILTRO_ACTUAL = 'todos';
let EDITANDO_USER_ID = null;
let RESET_USER_ID = null;

// ============================================
// MÓDULO PERSONAL  (reemplaza al viejo "Usuarios")
// Lista unificada: empleados activos + usuarios sin ficha (ej: matfraga)
// ============================================
const AZUCA26_HASH = 'c6a7c00511ff7ca91719d38debce681a27ee1798f905a96801a44c3e75003cbe';
const PERFIL_LABELS = { master: 'Master', admin: 'Admin', editor: 'Editor', usuario: 'Usuario' };

let PERSONAS_CACHE = [];
let PERFIL_EDIT_USERID = null;

// Quita tildes y pasa a minúsculas para buscar con tolerancia
function normalizar(s) {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function formatearFecha(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : iso;
}

function openPersonal() {
  showView('vPersonal');
  const s = document.getElementById('personalSearch');
  if (s) s.value = '';
  ['personalFiltroLocal', 'personalFiltroSector', 'personalFiltroPerfil'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  cargarUsuarios();
}
window.openPersonal = openPersonal;

// Mantengo el nombre cargarUsuarios porque guardarUsuario/reset/toggle lo llaman
async function cargarUsuarios() {
  const lista = document.getElementById('personalLista');
  if (lista) lista.innerHTML = '<div class="loading">Cargando personal...</div>';
  try {
    await cargarEmpleados();
    ADMIN_USUARIOS_CACHE = await api('roster_usuarios?select=*&order=nombre.asc') || [];
    construirPersonas();
    poblarFiltrosPersonal();
    renderPersonal();
  } catch (e) {
    if (lista) lista.innerHTML = '<div class="empty-list" style="color:var(--c-error)">Error al cargar el personal</div>';
  }
}

async function cargarEmpleados() {
  try {
    ADMIN_EMPLEADOS_CACHE = await api('empleados?activo=eq.true&select=id,nombre,apellido,nombre_p,sector,categoria,local,telefono,fecha_nac,es_multilocal,activo&order=apellido.asc') || [];
  } catch (e) {
    console.warn('Error al cargar empleados:', e);
    ADMIN_EMPLEADOS_CACHE = [];
  }
}

function armarPersona(e, u) {
  const apellido = e ? (e.apellido || '') : '';
  const pila = e ? (e.nombre_p || e.nombre || '') : (u ? (u.nombre || '') : '');
  let nombreCompleto;
  if (apellido && pila) nombreCompleto = apellido + ', ' + pila;
  else nombreCompleto = (apellido || pila || (u ? u.nombre : '') || 'Sin nombre');
  const perfil = u ? (u.perfil || 'usuario') : null;
  return {
    key: e ? ('emp-' + e.id) : ('usr-' + u.id),
    empleado: e, user: u,
    apellido: apellido, pila: pila, nombreCompleto: nombreCompleto,
    iniciales: obtenerIniciales(((pila + ' ' + apellido).trim()) || (u ? u.nombre : '') || '?'),
    usuario: u ? (u.usuario || '') : '',
    perfil: perfil,
    perfilLabel: perfil ? (PERFIL_LABELS[perfil] || 'Usuario') : 'Sin acceso',
    local: e ? (e.local || '') : '',
    sector: e ? (e.sector || '') : '',
    categoria: e ? (e.categoria || '') : '',
    telefono: e ? (e.telefono || '') : '',
    fechaNac: e ? (e.fecha_nac || '') : '',
    esMultilocal: e ? !!e.es_multilocal : false,
    tieneAcceso: !!u,
    accesoActivo: u ? !!u.activo : false,
    orden: (apellido || pila || (u ? u.nombre : '') || '').toLowerCase()
  };
}

function construirPersonas() {
  const usersByEmp = {};
  const consumidos = {};
  (ADMIN_USUARIOS_CACHE || []).forEach(u => {
    if (u.empleado_id != null) usersByEmp[u.empleado_id] = u;
  });

  const personas = [];
  (ADMIN_EMPLEADOS_CACHE || []).forEach(e => {
    const u = usersByEmp[e.id] || null;
    if (u) consumidos[u.id] = true;
    personas.push(armarPersona(e, u));
  });
  // Usuarios que pueden entrar pero no quedaron vinculados a un empleado activo
  // (ej: matfraga, o usuarios de empleados dados de baja) -> que no se pierdan
  (ADMIN_USUARIOS_CACHE || []).forEach(u => {
    if (consumidos[u.id]) return;
    personas.push(armarPersona(null, u));
  });

  personas.sort((a, b) => a.orden.localeCompare(b.orden, 'es'));
  PERSONAS_CACHE = personas;
}

function poblarFiltrosPersonal() {
  const locales = Array.from(new Set(PERSONAS_CACHE.map(p => p.local).filter(Boolean))).sort();
  const sectores = Array.from(new Set(PERSONAS_CACHE.map(p => p.sector).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'));
  const selLocal = document.getElementById('personalFiltroLocal');
  const selSector = document.getElementById('personalFiltroSector');
  if (selLocal) {
    const prev = selLocal.value;
    selLocal.innerHTML = '<option value="">Todos los locales</option>' +
      locales.map(l => '<option value="' + esc(l) + '">' + esc(LOCAL_LABELS[l] || l) + '</option>').join('');
    selLocal.value = prev;
  }
  if (selSector) {
    const prev = selSector.value;
    selSector.innerHTML = '<option value="">Todos los sectores</option>' +
      sectores.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
    selSector.value = prev;
  }
}

function personasFiltradas() {
  const q = normalizar((document.getElementById('personalSearch') || {}).value);
  const fLocal = (document.getElementById('personalFiltroLocal') || {}).value || '';
  const fSector = (document.getElementById('personalFiltroSector') || {}).value || '';
  const fPerfil = (document.getElementById('personalFiltroPerfil') || {}).value || '';
  return PERSONAS_CACHE.filter(p => {
    if (fLocal && p.local !== fLocal) return false;
    if (fSector && p.sector !== fSector) return false;
    if (fPerfil) {
      if (fPerfil === 'sinacceso') { if (p.tieneAcceso) return false; }
      else if (p.perfil !== fPerfil) return false;
    }
    if (q) {
      const hay = normalizar(p.apellido) + ' ' + normalizar(p.pila) + ' ' +
                  normalizar(p.usuario) + ' ' + normalizar(p.nombreCompleto);
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function renderPersonal() {
  const lista = document.getElementById('personalLista');
  if (!lista) return;
  const items = personasFiltradas();
  const cnt = document.getElementById('personalCount');
  if (cnt) cnt.textContent = items.length + (items.length === 1 ? ' persona' : ' personas');
  if (!items.length) {
    lista.innerHTML = '<div class="empty-list">No se encontró personal con ese criterio</div>';
    return;
  }
  const gestiona = isMaster() || isAdmin();

  lista.innerHTML = items.map(p => {
    const avCls = p.perfil ? ('p-' + p.perfil) : 'p-sinacceso';
    const badgeCls = p.perfil ? p.perfil : 'sinacceso';

    const subParts = [];
    if (p.usuario) subParts.push('@' + esc(p.usuario));
    if (p.sector) subParts.push(esc(p.sector));
    if (p.categoria) subParts.push(esc(p.categoria));
    const sub = subParts.join(' · ');

    const chips = [];
    if (p.local) chips.push('<span class="pc-chip"><i class="ti ti-map-pin"></i>' + esc(LOCAL_LABELS[p.local] || p.local) + '</span>');
    if (p.esMultilocal) chips.push('<span class="pc-chip"><i class="ti ti-arrows-shuffle"></i>Multilocal</span>');
    if (p.tieneAcceso && !p.accesoActivo) chips.push('<span class="pc-chip pc-chip-off"><i class="ti ti-user-off"></i>Acceso inactivo</span>');

    let acciones = '<button class="btn-ghost pc-btn" onclick="abrirFicha(\'' + p.key + '\')"><i class="ti ti-id"></i>Ver ficha</button>';
    if (gestiona) {
      if (p.tieneAcceso) {
        acciones += '<button class="btn-ghost pc-btn" onclick="abrirCambiarPerfil(' + p.user.id + ')"><i class="ti ti-user-cog"></i>Perfil</button>';
        acciones += '<button class="btn-ghost pc-btn" onclick="resetearAzuca26(' + p.user.id + ')"><i class="ti ti-key"></i>Reset</button>';
        if (!currentUser || p.user.id !== currentUser.id) {
          acciones += '<button class="btn-ghost pc-btn" onclick="toggleActivoUser(' + p.user.id + ')"><i class="ti ti-' + (p.accesoActivo ? 'user-off' : 'user-check') + '"></i>' + (p.accesoActivo ? 'Desactivar' : 'Activar') + '</button>';
        }
      } else if (p.empleado) {
        acciones += '<button class="btn-ghost pc-btn" onclick="crearAccesoEmpleado(' + p.empleado.id + ')"><i class="ti ti-user-plus"></i>Crear acceso</button>';
      }
    }

    return '' +
      '<div class="personal-card' + (p.tieneAcceso && !p.accesoActivo ? ' inactive' : '') + '">' +
        '<div class="pc-top">' +
          '<div class="user-avatar ' + avCls + '">' + esc(p.iniciales) + '</div>' +
          '<div class="pc-id">' +
            '<div class="pc-name">' + esc(p.nombreCompleto) + '</div>' +
            (sub ? '<div class="pc-sub">' + sub + '</div>' : '') +
          '</div>' +
          '<span class="perfil-badge ' + badgeCls + '">' + esc(p.perfilLabel) + '</span>' +
        '</div>' +
        (chips.length ? '<div class="pc-meta">' + chips.join('') + '</div>' : '') +
        '<div class="pc-actions">' + acciones + '</div>' +
      '</div>';
  }).join('');
}

// ---- Ficha (solo lectura) ----
window.abrirFicha = function(key) {
  const p = PERSONAS_CACHE.find(x => x.key === key);
  if (!p) return;
  const fila = (lbl, val) => '<div class="ficha-row"><span class="ficha-k">' + lbl + '</span><span class="ficha-v">' + (val ? esc(val) : '—') + '</span></div>';
  const estado = p.tieneAcceso ? (p.accesoActivo ? 'Activo' : 'Inactivo') : 'Sin acceso a la app';
  document.getElementById('fichaTitulo').textContent = p.nombreCompleto;
  document.getElementById('fichaBody').innerHTML =
    fila('Apellido', p.apellido) +
    fila('Nombre', p.pila) +
    fila('Usuario', p.usuario ? '@' + p.usuario : '') +
    fila('Perfil', p.perfilLabel) +
    fila('Local', p.local ? (LOCAL_LABELS[p.local] || p.local) : '') +
    fila('Sector', p.sector) +
    fila('Categoría', p.categoria) +
    fila('Teléfono', p.telefono) +
    fila('Fecha de nacimiento', formatearFecha(p.fechaNac)) +
    fila('Multilocal', p.esMultilocal ? 'Sí' : 'No') +
    fila('Estado de acceso', estado);
  document.getElementById('modalFicha').classList.add('show');
};
window.closeFichaModal = function() {
  document.getElementById('modalFicha').classList.remove('show');
};

// ---- Cambiar perfil (Master + Admin) ----
window.abrirCambiarPerfil = function(userId) {
  if (!isMaster() && !isAdmin()) return;
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === userId);
  if (!u) return;
  PERFIL_EDIT_USERID = userId;
  document.getElementById('cambiarPerfilNombre').textContent = (u.nombre || ('@' + u.usuario));
  document.getElementById('cambiarPerfilSelect').value = u.perfil || 'usuario';
  const optM = document.getElementById('cpOptMaster');
  optM.disabled = !isMaster();
  optM.textContent = isMaster() ? 'Master (máximo nivel)' : 'Master (solo un Master puede asignar)';
  document.getElementById('cambiarPerfilError').textContent = '';
  document.getElementById('modalCambiarPerfil').classList.add('show');
};
window.closeCambiarPerfilModal = function() {
  document.getElementById('modalCambiarPerfil').classList.remove('show');
};
window.guardarCambioPerfil = async function() {
  const err = document.getElementById('cambiarPerfilError');
  err.textContent = '';
  const nuevo = document.getElementById('cambiarPerfilSelect').value;
  if (nuevo === 'master' && !isMaster()) {
    err.textContent = 'Solo un Master puede asignar el perfil Master';
    return;
  }
  const btn = document.getElementById('btnGuardarPerfil');
  try {
    btn.disabled = true; btn.textContent = 'Guardando...';
    await api('roster_usuarios?id=eq.' + PERFIL_EDIT_USERID, {
      method: 'PATCH',
      body: JSON.stringify({ perfil: nuevo })
    });
    closeCambiarPerfilModal();
    toast('✓ Perfil actualizado', 'success');
    await cargarUsuarios();
  } catch (e) {
    err.textContent = 'Error al actualizar el perfil';
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
};

// ---- Reset de contraseña a azuca26 (un toque, Master + Admin) ----
window.resetearAzuca26 = async function(userId) {
  if (!isMaster() && !isAdmin()) return;
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === userId);
  if (!u) return;
  const ok = await showConfirm({
    title: 'Resetear contraseña',
    msg: 'La contraseña de ' + (u.nombre || ('@' + u.usuario)) + ' va a quedar en "azuca26".\n\nLa próxima vez que entre, el sistema le va a pedir que elija una nueva.\n\n¿Confirmás?',
    type: 'warning',
    okLabel: 'Sí, resetear',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;
  try {
    await api('roster_usuarios?id=eq.' + userId, {
      method: 'PATCH',
      body: JSON.stringify({ password_hash: AZUCA26_HASH, debe_cambiar_password: true })
    });
    toast('✓ Contraseña reseteada a azuca26', 'success');
  } catch (e) {
    toast('Error al resetear la contraseña', 'error');
  }
};

// ---- Crear acceso para un empleado sin usuario (reusa el modal de Crear) ----
window.crearAccesoEmpleado = function(empId) {
  abrirCrearUsuario();
  const e = ADMIN_EMPLEADOS_CACHE.find(x => x.id === empId);
  if (e) {
    const nom = ((e.nombre_p || e.nombre || '') + ' ' + (e.apellido || '')).trim();
    const elNom = document.getElementById('userNombre');
    const elEmp = document.getElementById('userEmpleado');
    if (elNom) elNom.value = nom;
    if (elEmp) elEmp.value = String(empId);
  }
};

// ============================================
// EXPORTAR A EXCEL  (helper genérico reutilizable)
// hojas = [{ nombre: 'Personal', filas: [{Col:val,...}, ...] }, ...]
// ============================================
function exportarAExcel(nombreArchivo, hojas) {
  if (typeof XLSX === 'undefined') {
    toast('No se pudo cargar el exportador de Excel', 'error');
    return;
  }
  const wb = XLSX.utils.book_new();
  (hojas || []).forEach(h => {
    const ws = XLSX.utils.json_to_sheet(h.filas || []);
    XLSX.utils.book_append_sheet(wb, ws, (h.nombre || 'Hoja').substring(0, 31));
  });
  XLSX.writeFile(wb, nombreArchivo);
}
window.exportarAExcel = exportarAExcel;

window.exportarPersonalExcel = function() {
  const items = personasFiltradas();
  if (!items.length) {
    toast('No hay personal para exportar con esos filtros', 'error');
    return;
  }
  const filas = items.map(p => ({
    'Apellido': p.apellido,
    'Nombre': p.pila,
    'Usuario': p.usuario,
    'Perfil': p.perfilLabel,
    'Local': p.local ? (LOCAL_LABELS[p.local] || p.local) : '',
    'Sector': p.sector,
    'Categoría': p.categoria,
    'Teléfono': p.telefono,
    'Fecha nacimiento': p.fechaNac || '',
    'Multilocal': p.esMultilocal ? 'Sí' : 'No',
    'Acceso': p.tieneAcceso ? (p.accesoActivo ? 'Activo' : 'Inactivo') : 'Sin acceso'
  }));
  exportarAExcel('Personal_AZUCA_' + hoyStr() + '.xlsx', [{ nombre: 'Personal', filas: filas }]);
  toast('✓ Excel generado', 'success');
};

// Listeners de filtros del módulo Personal
(function initPersonalFiltros() {
  const s = document.getElementById('personalSearch');
  if (s) s.addEventListener('input', renderPersonal);
  ['personalFiltroLocal', 'personalFiltroSector', 'personalFiltroPerfil'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', renderPersonal);
  });
})();

// ============================================
// MODAL CREAR / EDITAR USUARIO
// ============================================
window.abrirCrearUsuario = function() {
  EDITANDO_USER_ID = null;
  document.getElementById('userFormTitle').textContent = 'Nuevo usuario';
  document.getElementById('userNombre').value = '';
  document.getElementById('userUsuario').value = '';
  document.getElementById('userPassword').value = '';
  document.getElementById('userPerfil').value = 'usuario';
  document.getElementById('userEmpleado').innerHTML = '<option value="">Sin vincular (no tiene turnos)</option>' +
    ADMIN_EMPLEADOS_CACHE.map(e => {
      const lbl = `${e.nombre || ''} ${e.apellido || ''}`.trim() + (e.local ? ' · ' + (LOCAL_LABELS[e.local] || e.local) : '');
      return `<option value="${e.id}">${esc(lbl)}</option>`;
    }).join('');
  document.getElementById('userEmpleado').value = '';
  document.getElementById('userPasswordField').style.display = '';
  document.getElementById('userFormError').textContent = '';

  // Si no es Master, no puede crear Masters
  const optMaster = document.getElementById('optMaster');
  optMaster.disabled = !isMaster();
  optMaster.textContent = isMaster() ? 'Master (máximo nivel)' : 'Master (solo Master puede crear Masters)';

  document.getElementById('modalUserForm').classList.add('show');
};

window.abrirEditarUsuario = function(id) {
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === id);
  if (!u) return;
  EDITANDO_USER_ID = id;
  document.getElementById('userFormTitle').textContent = 'Editar usuario';
  document.getElementById('userNombre').value = u.nombre || '';
  document.getElementById('userUsuario').value = u.usuario || '';
  document.getElementById('userPassword').value = '';
  document.getElementById('userPerfil').value = u.perfil || 'usuario';

  document.getElementById('userEmpleado').innerHTML = '<option value="">Sin vincular (no tiene turnos)</option>' +
    ADMIN_EMPLEADOS_CACHE.map(e => {
      const lbl = `${e.nombre || ''} ${e.apellido || ''}`.trim() + (e.local ? ' · ' + (LOCAL_LABELS[e.local] || e.local) : '');
      return `<option value="${e.id}">${esc(lbl)}</option>`;
    }).join('');
  document.getElementById('userEmpleado').value = u.empleado_id || '';

  // En edición, ocultar password (se cambia con el botón de reset)
  document.getElementById('userPasswordField').style.display = 'none';
  document.getElementById('userFormError').textContent = '';

  // Reglas: solo Master puede asignar Master
  const optMaster = document.getElementById('optMaster');
  optMaster.disabled = !isMaster();
  optMaster.textContent = isMaster() ? 'Master (máximo nivel)' : 'Master (solo Master puede asignar Master)';

  document.getElementById('modalUserForm').classList.add('show');
};

window.closeUserFormModal = function() {
  document.getElementById('modalUserForm').classList.remove('show');
};

window.guardarUsuario = async function() {
  const errBox = document.getElementById('userFormError');
  errBox.textContent = '';

  const nombre = document.getElementById('userNombre').value.trim();
  const usuario = document.getElementById('userUsuario').value.trim().toLowerCase();
  const perfil = document.getElementById('userPerfil').value;
  const empleadoId = document.getElementById('userEmpleado').value;
  const password = document.getElementById('userPassword').value;

  if (!nombre) { errBox.textContent = 'Falta el nombre'; return; }
  if (!usuario) { errBox.textContent = 'Falta el usuario'; return; }
  if (!/^[a-z0-9_.-]+$/i.test(usuario)) {
    errBox.textContent = 'El usuario solo puede tener letras, números, _ . -';
    return;
  }

  // Validar permisos para perfil Master
  if (perfil === 'master' && !isMaster()) {
    errBox.textContent = 'Solo un Master puede asignar el perfil Master';
    return;
  }

  try {
    const btn = document.getElementById('btnGuardarUser');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    if (EDITANDO_USER_ID) {
      // Editando: verificar conflictos de username SOLO si cambió
      const original = ADMIN_USUARIOS_CACHE.find(u => u.id === EDITANDO_USER_ID);
      if (usuario !== (original.usuario || '').toLowerCase()) {
        const existentes = await api(`roster_usuarios?usuario=eq.${encodeURIComponent(usuario)}&select=id`);
        if (existentes && existentes.length) {
          throw new Error('Ese usuario ya existe');
        }
      }

      await api(`roster_usuarios?id=eq.${EDITANDO_USER_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre,
          usuario,
          perfil,
          empleado_id: empleadoId ? parseInt(empleadoId) : null
        })
      });

      toast('✓ Usuario actualizado', 'success');
    } else {
      // Creando: requiere password
      if (!password || password.length < 6) {
        errBox.textContent = 'La contraseña debe tener al menos 6 caracteres';
        btn.disabled = false;
        btn.textContent = 'Guardar';
        return;
      }

      // Verificar que no exista
      const existentes = await api(`roster_usuarios?usuario=eq.${encodeURIComponent(usuario)}&select=id`);
      if (existentes && existentes.length) {
        throw new Error('Ese usuario ya existe');
      }

      const passHash = await sha256(password);

      await api('roster_usuarios', {
        method: 'POST',
        body: JSON.stringify({
          usuario,
          nombre,
          perfil,
          password_hash: passHash,
          empleado_id: empleadoId ? parseInt(empleadoId) : null,
          debe_cambiar_password: true,
          activo: true
        })
      });

      toast('✓ Usuario creado', 'success');
    }

    closeUserFormModal();
    await cargarUsuarios();
  } catch (err) {
    errBox.textContent = err.message || 'Error al guardar';
  } finally {
    const btn = document.getElementById('btnGuardarUser');
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
};

// ============================================
// MODAL RESET PASSWORD
// ============================================
window.abrirResetPass = function(id) {
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === id);
  if (!u) return;
  RESET_USER_ID = id;
  document.getElementById('resetPassUser').textContent = `Usuario: ${u.nombre || u.usuario} (@${u.usuario})`;
  document.getElementById('resetPassValue').value = '';
  document.getElementById('resetPassError').textContent = '';
  document.getElementById('modalResetPass').classList.add('show');
};

window.closeResetPassModal = function() {
  document.getElementById('modalResetPass').classList.remove('show');
};

window.confirmarResetPass = async function() {
  const errBox = document.getElementById('resetPassError');
  errBox.textContent = '';
  const nueva = document.getElementById('resetPassValue').value;

  if (!nueva || nueva.length < 6) {
    errBox.textContent = 'Debe tener al menos 6 caracteres';
    return;
  }

  try {
    const hash = await sha256(nueva);
    await api(`roster_usuarios?id=eq.${RESET_USER_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({
        password_hash: hash,
        debe_cambiar_password: true
      })
    });
    closeResetPassModal();
    toast('✓ Contraseña reseteada', 'success');
    await cargarUsuarios();
  } catch (err) {
    errBox.textContent = err.message || 'Error al resetear';
  }
};

// ============================================
// ACTIVAR / DESACTIVAR USUARIO
// ============================================
window.toggleActivoUser = async function(id) {
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === id);
  if (!u) return;
  if (u.id === currentUser.id) {
    toast('No podés desactivar tu propia cuenta', 'error');
    return;
  }

  // Aviso especial si se está por desactivar a un Master
  if (u.activo && u.perfil === 'master') {
    const ok = await showConfirm({
      title: 'Desactivar a un Master',
      msg: `Estás por desactivar a un Master (${u.nombre}).\n\nSi te quedás sin Masters, NADIE va a poder crear nuevos Masters ni editar Locales.\n\n¿Seguro que querés continuar?`,
      type: 'danger',
      danger: true,
      okLabel: 'Sí, desactivar',
      cancelLabel: 'Cancelar'
    });
    if (!ok) return;
  } else {
    const accion = u.activo ? 'desactivar' : 'activar';
    const ok = await showConfirm({
      title: `¿${accion.charAt(0).toUpperCase() + accion.slice(1)} usuario?`,
      msg: `Vas a ${accion} a ${u.nombre || u.usuario}.`,
      type: u.activo ? 'warning' : 'info',
      okLabel: u.activo ? 'Desactivar' : 'Activar',
      danger: u.activo
    });
    if (!ok) return;
  }

  try {
    await api(`roster_usuarios?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: !u.activo })
    });
    toast(`✓ Usuario ${u.activo ? 'desactivado' : 'activado'}`, 'success');
    await cargarUsuarios();
  } catch (err) {
    toast('Error al cambiar estado', 'error');
  }
};

// ============================================
// ADMINISTRACIÓN - Editores y permisos
// ============================================
// LOCALES_DISPONIBLES ya no es una constante: ahora se obtiene dinámicamente
// con getLocalesActivos() desde la base.

let EDITORES_CACHE = [];
let LOCALES_EDITANDO_ID = null;

const PERMISOS_DEF = [
  { key: 'editor_rosters',    label: 'Rosters',       icon: 'ti-calendar-event', tipo: 'editor' },
  { key: 'editor_propinas',   label: 'Propinas',      icon: 'ti-cash',           tipo: 'editor' },
  { key: 'editor_biblioteca', label: 'Biblioteca',    icon: 'ti-books',          tipo: 'editor' },
  { key: 'editor_recetas',    label: 'Recetas',       icon: 'ti-chef-hat',       tipo: 'editor' },
  { key: 'editor_pedidos',    label: 'Pedidos',       icon: 'ti-shopping-cart',  tipo: 'editor' }
];

async function openAdminEditores() {
  showView('vAdminEditores');
  await cargarEditores();
}
window.openAdminEditores = openAdminEditores;

async function cargarEditores() {
  const lista = document.getElementById('editoresLista');
  lista.innerHTML = '<div class="loading">Cargando editores...</div>';

  try {
    EDITORES_CACHE = await api(
      `roster_usuarios?perfil=eq.editor&activo=eq.true&select=*&order=nombre.asc`
    ) || [];
    renderEditores();
  } catch (e) {
    lista.innerHTML = '<div class="empty-list" style="color:var(--c-error)">Error al cargar editores</div>';
  }
}

function renderEditores() {
  const lista = document.getElementById('editoresLista');
  document.getElementById('editoresCount').textContent =
    EDITORES_CACHE.length + (EDITORES_CACHE.length === 1 ? ' editor' : ' editores');

  if (!EDITORES_CACHE.length) {
    lista.innerHTML = `
      <div class="editor-empty">
        <div class="editor-empty-icon"><i class="ti ti-users-group"></i></div>
        <div class="editor-empty-title">No hay editores asignados</div>
        <div class="editor-empty-desc">
          Para que alguien aparezca acá, andá a <strong>Usuarios</strong> y cambiale el perfil a <strong>Editor</strong>.
        </div>
      </div>`;
    return;
  }

  lista.innerHTML = EDITORES_CACHE.map(u => {
    const inicial = (u.nombre || u.usuario || '?').trim().charAt(0).toUpperCase();
    const locales = u.locales_asignados || [];
    const localesTxt = locales.length
      ? locales.map(l => LOCAL_LABELS[l] || l).join(', ')
      : 'Sin locales asignados';
    const localesIco = locales.length ? 'ti-map-pin' : 'ti-map-pin-off';

    const perms = PERMISOS_DEF.map(p => {
      const activo = !!u[p.key];
      const cls = 'permiso-check' + (activo ? ' activo' : '') + (p.tipo === 'admin' ? ' admin-perm' : '');
      const icon = activo ? 'ti-check' : p.icon;
      return `
        <label class="${cls}" onclick="togglePermiso(${u.id}, '${p.key}', this)">
          <i class="ti ${icon}"></i>
          <span>${p.label}</span>
        </label>`;
    }).join('');

    return `
      <div class="editor-card" data-id="${u.id}">
        <div class="editor-card-head">
          <div class="editor-card-avatar">${esc(inicial)}</div>
          <div class="editor-card-info">
            <div class="editor-card-name">${esc(u.nombre || u.usuario)}</div>
            <div class="editor-card-meta">@${esc(u.usuario)}</div>
          </div>
        </div>

        <div class="editor-card-locales">
          <i class="ti ${localesIco}"></i>
          <span>${esc(localesTxt)}</span>
          <button class="editar-locales" onclick="abrirEditarLocales(${u.id})">Editar</button>
        </div>

        <div class="permisos-grid">
          ${perms}
        </div>
      </div>`;
  }).join('');
}

window.togglePermiso = async function(userId, key, labelEl) {
  const user = EDITORES_CACHE.find(u => u.id === userId);
  if (!user) return;

  const nuevoValor = !user[key];

  // Update visual inmediato
  labelEl.classList.toggle('activo', nuevoValor);
  const icon = labelEl.querySelector('i.ti');
  if (nuevoValor) {
    icon.classList.remove(...Array.from(icon.classList).filter(c => c.startsWith('ti-')));
    icon.classList.add('ti-check');
  } else {
    const def = PERMISOS_DEF.find(p => p.key === key);
    icon.classList.remove(...Array.from(icon.classList).filter(c => c.startsWith('ti-')));
    icon.classList.add(def.icon);
  }

  // Actualizar caché local
  user[key] = nuevoValor;

  // Guardar en BD
  try {
    await api(`roster_usuarios?id=eq.${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ [key]: nuevoValor })
    });
  } catch (err) {
    toast('Error al guardar permiso', 'error');
    // Revertir cambio visual
    user[key] = !nuevoValor;
    labelEl.classList.toggle('activo', !nuevoValor);
  }
};

// ============================================
// MODAL: EDITAR LOCALES DE UN EDITOR
// ============================================
window.abrirEditarLocales = function(userId) {
  const user = EDITORES_CACHE.find(u => u.id === userId);
  if (!user) return;
  LOCALES_EDITANDO_ID = userId;

  document.getElementById('localesUserName').innerHTML =
    `<strong>${esc(user.nombre || user.usuario)}</strong>`;

  const asignados = user.locales_asignados || [];

  document.getElementById('localesGrid').innerHTML = getLocalesActivos().map(loc => {
    const activo = asignados.includes(loc);
    return `
      <label class="local-check${activo ? ' activo' : ''}" data-local="${loc}">
        <input type="checkbox" ${activo ? 'checked' : ''}>
        ${esc(LOCAL_LABELS[loc] || loc)}
      </label>`;
  }).join('');

  // Toggle visual
  document.querySelectorAll('#localesGrid .local-check').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      el.classList.toggle('activo');
      const cb = el.querySelector('input');
      cb.checked = el.classList.contains('activo');
    });
  });

  document.getElementById('localesError').textContent = '';
  document.getElementById('modalLocales').classList.add('show');
};

window.closeLocalesModal = function() {
  document.getElementById('modalLocales').classList.remove('show');
};

window.guardarLocales = async function() {
  if (!LOCALES_EDITANDO_ID) return;
  const errBox = document.getElementById('localesError');
  errBox.textContent = '';

  const checks = document.querySelectorAll('#localesGrid .local-check.activo');
  const nuevos = Array.from(checks).map(c => c.dataset.local);

  try {
    await api(`roster_usuarios?id=eq.${LOCALES_EDITANDO_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ locales_asignados: nuevos.length ? nuevos : null })
    });

    // Actualizar caché
    const user = EDITORES_CACHE.find(u => u.id === LOCALES_EDITANDO_ID);
    if (user) user.locales_asignados = nuevos;

    closeLocalesModal();
    toast('✓ Locales actualizados', 'success');
    renderEditores();
  } catch (err) {
    errBox.textContent = 'Error al guardar: ' + err.message;
  }
};

// ============================================
// LOGOUT
// ============================================
window.doLogout = async function() {
  const ok = await showConfirm({
    title: '¿Cerrar sesión?',
    msg: 'Vas a salir de AZUCAPP. Tendrás que volver a iniciar sesión.',
    type: 'info',
    okLabel: 'Cerrar sesión',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;
  clearSession();
  currentUser = null;
  currentEmpleado = null;
  semanaActual = null;
  document.getElementById('loginUsuario').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
  showView('vLogin');
};

// ============================================
// NAVEGACIÓN
// ============================================
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const v = document.getElementById(viewId);
  if (v) v.classList.add('active');
  window.scrollTo(0, 0);
}

window.showDashboard = showDashboard;
window.showChangePass = function() {
  document.getElementById('voluntaryPassError').textContent = '';
  document.getElementById('currentPass').value = '';
  document.getElementById('voluntaryPass1').value = '';
  document.getElementById('voluntaryPass2').value = '';
  showView('vChangePassVoluntary');
};

// Cerrar modales clicando el overlay
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => {
    if (e.target === ov) {
      ov.classList.remove('show');
    }
  });
});

// ============================================
// INICIALIZACIÓN
// ============================================
async function init() {
  const savedUser = loadSession();

  if (savedUser) {
    try {
      const fresh = await api(`roster_usuarios?id=eq.${savedUser.id}&select=*`);
      if (fresh && fresh[0] && fresh[0].activo) {
        currentUser = fresh[0];
        saveSession(currentUser);

        // Cargar lista de locales antes de mostrar nada
        await cargarLocalesDesdeBase();

        if (currentUser.debe_cambiar_password) {
          showView('vChangePass');
        } else {
          showDashboard();
        }
        return;
      }
    } catch(e) {
      console.warn('No se pudo verificar sesión:', e);
    }
    clearSession();
  }

  showView('vLogin');

  // Actualizar fecha cada minuto
  setInterval(() => {
    const dt = document.getElementById('datetime');
    if (dt && currentUser) {
      dt.textContent = fmtDateTime(new Date());
    }
  }, 60000);
}

// ============================================
// MÓDULO: BIBLIOTECA
// ============================================

let BIB_CATEGORIAS = [];     // cache de categorías
let BIB_CONTENIDOS = [];     // cache de contenidos visibles
let BIB_FILTRO_CAT = null;   // null = "Todas", o id de categoría
let BIB_EDITANDO_CONT = null; // contenido que se está editando (o null = nuevo)
let BIB_EDITANDO_CAT = null;  // categoría que se está editando (o null = nueva)
let BIB_TIPO_SEL = 'pdf';    // tipo seleccionado en modal
let BIB_LOCALES_SEL = [];    // locales seleccionados en modal
let BIB_ICONO_SEL = 'ti-folder'; // ícono seleccionado en modal categoría

// Definición de tipos de contenido
const BIB_TIPOS = [
  { key: 'pdf',   label: 'PDF',   icon: 'ti-file-text',        cls: 'bib-icon-pdf' },
  { key: 'doc',   label: 'Doc',   icon: 'ti-file-description', cls: 'bib-icon-doc' },
  { key: 'video', label: 'Video', icon: 'ti-brand-youtube',    cls: 'bib-icon-video' },
  { key: 'audio', label: 'Audio', icon: 'ti-brand-spotify',    cls: 'bib-icon-audio' }
];

// Íconos disponibles para categorías
const BIB_ICONOS_CAT = [
  'ti-folder', 'ti-building-bank', 'ti-school', 'ti-clipboard-list',
  'ti-shield', 'ti-sparkles', 'ti-chef-hat', 'ti-tools',
  'ti-heart', 'ti-flame', 'ti-bell', 'ti-bookmark',
  'ti-star', 'ti-bulb', 'ti-trophy', 'ti-coffee',
  'ti-map', 'ti-camera', 'ti-music', 'ti-message',
  'ti-calendar', 'ti-target', 'ti-rocket', 'ti-leaf'
];

// ¿Puede el usuario administrar la biblioteca?
function puedeAdminBib() {
  return isMaster() || isAdmin() || currentUser.editor_biblioteca === true;
}

// ¿Puede gestionar categorías y borrar? (solo Admin/Master)
function puedeAdminBibCat() {
  return isMaster() || isAdmin();
}

// Locales del usuario actual (o todos si es master/admin)
function localesUsuarioActual() {
  if (isMaster() || isAdmin()) return getLocalesActivos();
  return currentUser.locales_asignados || [];
}

// ============================================
// VISTA USUARIO: Mi Biblioteca
// ============================================
async function openMiBiblioteca() {
  showView('vBiblioteca');
  const cont = document.getElementById('bibContenido');
  const chips = document.getElementById('bibChips');
  cont.innerHTML = '<div class="loading">Cargando biblioteca...</div>';
  chips.innerHTML = '';

  // Cargar categorías y contenidos en paralelo
  try {
    const [cats, conts] = await Promise.all([
      api('biblioteca_categorias?activo=eq.true&order=orden.asc'),
      api('biblioteca_contenidos?activo=eq.true&order=creado_en.desc')
    ]);
    BIB_CATEGORIAS = cats || [];
    BIB_CONTENIDOS = conts || [];
  } catch (e) {
    cont.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar biblioteca</div>';
    return;
  }

  // Filtrar contenidos por locales del usuario
  const localesUser = localesUsuarioActual();
  const visibles = BIB_CONTENIDOS.filter(c => {
    if (isMaster() || isAdmin()) return true;
    if (!c.locales || c.locales.length === 0) return false;
    return c.locales.some(loc => localesUser.includes(loc));
  });

  // Render chips de categorías
  renderBibChips(visibles);
  renderBibContenidos(visibles);
}

function renderBibChips(visibles) {
  const chips = document.getElementById('bibChips');
  // Solo mostrar categorías que tengan al menos un contenido visible
  const catsConContenido = BIB_CATEGORIAS.filter(cat =>
    visibles.some(c => c.categoria_id === cat.id)
  );

  let html = `<button class="bib-chip ${BIB_FILTRO_CAT === null ? 'active' : ''}" onclick="filtrarBibCat(null)">Todas</button>`;
  catsConContenido.forEach(cat => {
    html += `<button class="bib-chip ${BIB_FILTRO_CAT === cat.id ? 'active' : ''}" onclick="filtrarBibCat(${cat.id})">
      <i class="ti ${esc(cat.icono || 'ti-folder')}"></i>${esc(cat.nombre)}
    </button>`;
  });
  chips.innerHTML = html;
}

function filtrarBibCat(catId) {
  BIB_FILTRO_CAT = catId;
  // Re-render con filtro aplicado
  const localesUser = localesUsuarioActual();
  const visibles = BIB_CONTENIDOS.filter(c => {
    if (isMaster() || isAdmin()) return true;
    if (!c.locales || c.locales.length === 0) return false;
    return c.locales.some(loc => localesUser.includes(loc));
  });
  renderBibChips(visibles);
  renderBibContenidos(visibles);
}

function renderBibContenidos(visibles) {
  const cont = document.getElementById('bibContenido');
  const filtrados = BIB_FILTRO_CAT === null
    ? visibles
    : visibles.filter(c => c.categoria_id === BIB_FILTRO_CAT);

  let html = '';

  // ===== BOTÓN DE GESTIÓN (solo Editor con permiso, Admin o Master) =====
  if (puedeAdminBib()) {
    html += `
      <button class="btn-gestion" onclick="openAdminBiblioteca()">
        <i class="ti ti-settings"></i> GESTIÓN DE BIBLIOTECA
      </button>`;
  }

  if (filtrados.length === 0) {
    html += `
      <div class="bib-empty">
        <i class="ti ti-books-off"></i>
        <div class="bib-empty-title">No hay contenido disponible</div>
        <div class="bib-empty-desc">${BIB_FILTRO_CAT === null
          ? 'Cuando se cargue material, aparecerá acá.'
          : 'No hay material en esta categoría para tus locales.'}</div>
      </div>`;
    cont.innerHTML = html;
    return;
  }

  html += '<div class="bib-grid">';
  filtrados.forEach(c => {
    const tipo = BIB_TIPOS.find(t => t.key === c.tipo) || BIB_TIPOS[0];
    const cat = BIB_CATEGORIAS.find(k => k.id === c.categoria_id);
    html += `
      <a class="bib-card" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">
        <div class="bib-card-top">
          <div class="bib-card-icon ${tipo.cls}"><i class="ti ${tipo.icon}"></i></div>
          <span class="bib-card-tipo">${tipo.label}</span>
        </div>
        <div class="bib-card-titulo">${esc(c.titulo)}</div>
        <div class="bib-card-cat">
          <i class="ti ${esc(cat ? cat.icono : 'ti-folder')}"></i>
          ${esc(cat ? cat.nombre : 'Sin categoría')}
        </div>
      </a>`;
  });
  html += '</div>';
  cont.innerHTML = html;
}

// ============================================
// VISTA ADMIN: Administrar Biblioteca
// ============================================
async function openAdminBiblioteca() {
  if (!puedeAdminBib()) {
    toast('No tenés permiso', 'error');
    return;
  }
  showView('vAdminBiblioteca');

  // Tab de categorías solo visible para Admin/Master
  document.getElementById('bibTabCategorias').style.display =
    puedeAdminBibCat() ? 'inline-flex' : 'none';

  // Subtítulo según rol
  document.getElementById('adminBibSubtitle').textContent =
    puedeAdminBibCat() ? 'Gestión de contenidos y categorías' : 'Gestión de contenidos';

  // Mostrar tab contenidos por defecto
  switchBibTab('contenidos');

  // Cargar datos
  await recargarBibAdmin();
}

async function recargarBibAdmin() {
  try {
    const [cats, conts] = await Promise.all([
      api('biblioteca_categorias?activo=eq.true&order=orden.asc'),
      api('biblioteca_contenidos?activo=eq.true&order=creado_en.desc')
    ]);
    BIB_CATEGORIAS = cats || [];
    BIB_CONTENIDOS = conts || [];
  } catch (e) {
    toast('Error al cargar datos', 'error');
    return;
  }
  renderBibAdminLista();
  renderBibAdminCategorias();
}

function switchBibTab(tab) {
  const tabCont = document.getElementById('bibTabContenidos');
  const tabCat  = document.getElementById('bibTabCategorias');
  const panCont = document.getElementById('bibPanelContenidos');
  const panCat  = document.getElementById('bibPanelCategorias');

  if (tab === 'contenidos') {
    tabCont.classList.add('active');
    tabCat.classList.remove('active');
    panCont.style.display = 'block';
    panCat.style.display = 'none';
  } else {
    tabCont.classList.remove('active');
    tabCat.classList.add('active');
    panCont.style.display = 'none';
    panCat.style.display = 'block';
  }
}

function renderBibAdminLista() {
  const cont = document.getElementById('bibAdminLista');
  if (BIB_CONTENIDOS.length === 0) {
    cont.innerHTML = `
      <div class="bib-empty">
        <i class="ti ti-files-off"></i>
        <div class="bib-empty-title">No hay contenidos cargados</div>
        <div class="bib-empty-desc">Tocá "Agregar contenido" para sumar el primero.</div>
      </div>`;
    return;
  }

  let html = '';
  BIB_CONTENIDOS.forEach(c => {
    const tipo = BIB_TIPOS.find(t => t.key === c.tipo) || BIB_TIPOS[0];
    const cat = BIB_CATEGORIAS.find(k => k.id === c.categoria_id);
    const locTxt = (!c.locales || c.locales.length === 0)
      ? 'Sin locales'
      : (c.locales.length === getLocalesActivos().length
          ? 'Todos los locales'
          : c.locales.length + ' local' + (c.locales.length > 1 ? 'es' : ''));

    const btnDelete = puedeAdminBibCat()
      ? `<button class="bib-btn-delete" onclick="borrarContenido(${c.id})" title="Borrar"><i class="ti ti-trash"></i></button>`
      : '';

    html += `
      <div class="bib-admin-item">
        <div class="bib-admin-item-icon ${tipo.cls}"><i class="ti ${tipo.icon}"></i></div>
        <div class="bib-admin-item-info">
          <div class="bib-admin-item-titulo">${esc(c.titulo)}</div>
          <div class="bib-admin-item-meta">${esc(cat ? cat.nombre : 'Sin categoría')} · ${locTxt}</div>
        </div>
        <div class="bib-admin-item-actions">
          <button class="bib-btn-edit" onclick="openModalContenido(${c.id})" title="Editar"><i class="ti ti-edit"></i></button>
          ${btnDelete}
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

function renderBibAdminCategorias() {
  const cont = document.getElementById('bibAdminCategorias');
  if (BIB_CATEGORIAS.length === 0) {
    cont.innerHTML = `
      <div class="bib-empty">
        <i class="ti ti-folder-off"></i>
        <div class="bib-empty-title">No hay categorías</div>
        <div class="bib-empty-desc">Creá la primera categoría para empezar a organizar el contenido.</div>
      </div>`;
    return;
  }

  let html = '';
  BIB_CATEGORIAS.forEach(cat => {
    const count = BIB_CONTENIDOS.filter(c => c.categoria_id === cat.id).length;
    html += `
      <div class="bib-cat-item">
        <div class="bib-cat-icon-box"><i class="ti ${esc(cat.icono || 'ti-folder')}"></i></div>
        <div class="bib-cat-nombre">${esc(cat.nombre)}</div>
        <div class="bib-cat-count">${count} contenido${count !== 1 ? 's' : ''}</div>
        <div class="bib-admin-item-actions">
          <button class="bib-btn-edit" onclick="openModalCategoria(${cat.id})" title="Editar"><i class="ti ti-edit"></i></button>
          <button class="bib-btn-delete" onclick="borrarCategoria(${cat.id})" title="Borrar"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

// ============================================
// MODAL: AGREGAR / EDITAR CONTENIDO
// ============================================
function openModalContenido(contId) {
  BIB_EDITANDO_CONT = contId;
  const c = contId ? BIB_CONTENIDOS.find(x => x.id === contId) : null;

  document.getElementById('modalContenidoTitle').textContent = c ? 'Editar contenido' : 'Nuevo contenido';
  document.getElementById('contTitulo').value = c ? c.titulo : '';
  document.getElementById('contUrl').value = c ? c.url : '';

  // Categorías
  const selectCat = document.getElementById('contCategoria');
  selectCat.innerHTML = BIB_CATEGORIAS.map(cat =>
    `<option value="${cat.id}">${esc(cat.nombre)}</option>`
  ).join('');
  if (c) selectCat.value = c.categoria_id;
  else if (BIB_CATEGORIAS.length) selectCat.value = BIB_CATEGORIAS[0].id;

  // Tipo
  BIB_TIPO_SEL = c ? c.tipo : 'pdf';
  renderTipoGrid();
  actualizarHintUrl();

  // Locales
  BIB_LOCALES_SEL = c && c.locales ? c.locales.slice() : [];
  renderLocalesChips();

  document.getElementById('modalContenido').style.display = 'flex';
}

function closeModalContenido() {
  document.getElementById('modalContenido').style.display = 'none';
  BIB_EDITANDO_CONT = null;
}

function renderTipoGrid() {
  const cont = document.getElementById('contTipoGrid');
  cont.innerHTML = BIB_TIPOS.map(t => `
    <button class="tipo-btn ${BIB_TIPO_SEL === t.key ? 'active' : ''}" onclick="selectTipo('${t.key}')">
      <i class="ti ${t.icon}"></i>${t.label}
    </button>
  `).join('');
}

function selectTipo(key) {
  BIB_TIPO_SEL = key;
  renderTipoGrid();
  actualizarHintUrl();
}

function actualizarHintUrl() {
  const hint = document.getElementById('contUrlHint');
  const placeholders = {
    pdf:   'Ej: link de Google Drive, Dropbox o cualquier PDF online',
    doc:   'Ej: link de Google Docs, Word online o similar',
    video: 'Ej: link de YouTube o Vimeo',
    audio: 'Ej: link de Spotify, Apple Podcasts, etc.'
  };
  hint.textContent = placeholders[BIB_TIPO_SEL] || 'Pegá el link completo';
}

function renderLocalesChips() {
  const cont = document.getElementById('contLocales');
  cont.innerHTML = getLocalesActivos().map(loc => {
    const activo = BIB_LOCALES_SEL.includes(loc);
    return `<button class="loc-chip ${activo ? 'active' : ''}" onclick="toggleLocalChip('${loc}')">
      ${activo ? '<i class="ti ti-check"></i>' : ''}${esc(LOCAL_LABELS[loc] || loc)}
    </button>`;
  }).join('');
}

function toggleLocalChip(loc) {
  const idx = BIB_LOCALES_SEL.indexOf(loc);
  if (idx >= 0) BIB_LOCALES_SEL.splice(idx, 1);
  else BIB_LOCALES_SEL.push(loc);
  renderLocalesChips();
}

async function guardarContenido() {
  const titulo = document.getElementById('contTitulo').value.trim();
  const url = document.getElementById('contUrl').value.trim();
  const categoria_id = parseInt(document.getElementById('contCategoria').value, 10);

  if (!titulo) { toast('Falta el título', 'error'); return; }
  if (!url) { toast('Falta el link', 'error'); return; }
  if (!/^https?:\/\//i.test(url)) { toast('El link debe empezar con http:// o https://', 'error'); return; }
  if (!categoria_id) { toast('Elegí una categoría', 'error'); return; }
  if (BIB_LOCALES_SEL.length === 0) { toast('Elegí al menos un local', 'error'); return; }

  const btn = document.getElementById('btnGuardarContenido');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const body = {
    titulo,
    categoria_id,
    tipo: BIB_TIPO_SEL,
    url,
    locales: BIB_LOCALES_SEL,
    actualizado_en: new Date().toISOString()
  };

  try {
    if (BIB_EDITANDO_CONT) {
      // UPDATE
      await api(`biblioteca_contenidos?id=eq.${BIB_EDITANDO_CONT}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      toast('Contenido actualizado');
    } else {
      // INSERT
      body.creado_por = currentUser.id;
      await api('biblioteca_contenidos', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast('Contenido agregado');
    }
    closeModalContenido();
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

async function borrarContenido(id) {
  const c = BIB_CONTENIDOS.find(x => x.id === id);
  if (!c) return;
  const ok = await showConfirm({
    title: '¿Borrar contenido?',
    msg: `Vas a eliminar "${c.titulo}".\n\nEsta acción no se puede deshacer.`,
    type: 'danger',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    // Soft delete
    await api(`biblioteca_contenidos?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: false, actualizado_en: new Date().toISOString() })
    });
    toast('Contenido borrado');
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// ============================================
// MODAL: AGREGAR / EDITAR CATEGORÍA
// ============================================
function openModalCategoria(catId) {
  if (!puedeAdminBibCat()) return;
  BIB_EDITANDO_CAT = catId;
  const c = catId ? BIB_CATEGORIAS.find(x => x.id === catId) : null;

  document.getElementById('modalCategoriaTitle').textContent = c ? 'Editar categoría' : 'Nueva categoría';
  document.getElementById('catNombre').value = c ? c.nombre : '';

  BIB_ICONO_SEL = c ? (c.icono || 'ti-folder') : 'ti-folder';
  renderIconPicker();

  document.getElementById('modalCategoria').style.display = 'flex';
}

function closeModalCategoria() {
  document.getElementById('modalCategoria').style.display = 'none';
  BIB_EDITANDO_CAT = null;
}

function renderIconPicker() {
  const cont = document.getElementById('catIconPicker');
  cont.innerHTML = BIB_ICONOS_CAT.map(ic => `
    <div class="icon-opt ${BIB_ICONO_SEL === ic ? 'active' : ''}" onclick="selectIcono('${ic}')">
      <i class="ti ${ic}"></i>
    </div>
  `).join('');
}

function selectIcono(ic) {
  BIB_ICONO_SEL = ic;
  renderIconPicker();
}

async function guardarCategoria() {
  const nombre = document.getElementById('catNombre').value.trim();
  if (!nombre) { toast('Falta el nombre', 'error'); return; }

  const btn = document.getElementById('btnGuardarCategoria');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const body = { nombre, icono: BIB_ICONO_SEL };

  try {
    if (BIB_EDITANDO_CAT) {
      await api(`biblioteca_categorias?id=eq.${BIB_EDITANDO_CAT}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      toast('Categoría actualizada');
    } else {
      // Orden = el siguiente al máximo actual
      const maxOrden = BIB_CATEGORIAS.reduce((m, c) => Math.max(m, c.orden || 0), 0);
      body.orden = maxOrden + 1;
      await api('biblioteca_categorias', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast('Categoría creada');
    }
    closeModalCategoria();
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

async function borrarCategoria(id) {
  const cat = BIB_CATEGORIAS.find(c => c.id === id);
  if (!cat) return;

  const contCount = BIB_CONTENIDOS.filter(c => c.categoria_id === id).length;
  if (contCount > 0) {
    await showAlert({
      title: 'No se puede borrar',
      msg: `La categoría "${cat.nombre}" tiene ${contCount} contenido(s) asignado(s).\n\nMové o borrá esos contenidos primero.`,
      type: 'warning',
      okLabel: 'Entendido'
    });
    return;
  }

  const ok = await showConfirm({
    title: '¿Borrar categoría?',
    msg: `Vas a eliminar la categoría "${cat.nombre}".\n\nEsta acción no se puede deshacer.`,
    type: 'danger',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    await api(`biblioteca_categorias?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: false })
    });
    toast('Categoría borrada');
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// Exponer funciones globalmente (para onclick desde HTML)
window.openMiBiblioteca = openMiBiblioteca;
window.openAdminBiblioteca = openAdminBiblioteca;
window.filtrarBibCat = filtrarBibCat;
window.switchBibTab = switchBibTab;
window.openModalContenido = openModalContenido;
window.closeModalContenido = closeModalContenido;
window.selectTipo = selectTipo;
window.toggleLocalChip = toggleLocalChip;
window.guardarContenido = guardarContenido;
window.borrarContenido = borrarContenido;
window.openModalCategoria = openModalCategoria;
window.closeModalCategoria = closeModalCategoria;
window.selectIcono = selectIcono;
window.guardarCategoria = guardarCategoria;
window.borrarCategoria = borrarCategoria;

// ============================================
// ADMIN: GESTIÓN DE LOCALES
// ============================================

let LOCAL_EDITANDO = null;   // slug del local que se está editando
let LOCAL_ACTIVO_SEL = true; // estado seleccionado en el modal

async function openAdminLocales() {
  if (!isMaster()) {
    toast('Solo Master puede gestionar locales', 'error');
    showDashboard();
    return;
  }
  showView('vAdminLocales');
  await recargarLocalesAdmin();
}

async function recargarLocalesAdmin() {
  // Refrescar caché en memoria
  await cargarLocalesDesdeBase();
  renderLocalesAdmin();
}

function renderLocalesAdmin() {
  const cont = document.getElementById('localesAdminLista');
  const count = document.getElementById('localesAdminCount');

  const activos = LOCALES_DB.filter(l => l.activo).length;
  count.textContent = `${activos} activo${activos !== 1 ? 's' : ''} de ${LOCALES_DB.length}`;

  if (LOCALES_DB.length === 0) {
    cont.innerHTML = `<div class="bib-empty">
      <i class="ti ti-building-skyscraper"></i>
      <div class="bib-empty-title">No hay locales cargados</div>
      <div class="bib-empty-desc">Algo raro pasó con la base. Avisá al equipo técnico.</div>
    </div>`;
    return;
  }

  let html = '';
  LOCALES_DB.forEach(l => {
    const cls = 'local-admin-item' + (l.activo ? '' : ' inactivo');
    const badgeCls = l.activo ? 'activo' : 'inactivo';
    const badgeTxt = l.activo ? 'Activo' : 'Oculto';
    const icon = l.activo ? 'ti-building-store' : 'ti-building-store';
    html += `
      <div class="${cls}">
        <div class="local-admin-item-icon"><i class="ti ${icon}"></i></div>
        <div class="local-admin-item-info">
          <div class="local-admin-item-nombre">
            ${esc(l.nombre)}
            <span class="local-badge ${badgeCls}">${badgeTxt}</span>
          </div>
          <div class="local-admin-item-slug">${esc(l.slug)}</div>
        </div>
        <div class="bib-admin-item-actions">
          <button class="bib-btn-edit" onclick="openModalLocal('${esc(l.slug).replace(/'/g, "\\'")}')" title="Editar">
            <i class="ti ti-edit"></i>
          </button>
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

function openModalLocal(slug) {
  const l = LOCALES_DB.find(x => x.slug === slug);
  if (!l) { toast('Local no encontrado', 'error'); return; }

  LOCAL_EDITANDO = slug;
  LOCAL_ACTIVO_SEL = l.activo;

  document.getElementById('localSlug').value = l.slug;
  document.getElementById('localNombre').value = l.nombre;
  actualizarToggleLocal();
  document.getElementById('modalLocal').style.display = 'flex';
}

function closeModalLocal() {
  document.getElementById('modalLocal').style.display = 'none';
  LOCAL_EDITANDO = null;
}

function setLocalActivo(val) {
  LOCAL_ACTIVO_SEL = val;
  actualizarToggleLocal();
}

function actualizarToggleLocal() {
  const btnAct = document.getElementById('localToggleActivo');
  const btnIna = document.getElementById('localToggleInactivo');
  const hint = document.getElementById('localEstadoHint');

  btnAct.classList.toggle('active', LOCAL_ACTIVO_SEL);
  btnIna.classList.toggle('active-off', !LOCAL_ACTIVO_SEL);

  hint.textContent = LOCAL_ACTIVO_SEL
    ? 'Cuando está activo, aparece en toda la app.'
    : 'Oculto: no aparece en ningún selector de la app.';
}

async function guardarLocal() {
  if (!LOCAL_EDITANDO) return;
  const nombre = document.getElementById('localNombre').value.trim();
  if (!nombre) { toast('Falta el nombre', 'error'); return; }

  const btn = document.getElementById('btnGuardarLocal');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    await api(`locales?slug=eq.${encodeURIComponent(LOCAL_EDITANDO)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        nombre,
        activo: LOCAL_ACTIVO_SEL,
        actualizado_en: new Date().toISOString()
      })
    });
    toast('Local actualizado');
    closeModalLocal();
    await recargarLocalesAdmin();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

// Exponer funciones globalmente
window.openAdminLocales = openAdminLocales;
window.openModalLocal = openModalLocal;
window.closeModalLocal = closeModalLocal;
window.setLocalActivo = setLocalActivo;
window.guardarLocal = guardarLocal;

// ============================================
// ADMIN: INSUMOS (catálogo de ingredientes)
// ============================================

let INSUMOS_DB = [];          // cache completo de insumos cargados
let INSUMOS_FILTRO_TEXTO = '';
let INSUMOS_FILTRO_SUBFAMILIA = '';
let INSUMOS_FILTRO_PROVEEDOR = '';
let INSUMOS_FILTRO_ESTADO = '';
let INSUMOS_PAGE = 0;
const INSUMOS_PAGE_SIZE = 30;
let INSUMO_EDITANDO = null;   // null = nuevo, o id del insumo
let INSUMOS_SUBFAMILIAS_CACHE = []; // subfamilias únicas del catálogo
let INSUMOS_PROVEEDORES_CACHE = []; // proveedores únicos del catálogo
let INSUMOS_BUSCAR_TIMEOUT = null;

// ¿Quién puede gestionar insumos?
function puedeGestionarInsumos() {
  return isMaster() || isAdmin();
}

async function openAdminInsumos() {
  if (!puedeGestionarInsumos()) {
    toast('Solo Master/Admin puede gestionar insumos', 'error');
    showDashboard();
    return;
  }

  showView('vAdminInsumos');

  // Reset filtros si es primera vez
  document.getElementById('insumoBuscar').value = INSUMOS_FILTRO_TEXTO;
  document.getElementById('insumoEstado').value = INSUMOS_FILTRO_ESTADO;

  document.getElementById('insumosLista').innerHTML = '<div class="loading">Cargando insumos...</div>';
  document.getElementById('insumosCount').textContent = 'Cargando...';

  await cargarInsumos();
  await cargarSubfamiliasUnicas();
  renderInsumosLista();
}

// Carga TODOS los insumos activos (con paginación local después)
async function cargarInsumos() {
  try {
    // En lugar de traer 7295, traemos los activos (1015)
    // Si llega a ser lento, podemos hacer paginación server-side
    const data = await api('ingredientes?activo=eq.true&order=nombre.asc');
    INSUMOS_DB = data || [];
  } catch (e) {
    console.error('Error cargando insumos:', e);
    document.getElementById('insumosLista').innerHTML =
      '<div class="loading" style="color:var(--c-error)">Error al cargar insumos</div>';
    INSUMOS_DB = [];
  }
}

async function cargarOpcionesUnicas() {
  // Subfamilias únicas
  const subsUnicas = [...new Set(INSUMOS_DB.map(i => i.subfamilia).filter(Boolean))].sort();
  INSUMOS_SUBFAMILIAS_CACHE = subsUnicas;

  // Proveedores únicos
  const provsUnicos = [...new Set(INSUMOS_DB.map(i => i.proveedor).filter(Boolean))].sort();
  INSUMOS_PROVEEDORES_CACHE = provsUnicos;

  // Llenar datalist del filtro de subfamilia
  const dataListFiltro = document.getElementById('insumoSubfamiliaList');
  if (dataListFiltro) {
    dataListFiltro.innerHTML = subsUnicas.map(s => `<option value="${esc(s)}">`).join('');
  }

  // Llenar datalist del filtro de proveedor
  const dataListProvFiltro = document.getElementById('insumoProveedorList');
  if (dataListProvFiltro) {
    dataListProvFiltro.innerHTML = provsUnicos.map(p => `<option value="${esc(p)}">`).join('');
  }
}

// Mantener nombre viejo por compatibilidad
async function cargarSubfamiliasUnicas() {
  return cargarOpcionesUnicas();
}

function insumosFiltrados() {
  const txt = INSUMOS_FILTRO_TEXTO.toLowerCase().trim();
  // Normalizamos para tolerancia a tildes y mayúsculas
  const norm = s => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const txtN = norm(txt);

  return INSUMOS_DB.filter(i => {
    // Filtro estado
    if (INSUMOS_FILTRO_ESTADO === 'validado' && !i.validado) return false;
    if (INSUMOS_FILTRO_ESTADO === 'pendiente' && i.validado) return false;
    // Filtro subfamilia (búsqueda parcial, tolerante a tildes)
    if (INSUMOS_FILTRO_SUBFAMILIA) {
      const filtroN = norm(INSUMOS_FILTRO_SUBFAMILIA);
      const subN = norm(i.subfamilia);
      if (!subN.includes(filtroN)) return false;
    }
    // Filtro proveedor (búsqueda parcial, tolerante a tildes)
    if (INSUMOS_FILTRO_PROVEEDOR) {
      const filtroN = norm(INSUMOS_FILTRO_PROVEEDOR);
      const provN = norm(i.proveedor);
      if (!provN.includes(filtroN)) return false;
    }
    // Filtro texto (en nombre o proveedor)
    if (txtN) {
      const enNombre = norm(i.nombre).includes(txtN);
      const enProveedor = norm(i.proveedor).includes(txtN);
      if (!enNombre && !enProveedor) return false;
    }
    return true;
  });
}

function renderInsumosLista() {
  const cont = document.getElementById('insumosLista');
  const countEl = document.getElementById('insumosCount');
  const filtrados = insumosFiltrados();

  countEl.textContent = filtrados.length === INSUMOS_DB.length
    ? `${INSUMOS_DB.length} insumos`
    : `${filtrados.length} de ${INSUMOS_DB.length} insumos`;

  if (filtrados.length === 0) {
    cont.innerHTML = `
      <div class="bib-empty">
        <i class="ti ti-package-off"></i>
        <div class="bib-empty-title">No hay insumos para mostrar</div>
        <div class="bib-empty-desc">Ajustá los filtros o agregá un insumo nuevo.</div>
      </div>`;
    document.getElementById('insumosPager').innerHTML = '';
    return;
  }

  // Paginar localmente
  const totalPages = Math.ceil(filtrados.length / INSUMOS_PAGE_SIZE);
  if (INSUMOS_PAGE >= totalPages) INSUMOS_PAGE = 0;
  const desde = INSUMOS_PAGE * INSUMOS_PAGE_SIZE;
  const hasta = desde + INSUMOS_PAGE_SIZE;
  const pageItems = filtrados.slice(desde, hasta);

  let html = '';
  pageItems.forEach(i => {
    const cls = 'insumo-card ' + (i.validado ? 'validado' : 'pendiente');
    const badgeCls = i.validado ? 'validado' : 'pendiente';
    const badgeTxt = i.validado ? '✓ Validado' : '⏳ Pendiente';

    const costoBase = costoUnitarioInsumo(i);
    const costoEnvase = parseFloat(i.costo || 0);
    const cantidad = parseFloat(i.cantidad_por_presentacion || 0);
    const unidad = i.unidad || '';

    html += `
      <div class="${cls}">
        <div class="insumo-icon"><i class="ti ti-package"></i></div>
        <div class="insumo-info">
          <div class="insumo-top">
            <div class="insumo-nombre">${esc(i.nombre)}</div>
            <span class="insumo-badge ${badgeCls}">${badgeTxt}</span>
          </div>
          <div class="insumo-meta">
            ${i.formato ? `<strong>${esc(i.formato)}</strong>` : '<em style="color:#888780">(sin formato)</em>'}
            ${i.proveedor ? ` · ${esc(i.proveedor)}` : ''}
          </div>
          <div class="insumo-precio">
            ${costoEnvase > 0 ? `<span>Envase: <span class="insumo-precio-monto">$${formatNumber(costoEnvase)}</span></span>` : ''}
            ${cantidad > 0 ? `<span>${formatNumber(cantidad)} ${esc(unidad)}</span>` : ''}
            ${costoBase > 0 ? `<span>· <span class="insumo-precio-monto">$${formatNumber(costoBase)}/${esc(unidad)}</span></span>` : ''}
          </div>
          ${i.subfamilia ? `<div class="insumo-meta" style="margin-top:6px"><i class="ti ti-tag" style="font-size:11px;vertical-align:-1px"></i> ${esc(i.subfamilia)}</div>` : ''}
        </div>
        <div class="insumo-actions">
          <button class="bib-btn-edit" onclick="openModalInsumo(${i.id})" title="Editar">
            <i class="ti ti-edit"></i>
          </button>
          <button class="bib-btn-delete" onclick="borrarInsumo(${i.id})" title="Borrar">
            <i class="ti ti-trash"></i>
          </button>
        </div>
      </div>`;
  });
  cont.innerHTML = html;

  renderPagerInsumos(filtrados.length, totalPages);
}

function renderPagerInsumos(total, totalPages) {
  const pag = document.getElementById('insumosPager');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  let html = '';
  // Botón anterior
  html += `<button class="pager-btn" onclick="irPaginaInsumo(${INSUMOS_PAGE - 1})" ${INSUMOS_PAGE === 0 ? 'disabled' : ''}><i class="ti ti-chevron-left"></i></button>`;

  // Info "Página X de Y"
  html += `<span class="pager-info">Página ${INSUMOS_PAGE + 1} de ${totalPages}</span>`;

  // Botón siguiente
  html += `<button class="pager-btn" onclick="irPaginaInsumo(${INSUMOS_PAGE + 1})" ${INSUMOS_PAGE === totalPages - 1 ? 'disabled' : ''}><i class="ti ti-chevron-right"></i></button>`;

  pag.innerHTML = html;
}

function irPaginaInsumo(p) {
  INSUMOS_PAGE = p;
  renderInsumosLista();
  // Scroll al top
  document.getElementById('vAdminInsumos').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Calcula costo por unidad base
function costoUnitarioInsumo(ins) {
  const costo = parseFloat(ins.costo || 0);
  const cant = parseFloat(ins.cantidad_por_presentacion || 0);
  if (!costo || !cant) return 0;
  return costo / cant;
}

// Buscador con debounce
function onBuscarInsumo() {
  if (INSUMOS_BUSCAR_TIMEOUT) clearTimeout(INSUMOS_BUSCAR_TIMEOUT);
  INSUMOS_BUSCAR_TIMEOUT = setTimeout(() => {
    INSUMOS_FILTRO_TEXTO = document.getElementById('insumoBuscar').value;
    INSUMOS_PAGE = 0;
    renderInsumosLista();
  }, 250);
}

function onFiltroInsumo() {
  if (INSUMOS_BUSCAR_TIMEOUT) clearTimeout(INSUMOS_BUSCAR_TIMEOUT);
  INSUMOS_BUSCAR_TIMEOUT = setTimeout(() => {
    INSUMOS_FILTRO_SUBFAMILIA = document.getElementById('insumoSubfamilia').value;
    INSUMOS_FILTRO_PROVEEDOR  = document.getElementById('insumoProveedor').value;
    INSUMOS_FILTRO_ESTADO     = document.getElementById('insumoEstado').value;
    INSUMOS_PAGE = 0;
    renderInsumosLista();
  }, 200);
}

// ============================================
// MODAL: CREAR / EDITAR INSUMO
// ============================================
function openModalInsumo(id) {
  INSUMO_EDITANDO = id;
  const ins = id ? INSUMOS_DB.find(x => x.id === id) : null;

  document.getElementById('modalInsumoTitle').textContent = ins ? 'Editar insumo' : 'Nuevo insumo';

  document.getElementById('insNombre').value = ins ? (ins.nombre || '') : '';
  document.getElementById('insFormato').value = ins ? (ins.formato || '') : '';
  document.getElementById('insUnidad').value = ins ? (ins.unidad || 'kg') : 'kg';
  document.getElementById('insCantidad').value = ins ? (ins.cantidad_por_presentacion || '') : '1';
  document.getElementById('insCosto').value = ins ? (ins.costo || '') : '';
  document.getElementById('insProveedor').value = ins ? (ins.proveedor || '') : '';
  document.getElementById('insCodigo').value = ins ? (ins.codigo_hiopos || '') : '';

  // Subfamilias en el datalist
  const dataList = document.getElementById('insSubfamiliaList');
  dataList.innerHTML = INSUMOS_SUBFAMILIAS_CACHE
    .map(s => `<option value="${esc(s)}">`)
    .join('');
  document.getElementById('insSubfamilia').value = ins && ins.subfamilia ? ins.subfamilia : '';

  // Proveedores en el datalist
  const dataListProv = document.getElementById('insProveedorList');
  if (dataListProv) {
    dataListProv.innerHTML = INSUMOS_PROVEEDORES_CACHE
      .map(p => `<option value="${esc(p)}">`)
      .join('');
  }

  // Calcular costo unidad inicial
  actualizarCostoUnidad();

  // Si está validado, el botón "Validar" muestra "Re-validar"
  const btnVal = document.getElementById('btnInsumoValidar');
  if (ins && ins.validado) {
    btnVal.innerHTML = '✓ Guardar como validado';
  } else {
    btnVal.innerHTML = '✓ Validar';
  }

  // Listeners para recalcular costo en vivo
  document.getElementById('insCosto').oninput = actualizarCostoUnidad;
  document.getElementById('insCantidad').oninput = actualizarCostoUnidad;

  document.getElementById('modalInsumo').style.display = 'flex';
}

function closeModalInsumo() {
  document.getElementById('modalInsumo').style.display = 'none';
  INSUMO_EDITANDO = null;
}

function actualizarCostoUnidad() {
  const costo = parseFloat(document.getElementById('insCosto').value) || 0;
  const cant = parseFloat(document.getElementById('insCantidad').value) || 0;
  const unidad = document.getElementById('insUnidad').value || '';
  const box = document.getElementById('insCostoUnidad');
  if (costo > 0 && cant > 0) {
    box.value = `$${formatNumber(costo / cant)} / ${unidad}`;
  } else {
    box.value = '';
  }
}

async function guardarInsumo(validar) {
  const nombre = document.getElementById('insNombre').value.trim();
  const formato = document.getElementById('insFormato').value.trim();
  const unidad = document.getElementById('insUnidad').value;
  const cantidad = parseFloat(document.getElementById('insCantidad').value);
  const costo = parseFloat(document.getElementById('insCosto').value);
  const proveedor = document.getElementById('insProveedor').value.trim();
  const codigo = document.getElementById('insCodigo').value.trim();
  const subfamilia = document.getElementById('insSubfamilia').value;

  if (!nombre) { toast('Falta el nombre', 'error'); return; }
  if (!unidad) { toast('Falta la unidad base', 'error'); return; }
  if (isNaN(cantidad) || cantidad <= 0) { toast('Cantidad por envase inválida', 'error'); return; }
  if (isNaN(costo) || costo < 0) { toast('Costo inválido', 'error'); return; }

  const btnVal = document.getElementById('btnInsumoValidar');
  const btnSin = document.getElementById('btnInsumoSinValidar');
  btnVal.disabled = true;
  btnSin.disabled = true;

  const body = {
    nombre,
    formato: formato || null,
    unidad,
    cantidad_por_presentacion: cantidad,
    costo,
    proveedor: proveedor || null,
    codigo_hiopos: codigo || null,
    subfamilia: subfamilia || null,
    familia: 'INSUMOS',
    activo: true,
    validado: validar,
    actualizado_en: new Date().toISOString()
  };
  if (validar) {
    body.validado_por = currentUser.id;
    body.validado_en = new Date().toISOString();
  }

  try {
    if (INSUMO_EDITANDO) {
      await api(`ingredientes?id=eq.${INSUMO_EDITANDO}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      toast(validar ? '✓ Validado — disponible para cocina' : 'Guardado sin validar');
    } else {
      // Insumo nuevo
      await api('ingredientes', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast(validar ? '✓ Insumo creado y validado' : 'Insumo creado sin validar');
    }
    closeModalInsumo();
    // Recargar lista
    await cargarInsumos();
    await cargarSubfamiliasUnicas();
    renderInsumosLista();
  } catch (e) {
    toast('Error al guardar', 'error');
    console.error(e);
  } finally {
    btnVal.disabled = false;
    btnSin.disabled = false;
  }
}

async function borrarInsumo(id) {
  const ins = INSUMOS_DB.find(x => x.id === id);
  if (!ins) return;

  // Antes de borrar, chequear si está siendo usado en alguna receta
  try {
    const usos = await api(`receta_componentes?ingrediente_id=eq.${id}&select=receta_id&limit=1`);
    if (usos && usos.length > 0) {
      await showAlert({
        title: 'No se puede borrar',
        msg: `El insumo "${ins.nombre}" está siendo usado en al menos una receta. Primero quitalo de las recetas que lo usan.`,
        type: 'warning',
        okLabel: 'Entendido'
      });
      return;
    }
  } catch (e) {
    console.warn('No se pudo verificar uso del insumo:', e);
  }

  const ok = await showConfirm({
    title: '¿Borrar insumo?',
    msg: `Vas a eliminar "${ins.nombre}".\n\nNo se puede deshacer.`,
    type: 'danger',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    // Soft delete
    await api(`ingredientes?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: false, actualizado_en: new Date().toISOString() })
    });
    toast('Insumo borrado');
    await cargarInsumos();
    renderInsumosLista();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// ============================================
// GESTIÓN DE SUBFAMILIAS
// ============================================

let SUBFAM_RENOMBRANDO = null; // subfamilia original que se está renombrando

function openGestionSubfamilias() {
  if (!puedeGestionarInsumos()) return;
  renderSubfamilias();
  document.getElementById('modalSubfamilias').style.display = 'flex';
}

function closeGestionSubfamilias() {
  document.getElementById('modalSubfamilias').style.display = 'none';
}

function renderSubfamilias() {
  const cont = document.getElementById('subfamiliasLista');

  // Calcular cantidad de insumos por subfamilia
  const counts = {};
  INSUMOS_DB.forEach(i => {
    const s = i.subfamilia || '(sin subfamilia)';
    counts[s] = (counts[s] || 0) + 1;
  });
  const subs = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

  if (subs.length === 0) {
    cont.innerHTML = '<div class="bib-empty"><i class="ti ti-tags-off"></i><div class="bib-empty-title">No hay subfamilias</div></div>';
    return;
  }

  let html = '';
  subs.forEach(s => {
    const esSinSubfam = (s === '(sin subfamilia)');
    const safeName = esc(s).replace(/'/g, "\\'");
    const accionRenombrar = esSinSubfam ? '' : `
      <button class="bib-btn-edit" onclick="openRenombrarSubfam('${safeName}')" title="Renombrar o fusionar">
        <i class="ti ti-edit"></i>
      </button>`;
    const accionBorrar = esSinSubfam ? '' : `
      <button class="bib-btn-delete" onclick="borrarSubfamilia('${safeName}')" title="Borrar (insumos quedan sin subfamilia)">
        <i class="ti ti-trash"></i>
      </button>`;

    html += `
      <div class="subfam-row">
        <div class="subfam-icon-box"><i class="ti ti-tag"></i></div>
        <div class="subfam-info">
          <div class="subfam-nombre">${esc(s)}</div>
          <div class="subfam-count">${counts[s]} insumo${counts[s] !== 1 ? 's' : ''}</div>
        </div>
        <div class="subfam-actions">
          ${accionRenombrar}
          ${accionBorrar}
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

function openRenombrarSubfam(nombreOriginal) {
  SUBFAM_RENOMBRANDO = nombreOriginal;

  const count = INSUMOS_DB.filter(i => i.subfamilia === nombreOriginal).length;

  document.getElementById('subfamOriginal').value = nombreOriginal;
  document.getElementById('subfamNuevo').value = nombreOriginal;
  document.getElementById('subfamCount').textContent =
    `Se actualizarán ${count} insumo${count !== 1 ? 's' : ''}.`;

  // Listener para detectar si se va a fusionar
  const hint = document.getElementById('subfamHint');
  const updateHint = () => {
    const nuevo = document.getElementById('subfamNuevo').value.trim();
    if (!nuevo || nuevo === nombreOriginal) {
      hint.textContent = 'Si el nuevo nombre ya existe, las subfamilias se fusionan.';
      hint.style.color = '';
    } else if (INSUMOS_SUBFAMILIAS_CACHE.includes(nuevo)) {
      hint.textContent = `⚠ "${nuevo}" ya existe. Se fusionarán las dos.`;
      hint.style.color = '#EF9F27';
    } else {
      hint.textContent = `Se renombra "${nombreOriginal}" → "${nuevo}".`;
      hint.style.color = '#5DCAA5';
    }
  };
  document.getElementById('subfamNuevo').oninput = updateHint;
  updateHint();

  document.getElementById('modalRenombrarSubfam').style.display = 'flex';
}

function closeRenombrarSubfam() {
  document.getElementById('modalRenombrarSubfam').style.display = 'none';
  SUBFAM_RENOMBRANDO = null;
}

async function guardarRenombrarSubfam() {
  if (!SUBFAM_RENOMBRANDO) return;
  const nuevo = document.getElementById('subfamNuevo').value.trim();

  if (!nuevo) { toast('Falta el nombre nuevo', 'error'); return; }
  if (nuevo === SUBFAM_RENOMBRANDO) { toast('El nombre no cambió', 'warning'); return; }

  const yaExiste = INSUMOS_SUBFAMILIAS_CACHE.includes(nuevo);
  const accion = yaExiste ? 'fusionar' : 'renombrar';
  const count = INSUMOS_DB.filter(i => i.subfamilia === SUBFAM_RENOMBRANDO).length;

  const ok = await showConfirm({
    title: yaExiste ? `¿Fusionar subfamilias?` : `¿Renombrar subfamilia?`,
    msg: yaExiste
      ? `Vas a fusionar "${SUBFAM_RENOMBRANDO}" con "${nuevo}".\n\n${count} insumo(s) pasarán a "${nuevo}".`
      : `Vas a renombrar "${SUBFAM_RENOMBRANDO}" a "${nuevo}".\n\nAfecta a ${count} insumo(s).`,
    type: yaExiste ? 'warning' : 'info',
    okLabel: yaExiste ? 'Fusionar' : 'Renombrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  const btn = document.getElementById('btnRenombrarSubfam');
  btn.disabled = true;
  btn.textContent = 'Aplicando...';

  try {
    // UPDATE masivo en ingredientes
    await api(`ingredientes?subfamilia=eq.${encodeURIComponent(SUBFAM_RENOMBRANDO)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        subfamilia: nuevo,
        actualizado_en: new Date().toISOString()
      })
    });

    toast(yaExiste ? `Subfamilias fusionadas (${count} insumos)` : `Renombrada (${count} insumos)`);
    closeRenombrarSubfam();

    // Recargar y refrescar UI
    await cargarInsumos();
    await cargarSubfamiliasUnicas();
    renderInsumosLista();
    renderSubfamilias();
  } catch (e) {
    toast('Error al actualizar', 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Aplicar';
  }
}

async function borrarSubfamilia(nombre) {
  const count = INSUMOS_DB.filter(i => i.subfamilia === nombre).length;

  const ok = await showConfirm({
    title: '¿Borrar subfamilia?',
    msg: `Vas a borrar la subfamilia "${nombre}".\n\nLos ${count} insumo(s) asociados quedarán sin subfamilia (no se borran).`,
    type: 'warning',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    await api(`ingredientes?subfamilia=eq.${encodeURIComponent(nombre)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        subfamilia: null,
        actualizado_en: new Date().toISOString()
      })
    });

    toast(`Subfamilia eliminada (${count} insumos sin subfamilia)`);

    await cargarInsumos();
    await cargarSubfamiliasUnicas();
    renderInsumosLista();
    renderSubfamilias();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// ============================================
// MENÚ DE GESTIÓN (subfamilias / proveedores)
// ============================================

function openMenuGestion() {
  if (!puedeGestionarInsumos()) return;
  document.getElementById('modalMenuGestion').style.display = 'flex';
}

function closeMenuGestion() {
  document.getElementById('modalMenuGestion').style.display = 'none';
}

// ============================================
// GESTIÓN DE PROVEEDORES
// ============================================

let PROV_RENOMBRANDO = null;

function openGestionProveedores() {
  if (!puedeGestionarInsumos()) return;
  renderProveedores();
  document.getElementById('modalProveedores').style.display = 'flex';
}

function closeGestionProveedores() {
  document.getElementById('modalProveedores').style.display = 'none';
}

function renderProveedores() {
  const cont = document.getElementById('proveedoresLista');

  const counts = {};
  INSUMOS_DB.forEach(i => {
    const p = i.proveedor || '(sin proveedor)';
    counts[p] = (counts[p] || 0) + 1;
  });
  const provs = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

  if (provs.length === 0) {
    cont.innerHTML = '<div class="bib-empty"><i class="ti ti-truck-off"></i><div class="bib-empty-title">No hay proveedores</div></div>';
    return;
  }

  let html = '';
  provs.forEach(p => {
    const esSinProv = (p === '(sin proveedor)');
    const safeName = esc(p).replace(/'/g, "\\'");
    const accionRenombrar = esSinProv ? '' : `
      <button class="bib-btn-edit" onclick="openRenombrarProv('${safeName}')" title="Renombrar o fusionar">
        <i class="ti ti-edit"></i>
      </button>`;
    const accionBorrar = esSinProv ? '' : `
      <button class="bib-btn-delete" onclick="borrarProveedor('${safeName}')" title="Borrar (insumos quedan sin proveedor)">
        <i class="ti ti-trash"></i>
      </button>`;

    html += `
      <div class="subfam-row">
        <div class="subfam-icon-box" style="background:rgba(239,159,39,0.15);color:#EF9F27;">
          <i class="ti ti-truck"></i>
        </div>
        <div class="subfam-info">
          <div class="subfam-nombre">${esc(p)}</div>
          <div class="subfam-count">${counts[p]} insumo${counts[p] !== 1 ? 's' : ''}</div>
        </div>
        <div class="subfam-actions">
          ${accionRenombrar}
          ${accionBorrar}
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

function openRenombrarProv(nombreOriginal) {
  PROV_RENOMBRANDO = nombreOriginal;

  const count = INSUMOS_DB.filter(i => i.proveedor === nombreOriginal).length;

  document.getElementById('provOriginal').value = nombreOriginal;
  document.getElementById('provNuevo').value = nombreOriginal;
  document.getElementById('provCount').textContent =
    `Se actualizarán ${count} insumo${count !== 1 ? 's' : ''}.`;

  const hint = document.getElementById('provHint');
  const updateHint = () => {
    const nuevo = document.getElementById('provNuevo').value.trim();
    if (!nuevo || nuevo === nombreOriginal) {
      hint.textContent = 'Si el nuevo nombre ya existe, los proveedores se fusionan.';
      hint.style.color = '';
    } else if (INSUMOS_PROVEEDORES_CACHE.includes(nuevo)) {
      hint.textContent = `⚠ "${nuevo}" ya existe. Se fusionarán los dos.`;
      hint.style.color = '#EF9F27';
    } else {
      hint.textContent = `Se renombra "${nombreOriginal}" → "${nuevo}".`;
      hint.style.color = '#5DCAA5';
    }
  };
  document.getElementById('provNuevo').oninput = updateHint;
  updateHint();

  document.getElementById('modalRenombrarProv').style.display = 'flex';
}

function closeRenombrarProv() {
  document.getElementById('modalRenombrarProv').style.display = 'none';
  PROV_RENOMBRANDO = null;
}

async function guardarRenombrarProv() {
  if (!PROV_RENOMBRANDO) return;
  const nuevo = document.getElementById('provNuevo').value.trim();

  if (!nuevo) { toast('Falta el nombre nuevo', 'error'); return; }
  if (nuevo === PROV_RENOMBRANDO) { toast('El nombre no cambió', 'warning'); return; }

  const yaExiste = INSUMOS_PROVEEDORES_CACHE.includes(nuevo);
  const count = INSUMOS_DB.filter(i => i.proveedor === PROV_RENOMBRANDO).length;

  const ok = await showConfirm({
    title: yaExiste ? `¿Fusionar proveedores?` : `¿Renombrar proveedor?`,
    msg: yaExiste
      ? `Vas a fusionar "${PROV_RENOMBRANDO}" con "${nuevo}".\n\n${count} insumo(s) pasarán a "${nuevo}".`
      : `Vas a renombrar "${PROV_RENOMBRANDO}" a "${nuevo}".\n\nAfecta a ${count} insumo(s).`,
    type: yaExiste ? 'warning' : 'info',
    okLabel: yaExiste ? 'Fusionar' : 'Renombrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  const btn = document.getElementById('btnRenombrarProv');
  btn.disabled = true;
  btn.textContent = 'Aplicando...';

  try {
    await api(`ingredientes?proveedor=eq.${encodeURIComponent(PROV_RENOMBRANDO)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        proveedor: nuevo,
        actualizado_en: new Date().toISOString()
      })
    });

    toast(yaExiste ? `Proveedores fusionados (${count} insumos)` : `Renombrado (${count} insumos)`);
    closeRenombrarProv();

    await cargarInsumos();
    await cargarOpcionesUnicas();
    renderInsumosLista();
    renderProveedores();
  } catch (e) {
    toast('Error al actualizar', 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Aplicar';
  }
}

async function borrarProveedor(nombre) {
  const count = INSUMOS_DB.filter(i => i.proveedor === nombre).length;

  const ok = await showConfirm({
    title: '¿Borrar proveedor?',
    msg: `Vas a borrar el proveedor "${nombre}".\n\nLos ${count} insumo(s) asociados quedarán sin proveedor (no se borran).`,
    type: 'warning',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    await api(`ingredientes?proveedor=eq.${encodeURIComponent(nombre)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        proveedor: null,
        actualizado_en: new Date().toISOString()
      })
    });

    toast(`Proveedor eliminado (${count} insumos sin proveedor)`);

    await cargarInsumos();
    await cargarOpcionesUnicas();
    renderInsumosLista();
    renderProveedores();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// Exponer al window
window.openAdminInsumos = openAdminInsumos;
window.openModalInsumo = openModalInsumo;
window.closeModalInsumo = closeModalInsumo;
window.guardarInsumo = guardarInsumo;
window.borrarInsumo = borrarInsumo;
window.onBuscarInsumo = onBuscarInsumo;
window.onFiltroInsumo = onFiltroInsumo;
window.irPaginaInsumo = irPaginaInsumo;
window.openGestionSubfamilias = openGestionSubfamilias;
window.closeGestionSubfamilias = closeGestionSubfamilias;
window.openRenombrarSubfam = openRenombrarSubfam;
window.closeRenombrarSubfam = closeRenombrarSubfam;
window.guardarRenombrarSubfam = guardarRenombrarSubfam;
window.borrarSubfamilia = borrarSubfamilia;
window.openMenuGestion = openMenuGestion;
window.closeMenuGestion = closeMenuGestion;
window.openGestionProveedores = openGestionProveedores;
window.closeGestionProveedores = closeGestionProveedores;
window.openRenombrarProv = openRenombrarProv;
window.closeRenombrarProv = closeRenombrarProv;
window.guardarRenombrarProv = guardarRenombrarProv;
window.borrarProveedor = borrarProveedor;

init();

})();
