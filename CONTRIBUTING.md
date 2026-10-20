# Contribuer à ShieldGate

## Flux de travail

1. Créer une branche depuis `main` : `feat/<sujet>`, `fix/<sujet>`, `docs/<sujet>`, `chore/<sujet>`.
2. Commiter en [Conventional Commits](https://www.conventionalcommits.org/fr/), vérifié par commitlint.
3. Ouvrir une pull request en remplissant le template : la checklist sécurité n'est pas optionnelle.
4. La CI doit être verte : format, lint, typecheck, tests unitaires et couverture, build, tests
   d'intégration Testcontainers, image Docker scannée, CodeQL, Trivy et revue des dépendances.
5. Fusion en _squash merge_. `main` est protégée : pas de push direct, checks obligatoires.

## Prérequis

- Node.js 22 (`.nvmrc`), pnpm 10 via Corepack (`corepack enable`)
- Docker pour PostgreSQL, MongoDB et Redis en local et pour les tests d'intégration

## Commandes

| Commande                | Rôle                                                     |
| ----------------------- | -------------------------------------------------------- |
| `pnpm dev`              | API (et console) en mode watch                           |
| `pnpm lint`             | ESLint avec règles typées, zéro avertissement toléré     |
| `pnpm typecheck`        | TypeScript strict                                        |
| `pnpm test:coverage`    | Tests unitaires et HTTP, seuils de couverture à 80 %     |
| `pnpm test:integration` | Adaptateurs PostgreSQL, MongoDB et Redis (Docker requis) |

## Règles de code propres à un produit de sécurité

- Toute donnée externe passe par un schéma Zod ; les schémas de requête sont stricts.
- Toute réponse a un schéma : un champ non déclaré (hash, secret) ne peut pas sortir.
- Les secrets se comparent avec `safeEqual` ; l'aléa vient de `node:crypto`.
- Les adaptateurs d'infrastructure (`*.postgres.ts`, `*.redis.ts`, `*.mongo.ts`) restent fins ;
  la logique vit dans des services testés avec les implémentations en mémoire de `src/testing`.
- Une décision de sécurité difficile à inverser fait l'objet d'un ADR et met à jour le modèle de
  menaces.

## Revue de code

Le relecteur vérifie en priorité : contrôle d'accès de chaque route, validation des entrées,
réponses filtrées, absence de fuite d'information dans les erreurs, audit des actions sensibles,
et mise à jour de la checklist ASVS.
