# ADR 0001 — Enregistrer les décisions d'architecture

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

Les choix de sécurité d'une plateforme d'identité doivent pouvoir être audités : pourquoi telle
durée de session, pourquoi tel algorithme de hachage, pourquoi tel compromis.

## Décision

Chaque décision structurante est consignée dans un ADR au format de Michael Nygard (contexte,
décision, conséquences, alternatives), versionné avec le code et relu dans la pull request qui
l'introduit. Un ADR accepté n'est jamais réécrit : un nouvel ADR le remplace.

## Conséquences

- Un auditeur ou un nouveau développeur retrouve la justification de chaque mesure de sécurité.
- Le modèle de menaces référence les ADR, et inversement.
