const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });

export function formatDateTime(iso: string | null): string {
  return iso ? dateTime.format(new Date(iso)) : '—';
}

/** "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/141" → "Chrome · Windows". */
export function describeUserAgent(userAgent: string): string {
  const browser =
    ['Edg', 'Firefox', 'Chrome', 'Safari'].find((name) => userAgent.includes(`${name}/`)) ??
    'Navigateur';
  const system =
    [
      ['Windows', 'Windows'],
      ['Android', 'Android'],
      ['iPhone', 'iOS'],
      ['Mac OS', 'macOS'],
      ['Linux', 'Linux'],
    ].find(([needle]) => userAgent.includes(needle ?? ''))?.[1] ?? 'système inconnu';
  return `${browser === 'Edg' ? 'Edge' : browser} · ${system}`;
}

export const ACTION_LABELS: Record<string, string> = {
  'user.login': 'Connexion',
  'user.logout': 'Déconnexion',
  'user.locked': 'Compte verrouillé',
  'user.unlocked': 'Compte déverrouillé',
  'security.ip_blocked': 'IP bloquée',
  'user.mfa_enabled': 'MFA activée',
  'user.mfa_disabled': 'MFA désactivée',
  'session.revoked': 'Session révoquée',
  'user.created': 'Compte créé',
  'user.updated': 'Compte modifié',
  'api_key.created': 'Clé API créée',
  'api_key.revoked': 'Clé API révoquée',
  'policy.changed': 'Politique modifiée',
  'authz.decision': "Décision d'accès",
};
