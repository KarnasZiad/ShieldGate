# ADR 0002 — Sessions opaques dans Redis plutôt que des JWT

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

L'exigence EF-04 impose qu'une session révoquée soit refusée dès la requête suivante. Un JWT
autoporteur reste valide jusqu'à son expiration : le révoquer impose une liste noire consultée à
chaque requête, ce qui revient à une session serveur, avec la complexité des JWT en plus.

## Décision

- La console utilise un **identifiant de session opaque** (256 bits) dans un cookie
  `__Host-sg_session` (`Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`).
- La session vit dans **Redis**, indexée par l'empreinte SHA-256 de l'identifiant : un dump Redis ne
  donne pas d'identifiant utilisable.
- Expiration glissante de 30 minutes, durée absolue de 12 heures, nouvel identifiant à chaque
  connexion (anti-fixation).
- Les jetons JWT signés (RS256 / ES256, JWKS) sont réservés à OpenID Connect en v2, pour les
  applications clientes, avec une durée courte.

## Conséquences

- ✅ Révocation immédiate et globale : supprimer la clé Redis suffit.
- ✅ Liste des sessions actives d'un utilisateur triviale à construire (EF-04).
- ⚠️ Redis devient une dépendance critique : il est surveillé par le healthcheck de readiness et
  doit être répliqué en production.
- ⚠️ Une lecture Redis par requête authentifiée (moins de 1 ms en réseau local).

## Alternatives écartées

- **JWT d'accès + refresh token** : pertinent pour une SPA grand public (choix fait dans RiadOS),
  mais la révocation instantanée est ici une exigence, pas une option.
