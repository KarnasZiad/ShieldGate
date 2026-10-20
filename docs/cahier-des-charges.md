# Cahier des charges — ShieldGate

## 1. Contexte

Une PME qui développe plusieurs applications (back-office, application mobile, API partenaires)
finit souvent avec autant de systèmes de connexion que d'applications : mots de passe stockés de
façons différentes, pas de MFA, droits codés en dur, aucune trace de qui a fait quoi. Les solutions
SaaS (Auth0, Okta) règlent le problème mais coûtent cher et hébergent les données hors du pays, ce
que la loi 09-08 et les clients publics marocains regardent de près.

ShieldGate est une **plateforme d'identité auto-hébergée** : un point central d'authentification,
d'autorisation et d'audit que toutes les applications de l'entreprise utilisent.

## 2. Objectifs

| Objectif                                  | Indicateur de succès                                           |
| ----------------------------------------- | -------------------------------------------------------------- |
| Centraliser l'authentification            | Une seule base d'identités, connexion unique (SSO) en v2       |
| Résister aux attaques courantes           | Checklist OWASP ASVS niveau 2 suivie et vérifiée par des tests |
| Révoquer un accès immédiatement           | Une session révoquée est refusée à la requête suivante         |
| Tracer chaque action sensible             | 100 % des événements d'authentification journalisés            |
| Externaliser les décisions d'autorisation | Les applications appellent `POST /v1/authorize`                |

## 3. Acteurs

| Acteur                  | Description                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| **Utilisateur final**   | Se connecte, active la MFA, consulte et ferme ses sessions       |
| **Administrateur**      | Gère les comptes, les rôles et les clés API, consulte l'audit    |
| **Application cliente** | Authentifie ses utilisateurs et délègue ses décisions d'accès    |
| **Analyste sécurité**   | Exploite le journal d'audit, exporté vers le SIEM en v2          |
| _Attaquant_             | Bourrage d'identifiants, vol de session, élévation de privilèges |

## 4. Périmètre

### MVP (v1)

- Comptes utilisateurs avec mots de passe Argon2id et politique de mots de passe NIST 800-63B.
- Connexion par session opaque stockée dans Redis, révocable en temps réel.
- Verrouillage progressif des comptes et détection du bourrage d'identifiants (_credential stuffing_).
- MFA par TOTP (RFC 6238), secret chiffré au repos (AES-256-GCM).
- Clés API pour les applications, avec portées (_scopes_) et expiration.
- Moteur de politiques RBAC + ABAC et point de décision `POST /v1/authorize`.
- Journal d'audit dans MongoDB, au format inspiré d'Elastic Common Schema (ECS).
- Console d'administration Vue 3.

### v2

- OAuth 2.1 et OpenID Connect (`oidc-provider`) : SSO pour les applications clientes.
- Clés matérielles et passkeys (WebAuthn).
- Rotation des clés de signature exposées en JWKS.

### Extensions

- Détection d'anomalies : nouveau pays, « voyage impossible ».
- Export SIEM (Syslog, ECS), SDK npm `@shieldgate/client`, connexion Google et GitHub.

## 5. Exigences fonctionnelles

| ID    | Exigence                                                                                   | Priorité |
| ----- | ------------------------------------------------------------------------------------------ | -------- |
| EF-01 | Une connexion échouée ne révèle jamais si le compte existe                                 | Must     |
| EF-02 | Après 5 échecs en 15 minutes, le compte est temporairement verrouillé                      | Must     |
| EF-03 | Une adresse IP qui échoue sur plus de 10 comptes différents est bloquée une heure          | Must     |
| EF-04 | Un utilisateur voit ses sessions actives et peut en fermer une ; l'effet est immédiat      | Must     |
| EF-05 | Un code TOTP ne peut être utilisé qu'une fois                                              | Must     |
| EF-06 | Une clé API n'est affichée qu'à sa création ; seule son empreinte est stockée              | Must     |
| EF-07 | Toute décision d'autorisation est refusée par défaut ; une règle `deny` l'emporte toujours | Must     |
| EF-08 | Chaque connexion, échec, verrouillage, changement de droits et révocation est journalisé   | Must     |
| EF-09 | SSO OpenID Connect pour les applications clientes                                          | Should   |

## 6. Exigences non fonctionnelles

| Catégorie     | Exigence                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------- |
| Sécurité      | OWASP ASVS niveau 2 ; modèle de menaces STRIDE maintenu à chaque nouvelle fonctionnalité |
| Sécurité      | En-têtes CSP, HSTS, protection CSRF, cookies `__Host-` `Secure` `HttpOnly` `SameSite`    |
| Sécurité      | Scans CodeQL, Trivy et OWASP ZAP dans la CI ; dépendances épinglées et revues            |
| Performance   | Vérification de session inférieure à 5 ms (Redis) ; `POST /v1/authorize` p95 < 20 ms     |
| Disponibilité | L'écriture du journal d'audit ne bloque jamais une connexion                             |
| Exploitation  | Logs JSON (Pino) sans secret ; healthchecks PostgreSQL, MongoDB et Redis                 |
| Qualité       | TypeScript strict, couverture supérieure à 80 %, revue obligatoire avant fusion          |

## 7. Jalons

| Jalon | Contenu                                                            |
| ----- | ------------------------------------------------------------------ |
| J1    | Socle, modèle de menaces, comptes, sessions, verrouillage, audit   |
| J2    | MFA TOTP, clés API, moteur de politiques, console d'administration |
| J3    | OpenID Connect, WebAuthn, JWKS                                     |
| J4    | Kubernetes (Helm), tests de charge k6, pentest automatisé ZAP      |
