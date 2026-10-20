# ADR 0006 — Fastify, validation par schéma et politique de versions

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

Une plateforme d'identité est sur le chemin critique de toutes les applications : chaque milliseconde
et chaque champ non validé comptent.

## Décision

- **Fastify 5** : schémas de requête et de réponse au cœur du framework, sérialisation rapide, et
  plugins officiels maintenus pour Helmet, CORS, cookies et limitation de débit.
- **Zod 4 via `fastify-type-provider-zod`** : un seul schéma valide l'entrée, type le handler,
  filtre la réponse (pas de fuite de champ comme `password_hash`) et génère l'OpenAPI.
- **ESM natif** (`"type": "module"`) et TypeScript `nodenext`.

| Dépendance | Version | Raison                                                |
| ---------- | ------- | ----------------------------------------------------- |
| Node.js    | 22 LTS  | LTS jusqu'en avril 2027                               |
| TypeScript | 5.9     | typescript-eslint ne supporte pas encore TypeScript 7 |
| ESLint     | 10      | ESLint 9 n'est plus supporté                          |
| Fastify    | 5       | Version courante                                      |
| Vue        | 3.5     | Avec Pinia 4 et Vue Router 5                          |
| PostgreSQL | 17      | Supporté par RDS et Neon                              |
| MongoDB    | 8       | Version courante de MongoDB Atlas                     |

Dependabot propose les mises à jour mineures et correctives chaque semaine ; les versions majeures
font l'objet d'une pull request dédiée.

## Conséquences

- ✅ Les réponses ne contiennent que les champs déclarés : une erreur de développement ne peut pas
  exposer un hash ou un secret.
- ⚠️ ESM impose des extensions `.js` dans les imports TypeScript.
