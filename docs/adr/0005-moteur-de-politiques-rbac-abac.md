# ADR 0005 — Moteur de politiques RBAC + ABAC intégré

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

Les applications clientes ont besoin de règles du type « un comptable peut approuver une facture,
sauf la sienne, et seulement depuis le réseau de l'entreprise ». Le RBAC seul ne sait pas exprimer
« sauf la sienne » ni « depuis le réseau » : il faut des attributs (ABAC).

## Décision

Un moteur de politiques intégré, modelé sur IAM et Casbin :

- politiques JSON (`effect`, `actions`, `resources`, `roles`, `condition`) validées par Zod et
  stockées en `jsonb` ;
- opérateurs de condition fermés et typés (`equals`, `in`, `ipInCidr`, `timeBetween`...), sans
  évaluation de code arbitraire ;
- algorithme _deny overrides_ et refus par défaut ;
- chaque décision renvoie la politique responsable, pour l'explicabilité et l'audit.

## Conséquences

- ✅ Aucun langage de règles à apprendre ni d'évaluation dynamique de code (pas de risque d'injection
  dans les règles).
- ✅ Testable exhaustivement : chaque opérateur et l'algorithme de combinaison ont leurs tests.
- ⚠️ Moins expressif que Casbin ou OPA/Rego ; une migration vers OPA reste possible car la requête
  (`subject`, `action`, `resource`, `context`) suit le même modèle.

## Alternatives écartées

- **Casbin** : puissant, mais ses modèles textuels et ses matchers sont plus difficiles à valider en
  entrée et à expliquer à un administrateur.
- **OPA** : excellent, mais un service et un langage (Rego) de plus à exploiter pour une PME.
