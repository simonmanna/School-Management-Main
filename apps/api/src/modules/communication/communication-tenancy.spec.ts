import { isOrgScoped } from '../../kernel/prisma/tenancy.extension';

/**
 * Guard: every communication model MUST be tenant-scoped. A model missing from
 * ORG_SCOPED is a cross-tenant leak (another org's messages readable by id), not
 * a bug — this test fails loudly if one is dropped.
 */
describe('communication tenancy scoping', () => {
  const MODELS = [
    'CommunicationChannel',
    'Conversation',
    'ConversationChannel',
    'ExternalIdentity',
    'ConversationParticipant',
    'Message',
    'MessageAttachment',
    'MessageDelivery',
    'ExternalMessage',
    'WhatsAppAuthState',
    'MessageTemplate',
    'CommunicationRule',
  ];

  it.each(MODELS)('%s is org-scoped', (model) => {
    expect(isOrgScoped(model)).toBe(true);
  });
});
