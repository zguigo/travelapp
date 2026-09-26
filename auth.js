/* =========================================================================
   auth.js — Tela de login (Firebase Authentication)
   -------------------------------------------------------------------------
   Não existe formulário de "criar conta" nesta app de propósito: só Tom e
   Guigo têm login, porque as duas contas são criadas manualmente por vocês
   no Firebase Console (Authentication → Users → Add user). Isso é o que
   protege a app por senha — sem essas credenciais, ninguém entra.

   Enquanto não há usuário logado, a tela de login (#auth-gate) fica visível
   e o conteúdo da app (.app) fica escondido. Assim que o login funciona, o
   app.js é avisado via window.TripAuth.onReady(callback).
   ========================================================================= */

'use strict';

const auth = firebase.auth();

let _onReadyCallback = null;
let _readyFired = false;

function showAuthGate() {
  const gate = document.getElementById('auth-gate');
  const app = document.querySelector('.app');
  if (gate) gate.hidden = false;
  if (app) app.hidden = true;
}

function hideAuthGate(user) {
  const gate = document.getElementById('auth-gate');
  const app = document.querySelector('.app');
  if (gate) gate.hidden = true;
  if (app) app.hidden = false;

  const emailLabel = document.getElementById('sync-user-email');
  if (emailLabel && user) emailLabel.textContent = user.email;
}

auth.onAuthStateChanged((user) => {
  if (user) {
    hideAuthGate(user);
    if (_onReadyCallback && !_readyFired) {
      _readyFired = true;
      _onReadyCallback(user);
    }
  } else {
    _readyFired = false;
    showAuthGate();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('auth-form');
  const errorEl = document.getElementById('auth-error');
  const submitBtn = document.getElementById('auth-submit');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    errorEl.textContent = '';
    submitBtn.disabled = true;

    auth.signInWithEmailAndPassword(email, password)
      .catch(() => {
        errorEl.textContent = 'E-mail ou senha inválidos.';
      })
      .finally(() => {
        submitBtn.disabled = false;
      });
  });
});

/** Chamado por app.js (bindSettings) quando a pessoa clica em "Sair da conta". */
function signOutOfApp() {
  return auth.signOut();
}

window.TripAuth = {
  onReady(callback) { _onReadyCallback = callback; },
  signOut: signOutOfApp
};
