/* =========================================================================
   db.js — Camada de persistência (Firebase: Firestore apenas)
   -------------------------------------------------------------------------
   O Firebase Storage passou a exigir o plano pago (Blaze) mesmo para uso
   dentro da faixa gratuita, então esta versão guarda TUDO no Firestore
   (que continua 100% gratuito no plano Spark):

   - trips/italia-2026        → o JSON inteiro da viagem (sincronizado em
                                 tempo real entre Tom e Guigo).
   - images/{imageId}         → cada imagem vira um documento com a foto
                                 já comprimida e convertida para base64
                                 (campo "base64"). Como cada documento do
                                 Firestore tem um limite de ~1 MB, as fotos
                                 são redimensionadas e comprimidas no
                                 navegador ANTES de subir (função
                                 resizeImageToDataUrl), o que também deixa
                                 tudo mais rápido para carregar depois.

   Esta camada depende de:
   - firebase-config.js (carregado ANTES deste arquivo) — inicializa o app
     do Firebase com as credenciais do projeto.
   - auth.js (carregado ANTES deste arquivo) — só usuários autenticados
     chegam a chamar estas funções (reforçado também pelas Regras do
     Firestore, que exigem login).

   A API pública (window.TripDB.*) tem os mesmos nomes de função de antes,
   então app.js não precisou mudar por causa disso.
   ========================================================================= */

'use strict';

const TRIP_COLLECTION = 'trips';
const TRIP_DOC_ID = 'italia-2026';
const IMAGES_COLLECTION = 'images';

// Tamanho máximo (maior lado, em pixels) e qualidade JPEG usados ao
// comprimir uma foto antes de guardá-la no Firestore.
const IMAGE_MAX_DIMENSION = 1280;
const IMAGE_QUALITY = 0.7;

function tripDocRef() {
  return firebase.firestore().collection(TRIP_COLLECTION).doc(TRIP_DOC_ID);
}

function imagesCollectionRef() {
  return firebase.firestore().collection(IMAGES_COLLECTION);
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

/** Redimensiona e comprime uma imagem no navegador, devolvendo uma Data URL
 *  (string "data:image/jpeg;base64,...") pequena o suficiente para caber
 *  em um documento do Firestore. */
function resizeImageToDataUrl(file, maxDimension = IMAGE_MAX_DIMENSION, quality = IMAGE_QUALITY) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Comprime e salva uma imagem como documento no Firestore, devolvendo o id
 *  do documento (usado depois para buscar/excluir a imagem). */
async function saveImage(file) {
  let dataUrl = await resizeImageToDataUrl(file);

  // Se ainda assim ficar grande demais para um documento do Firestore
  // (~1 MB), tenta de novo com mais compressão antes de desistir.
  if (dataUrl.length > 900000) {
    dataUrl = await resizeImageToDataUrl(file, 900, 0.55);
  }
  if (dataUrl.length > 950000) {
    throw new Error('Imagem grande demais mesmo após compressão. Tente uma foto menor.');
  }

  const docRef = await imagesCollectionRef().add({
    base64: dataUrl,
    createdAt: Date.now()
  });
  return docRef.id;
}

/** Recupera a Data URL de uma imagem pelo id — pode ser usada direto em
 *  <img src="..."> sem nenhuma conversão extra. */
async function getImageUrl(id) {
  try {
    const snap = await imagesCollectionRef().doc(id).get();
    return snap.exists ? snap.data().base64 : null;
  } catch (err) {
    console.warn('Imagem não encontrada:', id, err);
    return null;
  }
}

/** Remove o documento da imagem. */
async function deleteImage(id) {
  try {
    await imagesCollectionRef().doc(id).delete();
  } catch (err) {
    // Se já não existir, não há problema.
  }
  return true;
}

/** Devolve todas as imagens (id + base64 + mimeType) para incluir no backup .json. */
async function exportAllImages() {
  const snap = await imagesCollectionRef().get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    mimeType: 'image/jpeg',
    base64: doc.data().base64
  }));
}

/** Restaura imagens a partir de um backup importado (lista de {id, base64}),
 *  preservando o id original para que os lugares continuem apontando para
 *  a imagem certa. */
async function importAllImages(imageList) {
  const batch = firebase.firestore().batch();
  imageList.forEach((img) => {
    batch.set(imagesCollectionRef().doc(img.id), {
      base64: img.base64,
      createdAt: Date.now()
    });
  });
  await batch.commit();
  return true;
}

/** Apaga o documento da viagem e todas as imagens (botão "Apagar todos os dados"). */
async function wipeDatabase() {
  await tripDocRef().delete();
  try {
    const snap = await imagesCollectionRef().get();
    const batch = firebase.firestore().batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  } catch (err) {
    console.warn('Falha ao limpar imagens do Firestore:', err);
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
