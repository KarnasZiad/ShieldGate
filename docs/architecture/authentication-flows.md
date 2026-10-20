# Flux d'authentification

## Connexion avec MFA

```mermaid
sequenceDiagram
  participant B as Navigateur
  participant A as API
  participant R as Redis
  participant P as PostgreSQL
  participant M as MongoDB

  B->>A: POST /v1/auth/login {email, password}
  A->>R: IP bloquée ? compte verrouillé ?
  A->>P: SELECT user WHERE email = $1
  A->>A: Argon2id verify (hash factice si compte inconnu)
  alt échec
    A->>R: INCR échecs du compte, PFADD comptes tentés par l'IP
    A--)M: audit user.login failure (asynchrone)
    A-->>B: 401 "E-mail ou mot de passe incorrect"
  else MFA activée
    A->>R: SET défi MFA (5 min)
    A-->>B: 200 {mfaRequired, challengeId}
    B->>A: POST /v1/auth/mfa {challengeId, code}
    A->>A: TOTP ±1 pas, pas déjà utilisé ?
    A->>P: UPDATE mfa_last_used_step
  end
  A->>R: SET session (nouvel identifiant), SADD sessions de l'utilisateur
  A--)M: audit user.login success
  A-->>B: 200 + Set-Cookie __Host-sg_session ; jeton CSRF dans le corps
```

## Session

| Propriété   | Valeur                                                                     |
| ----------- | -------------------------------------------------------------------------- |
| Identifiant | 256 bits aléatoires, en base64url                                          |
| Stockage    | Redis, sous l'empreinte SHA-256 de l'identifiant                           |
| Expiration  | 30 minutes d'inactivité, 12 heures au maximum                              |
| Cookie      | `__Host-sg_session` ; `Secure` ; `HttpOnly` ; `SameSite=Strict` ; `Path=/` |
| CSRF        | Jeton de synchronisation lié à la session + contrôle de l'en-tête `Origin` |

L'API ne garde aucune session en mémoire : chaque requête lit Redis. Supprimer la clé suffit donc à
révoquer une session sur toutes les instances, à la requête suivante. Un message est aussi publié
sur le canal `sg:sessions:revoked` pour les composants qui mettraient des sessions en cache.

## Verrouillage et bourrage d'identifiants

| Mécanisme               | Clé Redis                              | Seuil                   | Effet              |
| ----------------------- | -------------------------------------- | ----------------------- | ------------------ |
| Limitation par IP       | `@fastify/rate-limit`                  | 10 connexions / minute  | 429                |
| Verrouillage du compte  | `sg:login:fail:<empreinte e-mail>`     | 5 échecs / 15 minutes   | Refus 15 minutes   |
| Bourrage d'identifiants | `sg:login:accounts:<ip>` (HyperLogLog) | 10 comptes / 10 minutes | IP bloquée 1 heure |

Le verrouillage répond exactement comme un mauvais mot de passe : un attaquant ne peut pas s'en
servir pour savoir qu'un compte existe. L'utilisateur légitime en est informé par l'audit et, en
v2, par e-mail.

## Clés API

```text
sg_live_<préfixe 8 caractères>_<secret 32 octets en base64url>
```

- Le préfixe, public, sert à retrouver la clé en base sans parcourir toute la table.
- Seul `HMAC-SHA256(secret, pepper)` est stocké. Le _pepper_ vit dans la configuration, pas en
  base : une fuite de la base seule ne permet pas de tester des secrets.
- La comparaison se fait en temps constant (`timingSafeEqual`).
