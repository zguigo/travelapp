/* =========================================================================
   app.js — Lógica da aplicação
   Calendário de Outubro/2026, drag & drop, tickets estilo wallet,
   divisão de custos, presença de Tom/Guigo e gestão de lugares.
   ========================================================================= */

'use strict';

/* ----------------------------- Constantes ----------------------------- */

const TRIP_YEAR = 2026;
const TRIP_MONTH = 9; // Outubro (0-indexado: 9 = outubro)
const DAYS_IN_MONTH = 31;
const WEEKDAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

const CATEGORY_META = {
  trem:    { label: 'Trem',    icon: 'icon-train' },
  aviao:   { label: 'Avião',   icon: 'icon-plane' },
  museu:   { label: 'Museu',   icon: 'icon-museum' },
  atracao: { label: 'Atração', icon: 'icon-attraction' },
  carro:   { label: 'Aluguel de Carro', icon: 'icon-car' },
  outros:  { label: 'Outros',  icon: 'icon-other' }
};

const CURRENCY_SYMBOL = { EUR: '€', BRL: 'R$' };

/* -------------------------------- Estado -------------------------------- */

let trip = null;               // objeto principal salvo no IndexedDB
let currentDayIndex = null;    // índice do dia aberto no modal (0-based)
let currentView = 'calendar';

let ticketCategory = 'trem';
let ticketSplitType = 'dividido';

let placeImageId = null;       // id da imagem (IndexedDB) selecionada no modal de lugar
let placeImageObjectUrl = null;

let dragSourceIndex = null;

/* ------------------------------ Utilidades ------------------------------ */

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function formatMoney(value, currency) {
  const symbol = CURRENCY_SYMBOL[currency] || currency;
  const num = Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol} ${num}`;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 2400);
}

async function persist() {
  await window.TripDB.saveTripData(trip);
  window.TripDB.pushTripToCloud(trip); // no-op enquanto a nuvem estiver desligada
}

/* --------------------------- Inicialização da viagem --------------------------- */

function createDefaultTrip() {
  const days = [];
  for (let d = 1; d <= DAYS_IN_MONTH; d++) {
    days.push({
      date: d,
      city: '',
      presence: 'both',
      hotel: { name: '', address: '', link: '' },
      tickets: [],
      places: []
    });
  }
  return { days };
}

async function initTrip() {
  const saved = await window.TripDB.loadTripData();
  trip = saved || createDefaultTrip();
  // Garante compatibilidade caso a estrutura salva seja antiga/incompleta
  if (!trip.days || trip.days.length !== DAYS_IN_MONTH) {
    trip = createDefaultTrip();
  }
}

/* -------------------------------- Navegação -------------------------------- */

function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.view').forEach(v => {
    v.hidden = v.dataset.view !== viewName;
  });
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === viewName);
  });
  if (viewName === 'summary') renderSummary();
  if (viewName === 'list') renderList();
}

/* ------------------------------- Calendário ------------------------------- */

function renderWeekdayRow() {
  const row = document.getElementById('weekday-row');
  row.innerHTML = WEEKDAYS_PT.map(w => `<span>${w}</span>`).join('');
}

function presenceAvatar(presence, small) {
  if (presence === 'tom') return `<span class="avatar avatar-tom">T</span>`;
  if (presence === 'guigo') return `<span class="avatar avatar-guigo">G</span>`;
  return `<span class="avatar avatar-both"><svg><use href="#icon-both"/></svg></span>`;
}

function dayCostTotal(day) {
  // Retorna um objeto { EUR: x, BRL: y } com o total do dia (hospedagem não tem valor, só tickets)
  const totals = {};
  day.tickets.forEach(t => {
    totals[t.currency] = (totals[t.currency] || 0) + Number(t.value || 0);
  });
  return totals;
}

function formatTotalsShort(totals) {
  const parts = Object.keys(totals).map(cur => formatMoney(totals[cur], cur));
  return parts.length ? parts.join(' · ') : '—';
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  // Espaços vazios antes do dia 1 de outubro, alinhados ao dia da semana real
  const firstWeekday = new Date(TRIP_YEAR, TRIP_MONTH, 1).getDay();
  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement('div');
    grid.appendChild(empty);
  }

  trip.days.forEach((day, index) => {
    const card = document.createElement('div');
    card.className = 'day-card';
    card.draggable = true;
    card.dataset.index = String(index);

    const totals = dayCostTotal(day);

    card.innerHTML = `
      <span class="day-num">${day.date}</span>
      <span class="day-city ${day.city ? '' : 'empty'}">${day.city ? escapeHtml(day.city) : 'Destino a definir'}</span>
      <div class="day-footer">
        <div class="avatar-row">${presenceAvatar(day.presence)}</div>
        <span class="day-cost">${formatTotalsShort(totals)}</span>
      </div>
    `;

    card.addEventListener('click', () => openDayModal(index));
    attachDragHandlers(card, index);
    grid.appendChild(card);
  });
}

function attachDragHandlers(card, index) {
  card.addEventListener('dragstart', (e) => {
    dragSourceIndex = index;
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('is-dragging');
    document.querySelectorAll('.day-card.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    card.classList.add('is-drop-target');
  });
  card.addEventListener('dragleave', () => card.classList.remove('is-drop-target'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('is-drop-target');
    const targetIndex = index;
    if (dragSourceIndex === null || dragSourceIndex === targetIndex) return;
    swapDayContents(dragSourceIndex, targetIndex);
    dragSourceIndex = null;
  });
}

/** Troca o conteúdo do roteiro (cidade, presença, hospedagem, tickets, lugares)
 *  entre dois dias, preservando a data de cada slot no calendário. */
function swapDayContents(indexA, indexB) {
  const dayA = trip.days[indexA];
  const dayB = trip.days[indexB];

  const dateA = dayA.date;
  const dateB = dayB.date;

  trip.days[indexA] = { ...dayB, date: dateA };
  trip.days[indexB] = { ...dayA, date: dateB };

  renderCalendar();
  renderList();
  persist();
  showToast('Roteiro reorganizado');
}

/* --------------------------------- Lista --------------------------------- */

function renderList() {
  const list = document.getElementById('day-list');
  list.innerHTML = trip.days.map((day, index) => {
    const weekday = WEEKDAYS_PT[new Date(TRIP_YEAR, TRIP_MONTH, day.date).getDay()];
    const totals = dayCostTotal(day);
    const ticketCount = day.tickets.length;
    return `
      <div class="day-list-item" data-index="${index}">
        <div class="day-list-date">
          <span class="num">${day.date}</span>
          <span class="wd">${weekday}</span>
        </div>
        <div class="day-list-info">
          <div class="city ${day.city ? '' : 'empty'}">${day.city ? escapeHtml(day.city) : 'Destino a definir'}</div>
          <div class="meta">${ticketCount} ticket${ticketCount === 1 ? '' : 's'} · ${formatTotalsShort(totals)}</div>
        </div>
        <div class="avatar-row">${presenceAvatar(day.presence)}</div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.day-list-item').forEach(item => {
    item.addEventListener('click', () => openDayModal(Number(item.dataset.index)));
  });
}

/* ------------------------------ Modal do dia ------------------------------ */

function openDayModal(index) {
  currentDayIndex = index;
  const day = trip.days[index];

  document.getElementById('day-modal-date').textContent = `${day.date} de ${MONTHS_PT[TRIP_MONTH]} de ${TRIP_YEAR}`;
  document.getElementById('day-city-input').value = day.city || '';
  document.getElementById('hotel-name').value = day.hotel.name || '';
  document.getElementById('hotel-address').value = day.hotel.address || '';
  document.getElementById('hotel-link').value = day.hotel.link || '';

  document.querySelectorAll('.presence-opt').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.presence === day.presence);
  });

  renderTicketWallet();
  renderPlaceList();

  document.getElementById('day-modal-overlay').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDayModal() {
  document.getElementById('day-modal-overlay').hidden = true;
  document.body.style.overflow = '';
  renderCalendar();
  renderList();
  currentDayIndex = null;
}

function bindDayModal() {
  document.getElementById('btn-close-modal').addEventListener('click', closeDayModal);
  document.getElementById('day-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'day-modal-overlay') closeDayModal();
  });

  document.getElementById('day-city-input').addEventListener('input', (e) => {
    trip.days[currentDayIndex].city = e.target.value;
    persist();
  });

  ['hotel-name', 'hotel-address', 'hotel-link'].forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
      const field = id.replace('hotel-', '');
      trip.days[currentDayIndex].hotel[field] = e.target.value;
      persist();
    });
  });

  document.querySelectorAll('.presence-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      trip.days[currentDayIndex].presence = btn.dataset.presence;
      document.querySelectorAll('.presence-opt').forEach(b => b.classList.toggle('is-active', b === btn));
      persist();
    });
  });
}

/* --------------------------- Tickets (estilo Wallet) --------------------------- */

function renderTicketWallet() {
  const wallet = document.getElementById('ticket-wallet');
  const day = trip.days[currentDayIndex];

  if (!day.tickets.length) {
    wallet.innerHTML = `<div class="wallet-empty">Nenhum ticket ainda. Adicione trens, voos, museus, atrações...</div>`;
    return;
  }

  wallet.innerHTML = day.tickets.map(ticket => {
    const meta = CATEGORY_META[ticket.category] || CATEGORY_META.outros;
    const splitLabel = ticket.splitType === 'individual'
      ? `Tom ${formatMoney(ticket.valueTom, ticket.currency)} · Guigo ${formatMoney(ticket.valueGuigo, ticket.currency)}`
      : `Dividido: ${formatMoney(ticket.value / 2, ticket.currency)} cada`;

    return `
      <div class="wallet-ticket cat-${ticket.category}" data-id="${ticket.id}">
        <button class="btn-delete-ticket" data-delete-ticket="${ticket.id}" aria-label="Remover ticket">
          <svg><use href="#icon-close"/></svg>
        </button>
        <div class="ticket-strip"><svg><use href="#${meta.icon}"/></svg></div>
        <div class="ticket-perforation"></div>
        <div class="ticket-body">
          <span class="ticket-title">${escapeHtml(ticket.title || meta.label)}</span>
          <span class="ticket-sub">${meta.label}</span>
          <div class="ticket-bottom-row">
            <span class="ticket-value">${formatMoney(ticket.value, ticket.currency)}</span>
            <span class="ticket-split-tag">${splitLabel}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  wallet.querySelectorAll('[data-delete-ticket]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteTicket;
      day.tickets = day.tickets.filter(t => t.id !== id);
      persist();
      renderTicketWallet();
      showToast('Ticket removido');
    });
  });
}

function openTicketModal() {
  ticketCategory = 'trem';
  ticketSplitType = 'dividido';
  document.getElementById('ticket-title').value = '';
  document.getElementById('ticket-value').value = '';
  document.getElementById('ticket-value-tom').value = '';
  document.getElementById('ticket-value-guigo').value = '';
  document.getElementById('ticket-currency').value = 'EUR';

  document.querySelectorAll('.category-opt').forEach(b => b.classList.toggle('is-active', b.dataset.cat === ticketCategory));
  document.querySelectorAll('.split-opt').forEach(b => b.classList.toggle('is-active', b.dataset.split === ticketSplitType));
  document.getElementById('split-individual-row').hidden = true;

  document.getElementById('ticket-modal-overlay').hidden = false;
}

function closeTicketModal() {
  document.getElementById('ticket-modal-overlay').hidden = true;
}

function bindTicketModal() {
  document.getElementById('btn-add-ticket').addEventListener('click', openTicketModal);
  document.getElementById('btn-close-ticket-modal').addEventListener('click', closeTicketModal);
  document.getElementById('ticket-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'ticket-modal-overlay') closeTicketModal();
  });

  document.querySelectorAll('.category-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      ticketCategory = btn.dataset.cat;
      document.querySelectorAll('.category-opt').forEach(b => b.classList.toggle('is-active', b === btn));
    });
  });

  document.querySelectorAll('.split-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      ticketSplitType = btn.dataset.split;
      document.querySelectorAll('.split-opt').forEach(b => b.classList.toggle('is-active', b === btn));
      document.getElementById('split-individual-row').hidden = ticketSplitType !== 'individual';
    });
  });

  document.getElementById('btn-save-ticket').addEventListener('click', () => {
    const title = document.getElementById('ticket-title').value.trim();
    const currency = document.getElementById('ticket-currency').value;
    const value = parseFloat(document.getElementById('ticket-value').value) || 0;

    if (value <= 0) {
      showToast('Informe um valor válido');
      return;
    }

    let valueTom = value / 2;
    let valueGuigo = value / 2;
    if (ticketSplitType === 'individual') {
      valueTom = parseFloat(document.getElementById('ticket-value-tom').value) || 0;
      valueGuigo = parseFloat(document.getElementById('ticket-value-guigo').value) || 0;
    }

    const ticket = {
      id: uid('ticket'),
      category: ticketCategory,
      title: title || CATEGORY_META[ticketCategory].label,
      value,
      currency,
      splitType: ticketSplitType,
      valueTom,
      valueGuigo
    };

    trip.days[currentDayIndex].tickets.push(ticket);
    persist();
    renderTicketWallet();
    closeTicketModal();
    showToast('Ticket adicionado');
  });
}

/* ------------------------------ Lugares / Restaurantes ------------------------------ */

function renderPlaceList() {
  const container = document.getElementById('place-list');
  const day = trip.days[currentDayIndex];

  if (!day.places.length) {
    container.innerHTML = `<div class="wallet-empty">Nenhum lugar salvo ainda.</div>`;
    return;
  }

  container.innerHTML = day.places.map(place => `
    <div class="place-card" data-id="${place.id}">
      <button class="btn-delete-place" data-delete-place="${place.id}" aria-label="Remover lugar">
        <svg><use href="#icon-close"/></svg>
      </button>
      <img class="place-thumb" data-thumb-for="${place.id}" alt="">
      <div class="place-info">
        <div class="place-name">${escapeHtml(place.name)}</div>
        ${place.notes ? `<div class="place-notes">${escapeHtml(place.notes)}</div>` : ''}
        ${place.mapsUrl ? `<a class="place-map-link" href="${escapeAttr(place.mapsUrl)}" target="_blank" rel="noopener"><svg><use href="#icon-map"/></svg>Ver no Google Maps</a>` : ''}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-delete-place]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deletePlace;
      const place = day.places.find(p => p.id === id);
      if (place && place.imageId) {
        await window.TripDB.deleteImage(place.imageId);
      }
      day.places = day.places.filter(p => p.id !== id);
      persist();
      renderPlaceList();
      showToast('Lugar removido');
    });
  });

  // Carrega as miniaturas das imagens salvas no IndexedDB
  day.places.forEach(async (place) => {
    const img = container.querySelector(`[data-thumb-for="${place.id}"]`);
    if (!img) return;
    if (place.imageId) {
      const url = await window.TripDB.getImageUrl(place.imageId);
      img.src = url || '';
    } else {
      img.style.display = 'none';
    }
  });
}

function buildMapsEmbedUrl(rawUrl) {
  if (!rawUrl) return '';
  if (rawUrl.includes('/maps/embed') || rawUrl.includes('output=embed')) return rawUrl;
  // Melhor esforço: reaproveita o link colado como parâmetro de busca embutido
  return `https://www.google.com/maps?q=${encodeURIComponent(rawUrl)}&output=embed`;
}

function openPlaceModal() {
  document.getElementById('place-name').value = '';
  document.getElementById('place-notes').value = '';
  document.getElementById('place-maps-url').value = '';
  document.getElementById('place-maps-preview').hidden = true;
  document.getElementById('place-maps-preview').innerHTML = '';
  document.getElementById('place-image-preview').hidden = true;
  document.getElementById('place-image-preview').innerHTML = '';
  document.getElementById('place-upload-zone').hidden = false;
  placeImageId = null;
  if (placeImageObjectUrl) { URL.revokeObjectURL(placeImageObjectUrl); placeImageObjectUrl = null; }

  document.getElementById('place-modal-overlay').hidden = false;
}

function closePlaceModal() {
  document.getElementById('place-modal-overlay').hidden = true;
}

function bindPlaceModal() {
  document.getElementById('btn-add-place').addEventListener('click', openPlaceModal);
  document.getElementById('btn-close-place-modal').addEventListener('click', closePlaceModal);
  document.getElementById('place-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'place-modal-overlay') closePlaceModal();
  });

  document.getElementById('place-maps-url').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    const preview = document.getElementById('place-maps-preview');
    if (!val) { preview.hidden = true; preview.innerHTML = ''; return; }
    preview.innerHTML = `<iframe src="${escapeAttr(buildMapsEmbedUrl(val))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
    preview.hidden = false;
  });

  document.getElementById('place-upload-zone').addEventListener('click', () => {
    document.getElementById('place-image-input').click();
  });

  document.getElementById('place-image-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    placeImageId = await window.TripDB.saveImage(file);
    placeImageObjectUrl = URL.createObjectURL(file);

    const preview = document.getElementById('place-image-preview');
    preview.innerHTML = `<img src="${placeImageObjectUrl}" alt=""><button class="btn-remove-image" id="btn-remove-place-image"><svg><use href="#icon-close"/></svg></button>`;
    preview.hidden = false;
    document.getElementById('place-upload-zone').hidden = true;

    document.getElementById('btn-remove-place-image').addEventListener('click', async () => {
      if (placeImageId) await window.TripDB.deleteImage(placeImageId);
      placeImageId = null;
      preview.hidden = true;
      preview.innerHTML = '';
      document.getElementById('place-upload-zone').hidden = false;
      document.getElementById('place-image-input').value = '';
    });
  });

  document.getElementById('btn-save-place').addEventListener('click', () => {
    const name = document.getElementById('place-name').value.trim();
    if (!name) { showToast('Dê um nome ao lugar'); return; }

    const place = {
      id: uid('place'),
      name,
      notes: document.getElementById('place-notes').value.trim(),
      mapsUrl: document.getElementById('place-maps-url').value.trim(),
      imageId: placeImageId
    };

    trip.days[currentDayIndex].places.push(place);
    persist();
    renderPlaceList();
    closePlaceModal();
    showToast('Lugar adicionado');
  });
}

/* -------------------------------- Resumo financeiro -------------------------------- */

function computeFinancials() {
  const totals = {};     // { EUR: total, BRL: total }
  const paidTom = {};
  const paidGuigo = {};
  const ledger = [];

  trip.days.forEach(day => {
    day.tickets.forEach(ticket => {
      const cur = ticket.currency;
      totals[cur] = (totals[cur] || 0) + ticket.value;
      paidTom[cur] = (paidTom[cur] || 0) + ticket.valueTom;
      paidGuigo[cur] = (paidGuigo[cur] || 0) + ticket.valueGuigo;
      ledger.push({ ...ticket, dayDate: day.date, dayCity: day.city });
    });
  });

  return { totals, paidTom, paidGuigo, ledger };
}

function renderSummary() {
  const { totals, paidTom, paidGuigo, ledger } = computeFinancials();
  const currencies = Object.keys(totals);

  document.getElementById('sum-total').textContent = currencies.length
    ? currencies.map(c => formatMoney(totals[c], c)).join(' · ')
    : formatMoney(0, 'EUR');
  document.getElementById('sum-tom').textContent = currencies.length
    ? currencies.map(c => formatMoney(paidTom[c] || 0, c)).join(' · ')
    : formatMoney(0, 'EUR');
  document.getElementById('sum-guigo').textContent = currencies.length
    ? currencies.map(c => formatMoney(paidGuigo[c] || 0, c)).join(' · ')
    : formatMoney(0, 'EUR');

  // Cada um "deveria" pagar metade do total; comparamos com o que já foi
  // efetivamente atribuído a cada um (paidTom/paidGuigo já refletem a divisão).
  const balanceLines = [];
  currencies.forEach(cur => {
    const half = totals[cur] / 2;
    const diff = paidTom[cur] - half; // se >0, Tom "assumiu" mais do que a metade
    if (Math.abs(diff) < 0.01) {
      balanceLines.push(`Contas equilibradas em ${CURRENCY_SYMBOL[cur]}.`);
    } else if (diff > 0) {
      balanceLines.push(`Guigo deve ${formatMoney(diff, cur)} para Tom.`);
    } else {
      balanceLines.push(`Tom deve ${formatMoney(-diff, cur)} para Guigo.`);
    }
  });
  document.getElementById('balance-text').textContent = balanceLines.length
    ? balanceLines.join(' ')
    : 'Sem despesas registradas ainda.';

  const ledgerEl = document.getElementById('ledger-list');
  if (!ledger.length) {
    ledgerEl.innerHTML = `<div class="ledger-empty">Nenhum ticket lançado ainda. Adicione tickets nos dias do calendário.</div>`;
    return;
  }

  ledger.sort((a, b) => a.dayDate - b.dayDate);
  ledgerEl.innerHTML = ledger.map(item => {
    const meta = CATEGORY_META[item.category] || CATEGORY_META.outros;
    return `
      <div class="ledger-item">
        <div class="cat-icon"><svg><use href="#${meta.icon}"/></svg></div>
        <div class="info">
          <div class="title">${escapeHtml(item.title)}</div>
          <div class="sub">${item.dayDate} de out · ${item.dayCity ? escapeHtml(item.dayCity) : 'destino a definir'}</div>
        </div>
        <div class="amount">${formatMoney(item.value, item.currency)}</div>
      </div>
    `;
  }).join('');
}

/* --------------------------------- Configurações --------------------------------- */

function bindSettings() {
  const overlay = document.getElementById('settings-modal-overlay');

  document.getElementById('btn-settings').addEventListener('click', () => overlay.hidden = false);
  document.getElementById('btn-close-settings-modal').addEventListener('click', () => overlay.hidden = true);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });

  document.querySelector('[data-nav-settings]').addEventListener('click', () => overlay.hidden = false);

  document.getElementById('btn-export-json').addEventListener('click', async () => {
    const images = await window.TripDB.exportAllImages();
    const backup = {
      exportedAt: new Date().toISOString(),
      trip,
      images
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `viagem-italia-2026-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup exportado');
  });

  document.getElementById('import-json-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (!backup.trip || !backup.trip.days) throw new Error('Arquivo inválido');

      trip = backup.trip;
      if (Array.isArray(backup.images) && backup.images.length) {
        await window.TripDB.importAllImages(backup.images);
      }
      await persist();
      renderCalendar();
      renderList();
      renderSummary();
      showToast('Backup importado com sucesso');
      overlay.hidden = true;
    } catch (err) {
      console.error(err);
      showToast('Não foi possível importar este arquivo');
    } finally {
      e.target.value = '';
    }
  });

  document.getElementById('btn-reset-data').addEventListener('click', async () => {
    const confirmed = confirm('Isso vai apagar todos os dias, tickets, lugares e imagens salvos. Tem certeza?');
    if (!confirmed) return;
    await window.TripDB.wipeDatabase();
    trip = createDefaultTrip();
    await persist();
    renderCalendar();
    renderList();
    renderSummary();
    overlay.hidden = true;
    showToast('Dados apagados');
  });
}

/* ----------------------------------- Helpers ----------------------------------- */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

/* ------------------------------------- Boot ------------------------------------- */

function bindNav() {
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

async function boot() {
  await initTrip();
  renderWeekdayRow();
  renderCalendar();
  renderList();
  renderSummary();

  bindNav();
  bindDayModal();
  bindTicketModal();
  bindPlaceModal();
  bindSettings();

  switchView('calendar');
}

document.addEventListener('DOMContentLoaded', boot);
