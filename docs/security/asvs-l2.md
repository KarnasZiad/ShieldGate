# Vérification OWASP ASVS 4.0.3 — niveau 2

État au 20 octobre 2026, version 0.1. Chaque exigence marquée ✅ est couverte par du code **et** par
au moins un test automatisé cité. Légende : ✅ conforme · 🟡 partiel · ⏳ planifié · — non applicable.

## V2 — Authentification

| ID    | Exigence (résumé)                                     | État | Preuve                                                                  |
| ----- | ----------------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| 2.1.1 | Mots de passe d'au moins 12 caractères                | ✅   | `users/password-policy.ts` · `password-policy.spec.ts`                  |
| 2.1.2 | 64 caractères acceptés, plus de 128 refusés           | ✅   | `MAX_PASSWORD_LENGTH = 128` · `password-policy.spec.ts`                 |
| 2.1.3 | Aucune troncature                                     | ✅   | Normalisation NFKC sans troncature · `password-hasher.spec.ts`          |
| 2.1.4 | Tout caractère Unicode imprimable accepté             | ✅   | Phrases de passe en arabe et en français · `password-policy.spec.ts`    |
| 2.1.7 | Refus des mots de passe compromis                     | 🟡   | Liste noire locale ; API Have I Been Pwned (k-anonymat) planifiée       |
| 2.1.9 | Aucune règle de composition                           | ✅   | `checkPassword` n'impose ni majuscule ni symbole                        |
| 2.2.1 | Anti-automatisation : limitation, verrouillage        | ✅   | Rate limit, verrouillage, détection de stuffing · `auth.routes.spec.ts` |
| 2.2.3 | Notification des changements d'authentification       | ⏳   | Envoi d'e-mails prévu en v2 ; événements déjà audités                   |
| 2.4.1 | Mots de passe hachés avec une fonction lente et salée | ✅   | Argon2id 19 Mio, t=2 · `password-hasher.spec.ts`                        |
| 2.5.x | Récupération de compte                                | ⏳   | Pas encore de réinitialisation en libre-service                         |
| 2.8.1 | OTP à durée de vie définie                            | ✅   | Pas de 30 s, tolérance ±1 · `totp.spec.ts`                              |
| 2.8.3 | Algorithmes approuvés pour l'OTP                      | ✅   | HMAC RFC 4226/6238, vecteurs officiels · `totp.spec.ts`                 |
| 2.8.4 | Un OTP n'est utilisable qu'une fois                   | ✅   | `recordTotpStep` atomique · `mfa.routes.spec.ts`, test d'intégration    |
| 2.8.5 | Réutilisation d'OTP refusée et journalisée            | ✅   | Échec audité `invalid_mfa_code` · `mfa.routes.spec.ts`                  |
| 2.9.x | Vérificateurs cryptographiques (WebAuthn)             | ⏳   | Passkeys prévues en v2                                                  |

## V3 — Gestion des sessions

| ID      | Exigence (résumé)                                                     | État | Preuve                                                            |
| ------- | --------------------------------------------------------------------- | ---- | ----------------------------------------------------------------- |
| 3.1.1   | Jeton de session jamais dans l'URL                                    | ✅   | Cookie uniquement                                                 |
| 3.2.1   | Nouveau jeton à chaque authentification                               | ✅   | Anti-fixation · `auth.routes.spec.ts`                             |
| 3.2.2   | Au moins 64 bits d'entropie                                           | ✅   | 256 bits · `session-store.redis.ts`                               |
| 3.2.3   | Stockage navigateur sécurisé                                          | ✅   | Cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`         |
| 3.3.1   | La déconnexion invalide la session côté serveur                       | ✅   | `auth.routes.spec.ts`                                             |
| 3.3.2   | Expiration d'inactivité et durée absolue                              | ✅   | 30 min / 12 h · `auth.routes.spec.ts`                             |
| 3.3.3   | Fermer les autres sessions après un changement d'identifiants         | 🟡   | Révocation manuelle possible ; changement de mot de passe à venir |
| 3.3.4   | L'utilisateur voit et ferme ses sessions                              | ✅   | `GET/DELETE /v1/me/sessions` · `me.routes.spec.ts`                |
| 3.4.1–5 | Attributs `Secure`, `HttpOnly`, `SameSite`, préfixe `__Host-`, `Path` | ✅   | `auth.routes.spec.ts`                                             |
| 3.7.1   | Réauthentification avant une action sensible                          | 🟡   | Mot de passe exigé pour désactiver la MFA ; à étendre             |

## V4 — Contrôle d'accès

| ID    | Exigence (résumé)                                       | État | Preuve                                                              |
| ----- | ------------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| 4.1.1 | Contrôle appliqué côté serveur                          | ✅   | Gardes `requirePermission` · `users.routes.spec.ts`                 |
| 4.1.2 | Attributs de contrôle non modifiables par l'utilisateur | ✅   | Rôles et permissions dans la session serveur                        |
| 4.1.3 | Moindre privilège                                       | ✅   | Rôles `admin`, `security-analyst`, `member`                         |
| 4.1.5 | Échec sécurisé                                          | ✅   | Refus par défaut, logique à trois valeurs · `policy-engine.spec.ts` |
| 4.2.1 | Protection contre les IDOR                              | ✅   | Session d'un autre utilisateur introuvable · `me.routes.spec.ts`    |
| 4.2.2 | Protection CSRF                                         | ✅   | Origin + jeton de synchronisation · `auth.routes.spec.ts`           |
| 4.3.1 | MFA pour les interfaces d'administration                | 🟡   | MFA disponible ; obligation pour les administrateurs à venir        |

## V5 — Validation et encodage

| ID    | Exigence (résumé)                            | État | Preuve                                                           |
| ----- | -------------------------------------------- | ---- | ---------------------------------------------------------------- |
| 5.1.1 | Protection contre la pollution de paramètres | ✅   | Schémas Zod stricts · `audit.routes.spec.ts`                     |
| 5.1.3 | Validation positive de toutes les entrées    | ✅   | Un schéma Zod par corps, requête et paramètre                    |
| 5.3.4 | Requêtes SQL paramétrées                     | ✅   | `pg` avec paramètres ; `LIKE` échappé · test d'intégration       |
| 5.3.x | Injection NoSQL                              | ✅   | Filtres MongoDB construits côté serveur · `audit.routes.spec.ts` |

## V7 — Journalisation et erreurs

| ID    | Exigence (résumé)                                   | État | Preuve                                                                |
| ----- | --------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| 7.1.1 | Ni identifiants ni jetons dans les logs             | ✅   | Redaction Pino · `app.spec.ts`                                        |
| 7.1.3 | Événements de sécurité journalisés                  | 🟡   | Authentification, MFA, droits, clés, politiques ; refus 403 à ajouter |
| 7.1.4 | Horodatage, IP, utilisateur, identifiant de requête | ✅   | Format ECS · `audit-logger.spec.ts`                                   |
| 7.3.3 | Journal protégé contre la modification              | ✅   | Rôle MongoDB `insert` + `find` uniquement · `infra/mongo/init`        |
| 7.4.1 | Message d'erreur générique avec identifiant         | ✅   | `application/problem+json` + `x-request-id` · `app.spec.ts`           |

## V13 — API et V14 — Configuration

| ID       | Exigence (résumé)                                     | État | Preuve                                                          |
| -------- | ----------------------------------------------------- | ---- | --------------------------------------------------------------- |
| 13.1.3   | Pas de secret dans les URL                            | ✅   | Clés API en en-tête `Authorization`                             |
| 13.2.5   | Type de contenu validé                                | ✅   | Fastify refuse les types inattendus (415)                       |
| 14.2.1   | Composants à jour, vulnérabilités suivies             | ✅   | Dependabot, Trivy, revue des dépendances en PR                  |
| 14.2.3   | Dépendances de CI épinglées                           | ✅   | Actions GitHub épinglées par SHA                                |
| 14.3.2   | Pas de mode debug en production                       | ✅   | Documentation OpenAPI absente en production · `openapi.spec.ts` |
| 14.4.3   | En-tête CSP                                           | ✅   | `default-src 'none'` · `app.spec.ts`                            |
| 14.4.4–7 | `nosniff`, HSTS, `Referrer-Policy`, `frame-ancestors` | ✅   | `app.spec.ts`                                                   |
| 14.5.3   | CORS restreint à une liste d'origines                 | ✅   | `app.spec.ts`                                                   |

## Prochaines actions

1. Rendre la MFA obligatoire pour toute session portant une permission d'administration (4.3.1).
2. Auditer les refus d'autorisation 403 (7.1.3).
3. Vérification des mots de passe compromis par k-anonymat (2.1.7).
4. Réinitialisation de mot de passe et notifications par e-mail (2.5, 2.2.3).
5. Scan dynamique OWASP ZAP dans la CI, rapport publié dans le README.
