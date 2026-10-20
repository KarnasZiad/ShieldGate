# ADR 0004 — Argon2id pour les mots de passe, HMAC et AES-GCM pour les autres secrets

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

Trois types de secrets n'ont pas les mêmes propriétés :

| Secret       | Entropie                     | Besoin                           |
| ------------ | ---------------------------- | -------------------------------- |
| Mot de passe | Faible, choisi par un humain | Vérifier, jamais relire          |
| Clé API      | 256 bits aléatoires          | Vérifier vite, à chaque requête  |
| Secret TOTP  | 160 bits aléatoires          | **Relire** pour calculer le code |

## Décision

- **Mots de passe** : Argon2id, 19 Mio de mémoire, 2 itérations, parallélisme 1 (recommandation
  OWASP), via `@node-rs/argon2`. Longueur bornée à 128 caractères pour limiter le coût d'un hachage.
- **Clés API** : `HMAC-SHA256(secret, pepper)`. Un hachage lent serait inutile (le secret a 256 bits
  d'entropie) et coûteux à chaque requête. Le _pepper_ est dans la configuration, pas en base.
- **Secrets TOTP** : chiffrés en AES-256-GCM (clé de 256 bits en configuration, nonce aléatoire de
  96 bits par secret, tag d'authentification vérifié au déchiffrement).

## Conséquences

- ✅ Une fuite de la base seule ne donne ni mot de passe, ni clé API, ni secret TOTP exploitable.
- ⚠️ Perdre la clé de chiffrement TOTP oblige tous les utilisateurs à réenrôler leur MFA : la clé
  est sauvegardée dans le gestionnaire de secrets (Vault ou Sealed Secrets en production).
- ⚠️ La rotation de la clé TOTP impose un rechiffrement ; le format stocké inclut une version de clé.
