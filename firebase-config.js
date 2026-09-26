/* =========================================================================
   firebase-config.js
   -------------------------------------------------------------------------
   Substitua os valores abaixo pelas credenciais do SEU projeto Firebase.
   Você encontra esses valores em:
   Firebase Console → ⚙️ Configurações do projeto → Geral → "Seus apps"
   → app da Web → "SDK setup and configuration" → "Config".

   Essas credenciais NÃO são segredo (é normal e seguro elas ficarem
   públicas em um site estático) — quem realmente protege os dados são as
   Regras de Segurança do Firestore/Storage (exigindo login) e a tela de
   login (auth.js), configuradas nos passos do guia de hospedagem.
   ========================================================================= */

'use strict';

const firebaseConfig = {
  apiKey: "AIzaSyC5bhah2uiu2ithLv98jBHuDk68qakd-eg",
  authDomain: "travel-app-c8701.firebaseapp.com",
  projectId: "travel-app-c8701",
  storageBucket: "travel-app-c8701.firebasestorage.app",
  messagingSenderId: "1040094841533",
  appId: "1:1040094841533:web:5373a9498728063cdf05d4"
};

firebase.initializeApp(firebaseConfig);
