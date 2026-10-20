# User stories

Priorisation MoSCoW. Les critères d'acceptation marqués 🔒 sont aussi des exigences de sécurité
couvertes par des tests automatisés.

## Epic 1 — Authentification

**US-01 · Me connecter** — _Must_

> En tant qu'utilisateur, je veux me connecter avec mon e-mail et mon mot de passe.

- 🔒 Un e-mail inconnu et un mauvais mot de passe produisent la même réponse, dans un temps comparable.
- 🔒 Le cookie de session est `__Host-`, `Secure`, `HttpOnly` et `SameSite=Strict`.
- 🔒 L'identifiant de session est régénéré à chaque connexion (pas de fixation de session).

**US-02 · Être protégé contre le vol de mot de passe** — _Must_

> En tant qu'utilisateur, je veux que mon compte résiste aux essais automatisés.

- 🔒 Après 5 échecs en 15 minutes, le compte est verrouillé 15 minutes ; l'événement est journalisé.
- 🔒 Une IP qui échoue sur plus de 10 comptes différents en 10 minutes est bloquée une heure.

**US-03 · Activer la double authentification** — _Must_

> En tant qu'utilisateur, je veux protéger mon compte avec une application TOTP.

- La console affiche un QR code (URI `otpauth://`) et le secret en base32.
- 🔒 L'activation exige un premier code valide ; le secret est chiffré au repos.
- 🔒 Un code déjà utilisé est refusé, même dans sa fenêtre de validité.

**US-04 · Gérer mes sessions** — _Must_

> En tant qu'utilisateur, je veux voir où je suis connecté et fermer une session suspecte.

- 🔒 La session fermée est refusée dès la requête suivante, sur tous les serveurs.

## Epic 2 — Administration

**US-10 · Gérer les comptes** — _Must_

> En tant qu'administrateur, je veux créer, désactiver et réactiver des comptes.

- 🔒 Désactiver un compte ferme immédiatement toutes ses sessions.
- 🔒 Le mot de passe initial respecte la politique (12 caractères minimum, absent des listes de
  mots de passe compromis, différent de l'e-mail).

**US-11 · Consulter le journal d'audit** — _Must_

> En tant qu'analyste, je veux filtrer les événements par utilisateur, action et période.

**US-12 · Émettre des clés API** — _Must_

> En tant qu'administrateur, je veux délivrer une clé API à une application avec des portées limitées.

- 🔒 La clé n'est montrée qu'une fois ; la révocation est immédiate.

## Epic 3 — Autorisation

**US-20 · Déléguer une décision d'accès** — _Must_

> En tant qu'application cliente, je veux demander à ShieldGate si un utilisateur peut effectuer une
> action sur une ressource.

- 🔒 Refus par défaut ; une règle `deny` l'emporte sur toute règle `allow`.
- Les règles peuvent porter sur des attributs : propriétaire de la ressource, département, plage
  d'adresses IP, horaires.

**US-21 · Se connecter une seule fois** — _Should_ (OpenID Connect)

**US-22 · Me connecter avec une passkey** — _Could_ (WebAuthn)
