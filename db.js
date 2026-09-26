/* =========================================================================
   db.js — Camada de persistência (Firebase: Firestore + Storage)
   -------------------------------------------------------------------------
   Antes esta camada usava IndexedDB (só local, cada navegador via seus
   próprios dados). Para Tom e Guigo acessarem, editarem e verem os MESMOS
   dados em tempo real, ela agora usa:

   - Firestore  → guarda o JSON inteiro da viagem em um único documento
                  (trips/italia-2026) e avisa a app sempre que o documento
                  muda (onTripChange), inclusive quando é o outro usuário
                  quem editou.
   - Storage    → guarda as imagens (fotos, QR codes, passagens) em
                  arquivos, acessíveis por qualquer um dos dois logados.

   Esta camada depende de:
   - firebase-config.js (carregado ANTES deste arquivo) — inicializa o app
     do Firebase com as credenciais do projeto.
   - auth.js (carregado ANTES deste arquivo) — garante que só usuários
     autenticados chegam a chamar estas funções (as regras de segurança do
     Firestore/Storage também exigem autenticação, então isso é reforçado
     nos dois lados).

   A API pública (window.TripDB.*) foi mantida com os MESMOS nomes de
   função de antes, então app.js não precisou mudar na maior parte —
   apenas ganhou uma assinatura extra (onTripChange) para sincronização
   em tempo real.
   ========================================================================= */

'use strict';

const TRIP_COLLECTION = 'trips';
const TRIP_DOC_ID = 'italia-2026';
const IMAGES_FOLDER = 'images';

function tripDocRef() {
  return firebase.firestore().collection(TRIP_COLLECTION).doc(TRIP_DOC_ID);
}

function storageRefFor(id) {
  return firebase.storage().ref().child(`${IMAGES_FOLDER}/${id}`);
}

/* ---------------------------- Trip data (JSON) ---------------------------- */

/** Salva o objeto completo da viagem no Firestore (visível para os dois na hora). */
async function saveTripData(tripObject) {
  await tripDocRef().set(tripObject);
  return true;
}

/** Recupera o objeto completo da viagem uma única vez (ou null se ainda não existir). */
async function loadTripData() {
  const snap = await tripDocRef().get();
  return snap.exists ? snap.data() : null;
}

let _unsubscribeTrip = null;

/** Escuta mudanças no documento da viagem em tempo real (ex: o outro editou
 *  em outro dispositivo). Ignora o próprio "eco" de uma escrita local
 *  (snap.metadata.hasPendingWrites) para não atrapalhar quem está digitando. */
function onTripChange(callback) {
  if (_unsubscribeTrip) _unsubscribeTrip();
  _unsubscribeTrip = tripDocRef().onSnapshot(
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      if (snap.exists) callback(snap.data());
    },
    (err) => console.error('Erro ao sincronizar a viagem em tempo real:', err)
  );
  return _unsubscribeTrip;
}

/* ------------------------------- Imagens ---------------------------------- */

/** Envia um arquivo de imagem para o Firebase Storage e devolve um id único. */
async function saveImage(file) {
  const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  await storageRefFor(id).put(file, { contentType: file.type || 'image/jpeg' });
  return id;
}

/** Recupera a URL pública (temporária/assinada) de uma imagem pelo id. */
async function getImageUrl(id) {
  try {
    return await storageRefFor(id).getDownloadURL();
  } catch (err) {
    console.warn('Imagem não encontrada no Storage:', id, err);
    return null;
  }
}

/** Remove uma imagem do Storage. */
async function deleteImage(id) {
  try {
    await storageRefFor(id).delete();
  } catch (err) {
    // Se já não existir, não há problema.
  }
  return true;
}

/** Converte um Blob para Base64 (usado apenas na exportação do backup .json). */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
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

/** Baixa todas as imagens do Storage como base64, para incluir no backup .json. */
async function exportAllImages() {
  const folderRef = firebase.storage().ref().child(IMAGES_FOLDER);
  const list = await folderRef.listAll();
  const out = [];
  for (const item of list.items) {
    const url = await item.getDownloadURL();
    const blob = await (await fetch(url)).blob();
    const base64 = await blobToBase64(blob);
    out.push({ id: item.name, mimeType: blob.type, base64 });
  }
  return out;
}

/** Restaura imagens a partir de um backup importado (lista de {id, base64}). */
async function importAllImages(imageList) {
  for (const img of imageList) {
    const blob = base64ToBlob(img.base64);
    await storageRefFor(img.id).put(blob, { contentType: img.mimeType });
  }
  return true;
}

/** Apaga o documento da viagem e todas as imagens (botão "Apagar todos os dados"). */
async function wipeDatabase() {
  await tripDocRef().delete();
  try {
    const folderRef = firebase.storage().ref().child(IMAGES_FOLDER);
    const list = await folderRef.listAll();
    await Promise.all(list.items.map((item) => item.delete()));
  } catch (err) {
    console.warn('Falha ao limpar imagens do Storage:', err);
  }
  return true;
}

/* Exposto globalmente para uso em app.js. */
window.TripDB = {
  saveTripData,
  loadTripData,
  onTripChange,
  saveImage,
  getImageUrl,
  deleteImage,
  exportAllImages,
  importAllImages,
  wipeDatabase
};
