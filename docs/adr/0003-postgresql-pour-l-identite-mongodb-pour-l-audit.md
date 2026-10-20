# ADR 0003 — PostgreSQL pour l'identité, MongoDB pour l'audit

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

Deux familles de données aux besoins opposés :

| Besoin    | Identités, rôles, clés API | Journal d'audit                     |
| --------- | -------------------------- | ----------------------------------- |
| Intégrité | Contraintes, unicité, FK   | Ajout seul                          |
| Volume    | Faible, stable             | Élevé, croissant                    |
| Schéma    | Stable                     | Variable selon l'événement          |
| Requêtes  | Jointures, transactions    | Filtres sur champs imbriqués, temps |

## Décision

- **PostgreSQL** pour les comptes, rôles, politiques et clés API : transactions, `citext` pour
  l'unicité des e-mails sans tenir compte de la casse, `jsonb` validé pour les conditions de politique.
- **MongoDB** pour `audit_events` : écritures par lots (`insertMany`, `ordered: false`), documents
  au format ECS, index composés et index TTL pour la rétention.
- Le rôle MongoDB de l'API n'a que les droits `insert` et `find` sur la collection d'audit.

## Conséquences

- ✅ Chaque base fait ce qu'elle sait bien faire ; l'audit peut grossir sans peser sur les connexions.
- ✅ Le format ECS rend l'export SIEM direct.
- ⚠️ Deux bases à sauvegarder et à surveiller.
- ⚠️ Pas de transaction entre une modification de compte et son événement d'audit : l'événement est
  écrit après la validation, au mieux une fois (_at-most-once_). Une boîte d'envoi transactionnelle
  (_outbox_) est prévue si l'audit doit devenir exactement une fois.
