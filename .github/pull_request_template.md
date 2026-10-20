## Objectif

<!-- Problème résolu, user story ou issue (ex. US-12, #42). -->

## Changements

-

## Comment tester

<!-- Étapes reproductibles pour le relecteur. -->

## Checklist de l'auteur

- [ ] Titre en Conventional Commits (`feat(auth): ...`)
- [ ] Tests ajoutés ou mis à jour ; `pnpm test` et `pnpm lint` passent en local
- [ ] Documentation et ADR mis à jour si une décision change

## Checklist sécurité (ASVS niveau 2)

- [ ] Le [modèle de menaces](https://github.com/KarnasZiad/ShieldGate/blob/main/docs/security/threat-model-stride.md) est-il touché ? Si oui, il est mis à jour
- [ ] Entrées validées par un schéma Zod strict ; réponses filtrées par un schéma de réponse
- [ ] Chaque nouvelle route a son garde (`requireUser`, `requirePermission`, `requireScope`)
- [ ] Les objets d'un autre utilisateur sont introuvables, pas seulement interdits (IDOR)
- [ ] Les actions sensibles écrivent un événement d'audit avec acteur, cible, IP et requête
- [ ] Aucun secret ni donnée personnelle dans les logs, les erreurs ou les fixtures
- [ ] Comparaisons de secrets en temps constant ; aléa cryptographique (`randomBytes`)
- [ ] La [checklist ASVS](https://github.com/KarnasZiad/ShieldGate/blob/main/docs/security/asvs-l2.md) reflète le changement

## Checklist performance

- [ ] Pas de hachage coûteux avant la limitation de débit
- [ ] Les nouvelles requêtes PostgreSQL et MongoDB sont couvertes par un index
- [ ] Rien de bloquant sur le chemin de connexion ou de décision (audit asynchrone)
