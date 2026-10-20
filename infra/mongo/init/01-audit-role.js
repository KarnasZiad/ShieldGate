// Local development only (docker compose): runs once, when the data volume is created.
//
// The API connects with a role that can insert and read audit events but never update or delete
// them (threat R2). Production uses the same role, provisioned by infrastructure code.
const shieldgate = db.getSiblingDB('shieldgate');

shieldgate.createRole({
  role: 'auditAppendOnly',
  privileges: [
    {
      resource: { db: 'shieldgate', collection: 'audit_events' },
      actions: ['insert', 'find', 'createIndex', 'listIndexes'],
    },
  ],
  roles: [],
});

shieldgate.createUser({
  user: 'shieldgate',
  pwd: 'shieldgate',
  roles: ['auditAppendOnly'],
});
