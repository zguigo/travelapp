/* =========================================================================
   db.js — Camada de persistência (IndexedDB)
   -------------------------------------------------------------------------
   Responsável por:
   1. Guardar o objeto inteiro da viagem (cidades, presença, tickets, etc)
      em um object store simples de chave/valor.
   2. Guardar as IMAGENS (fotos, QR codes, passagens) como Blobs em um
      object store dedicado — assim não esbarramos no limite de ~5MB do
      localStorage e conseguimos guardar fotos em alta qualidade offline.
   3. Deixar prontos os "ganchos" de sincronização em nuvem (Firebase ou
      Supabase, ambos com planos gratuitos) para quando a app for hospedada
      em Vercel / Netlify / Render / GitHub Pages e usada por Tom e Guigo
      em tempo real. Por padrão a sincronização fica DESLIGADA e tudo
      funciona 100% offline com IndexedDB.
   ========================================================================= */

const DB_NAME = 'tomguigo-italia-2026';
const DB_VERSION = 1;
const STORE_TRIP = 'tripData';   // chave/valor: { key: 'trip', value: {...} }
const STORE_IMAGES = 'images';   // { id, blob, mimeType, createdAt }

let _dbPromise = null;

/** Abre (ou cria) o banco IndexedDB e garante os object stores. */
function openDatabase() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_TRIP)) {
        db.createObjectStore(STORE_TRIP, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });

  return _dbPromise;
}

/* ---------------------------- Trip data (JSON) ---------------------------- */

/** Salva o objeto completo da viagem no IndexedDB. */
async function saveTripData(tripObject) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRIP, 'readwrite');
    tx.objectStore(STORE_TRIP).put({ key: 'trip', value: tripObject });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/** Recupera o objeto completo da viagem (ou null se ainda não existir). */
async function loadTripData() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRIP, 'readonly');
    const req = tx.objectStore(STORE_TRIP).get('trip');
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

/* ------------------------------- Imagens ---------------------------------- */

/** Guarda um arquivo de imagem (File/Blob) e devolve um id único para referenciá-lo. */
async function saveImage(file) {
  const db = await openDatabase();
  const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    tx.objectStore(STORE_IMAGES).put({
      id,
      blob: file,
      mimeType: file.type || 'image/jpeg',
      createdAt: Date.now()
    });
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

/** Recupera uma imagem pelo id e devolve uma Object URL pronta para usar em <img src>. */
async function getImageUrl(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const req = tx.objectStore(STORE_IMAGES).get(id);
    req.onsuccess = () => {
      if (!req.result) return resolve(null);
      resolve(URL.createObjectURL(req.result.blob));
    };
    req.onerror = () => reject(req.error);
  });
}

/** Remove uma imagem do armazenamento. */
async function deleteImage(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    tx.objectStore(STORE_IMAGES).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/** Converte um Blob para Base64 (usado apenas na exportação do backup .json). */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); // "data:image/png;base64,...."
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Converte uma Data URL (base64) de volta para Blob (usado na importação do backup). */
function base64ToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Devolve todas as imagens (id + base64) para incluir no export do backup. */
async function exportAllImages() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const req = tx.objectStore(STORE_IMAGES).getAll();
    req.onsuccess = async () => {
      const rows = req.result || [];
      const out = [];
      for (const row of rows) {
        const base64 = await blobToBase64(row.blob);
        out.push({ id: row.id, mimeType: row.mimeType, base64 });
      }
      resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Restaura imagens a partir de um backup importado (lista de {id, base64}). */
async function importAllImages(imageList) {
  const db = await openDatabase();
  const tx = db.transaction(STORE_IMAGES, 'readwrite');
  const store = tx.objectStore(STORE_IMAGES);
  for (const img of imageList) {
    const blob = base64ToBlob(img.base64);
    store.put({ id: img.id, blob, mimeType: img.mimeType, createdAt: Date.now() });
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/** Apaga completamente o banco (usado no botão "Apagar todos os dados"). */
async function wipeDatabase() {
  _dbPromise = null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(true);
  });
}

/* =========================================================================
   SINCRONIZAÇÃO EM NUVEM (opcional, desligada por padrão)
   -------------------------------------------------------------------------
   A ideia: Tom e Guigo hospedam a app de graça (Vercel / Netlify / Render /
   GitHub Pages) e usam um banco em nuvem gratuito (Firebase Realtime
   Database ou Supabase) só para o JSON da viagem (o objeto retornado por
   loadTripData) — as imagens continuam locais em cada dispositivo via
   IndexedDB, pois costumam pesar mais que o plano gratuito comporta.

   Para ativar:
   1. Crie um projeto gratuito no Firebase ou no Supabase.
   2. Preencha CLOUD_CONFIG abaixo com as credenciais do projeto.
   3. Descomente as chamadas de fetch dentro de pushTripToCloud /
      pullTripFromCloud e adapte à API escolhida.
   4. Chame configureCloudSync({ enabled: true }) — por exemplo a partir do
      painel de Configurações da app.
   ========================================================================= */

const CLOUD_CONFIG = {
  enabled: false,          // true = tenta sincronizar em nuvem
  provider: null,          // 'firebase' | 'supabase'
  // Firebase Realtime Database: URL do projeto, ex. "https://SEU-PROJETO.firebaseio.com"
  firebaseDatabaseUrl: '',
  // Supabase: URL do projeto + chave anônima (pública) + tabela usada
  supabaseUrl: '',
  supabaseAnonKey: '',
  supabaseTable: 'trip_data'
};

function configureCloudSync(options) {
  Object.assign(CLOUD_CONFIG, options);
}

/** Envia o JSON da viagem para a nuvem (no-op enquanto CLOUD_CONFIG.enabled = false). */
async function pushTripToCloud(tripObject) {
  if (!CLOUD_CONFIG.enabled) return { skipped: true };

  try {
    if (CLOUD_CONFIG.provider === 'firebase' && CLOUD_CONFIG.firebaseDatabaseUrl) {
      // Exemplo de chamada REST do Firebase Realtime Database:
      // await fetch(`${CLOUD_CONFIG.firebaseDatabaseUrl}/trip.json`, {
      //   method: 'PUT',
      //   body: JSON.stringify(tripObject)
      // });
    }
    if (CLOUD_CONFIG.provider === 'supabase' && CLOUD_CONFIG.supabaseUrl) {
      // Exemplo de chamada REST do Supabase:
      // await fetch(`${CLOUD_CONFIG.supabaseUrl}/rest/v1/${CLOUD_CONFIG.supabaseTable}`, {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'apikey': CLOUD_CONFIG.supabaseAnonKey,
      //     'Authorization': `Bearer ${CLOUD_CONFIG.supabaseAnonKey}`,
      //     'Prefer': 'resolution=merge-duplicates'
      //   },
      //   body: JSON.stringify({ id: 'trip', data: tripObject })
      // });
    }
    return { ok: true };
  } catch (err) {
    console.warn('Falha ao sincronizar com a nuvem:', err);
    return { ok: false, error: err };
  }
}

/** Busca o JSON da viagem na nuvem (no-op enquanto CLOUD_CONFIG.enabled = false). */
async function pullTripFromCloud() {
  if (!CLOUD_CONFIG.enabled) return null;
  try {
    // Implementar de acordo com o provedor escolhido, espelhando pushTripToCloud.
    return null;
  } catch (err) {
    console.warn('Falha ao buscar dados da nuvem:', err);
    return null;
  }
}

/* Exposto globalmente para uso em app.js (sem módulos ES para manter
   compatibilidade simples de "abrir e rodar" direto do arquivo). */
window.TripDB = {
  saveTripData,
  loadTripData,
  saveImage,
  getImageUrl,
  deleteImage,
  exportAllImages,
  importAllImages,
  wipeDatabase,
  configureCloudSync,
  pushTripToCloud,
  pullTripFromCloud
};
