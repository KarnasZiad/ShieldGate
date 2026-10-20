# Modèle d'autorisation : RBAC + ABAC

ShieldGate sert de **PDP** (_Policy Decision Point_) : les applications lui demandent si une action
est autorisée, et appliquent la réponse (_Policy Enforcement Point_). La console d'administration
est elle-même protégée par ce moteur.

## Requête et décision

```json
{
  "subject": { "id": "u-42", "roles": ["accountant"], "attributes": { "department": "finance" } },
  "action": "invoice:approve",
  "resource": {
    "type": "invoice",
    "id": "inv-7",
    "attributes": { "ownerId": "u-42", "amount": 12000 }
  },
  "context": { "ip": "10.0.4.12", "time": "2026-10-20T09:30:00Z" }
}
```

```json
{ "decision": "deny", "policyId": "no-self-approval", "reason": "deny policy matched" }
```

## Politiques

Une politique combine un **rôle** (RBAC) et une **condition sur des attributs** (ABAC) :

```json
{
  "id": "no-self-approval",
  "effect": "deny",
  "actions": ["invoice:approve"],
  "resources": ["invoice:*"],
  "condition": { "equals": [{ "ref": "resource.attributes.ownerId" }, { "ref": "subject.id" }] }
}
```

| Élément     | Syntaxe                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `actions`   | `ressource:verbe`, joker accepté : `invoice:*`, `*`                                       |
| `resources` | `type:id`, joker accepté : `invoice:*`                                                    |
| `roles`     | Optionnel ; la politique ne s'applique qu'aux sujets ayant l'un de ces rôles              |
| `condition` | `all`, `any`, `not`, `equals`, `in`, `greaterThan`, `lessThan`, `ipInCidr`, `timeBetween` |

Les opérandes sont des littéraux ou des références `{ "ref": "subject.attributes.department" }`.
Une référence absente rend la comparaison fausse : jamais d'autorisation par accident.

## Algorithme

1. Garder les politiques dont l'action, la ressource et le rôle correspondent.
2. Évaluer leur condition.
3. **Si une politique `deny` correspond, refuser** (_deny overrides_).
4. Sinon, si une politique `allow` correspond, autoriser.
5. Sinon, refuser (_default deny_).

La décision et la politique responsable sont journalisées, ce qui permet d'expliquer chaque refus.

## Pourquoi pas Casbin ?

Voir l'[ADR 0005](../adr/0005-moteur-de-politiques-rbac-abac.md) : le moteur fait environ 200 lignes,
ses politiques sont des documents JSON validés par Zod (stockés en JSONB), et chaque opérateur est
couvert par des tests. Casbin reste une option si les besoins dépassent ce modèle.
