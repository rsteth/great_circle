import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { GUARD_TABLE, type GuardStore, type StoredCounter } from './guard';
type Sender = Pick<DynamoDBClient, 'send'>;
// Construction/import do not resolve credentials or contact AWS.
export function createDynamoGuardStore(client: Sender = new DynamoDBClient({ region: 'us-east-1', maxAttempts: 1 })): GuardStore {
 const options = (signal: AbortSignal) => ({ abortSignal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) });
 return {
  async read(id, signal) {
   const { Item: item } = await client.send(new GetItemCommand({ TableName: GUARD_TABLE, Key: { pk: { S: id } }, ConsistentRead: true }), options(signal));
   if (!item) return undefined;
   if (!item.state?.S || !item.revision?.N || (id === 'control' && (typeof item.enabled?.BOOL !== 'boolean' || item.expiresAt))) throw new Error('Invalid state');
   const state = JSON.parse(item.state.S);
   if (!state || typeof state !== 'object' || 'revision' in state || !/^(0|[1-9][0-9]*)$/.test(item.revision.N)) throw new Error('Invalid revision');
   const counter = { ...state, revision: Number(item.revision.N) };
   return { counter, ...(id === 'control' ? { enabled: item.enabled.BOOL } : {}) };
  },
  async compareAndSet(id, previous: StoredCounter | undefined, next, signal) {
   const global = id === 'control';
   if (global && !previous) throw new Error('Control must be initialized by operator');
   try {
    await client.send(new PutItemCommand({ TableName: GUARD_TABLE,
     Item: { pk: { S: id }, revision: { N: String(next.counter.revision) }, state: { S: JSON.stringify({ lastAt: next.counter.lastAt, minute: next.counter.minute, hours: next.counter.hours }) }, ...(global ? { enabled: { BOOL: true } } : { expiresAt: { N: String(Math.ceil(next.counter.lastAt / 1000) + 26 * 3600) } }) },
     ConditionExpression: previous ? '#revision = :revision' + (global ? ' AND #enabled = :enabled' : '') : 'attribute_not_exists(pk)',
     ...(previous ? { ExpressionAttributeNames: { '#revision': 'revision', ...(global ? { '#enabled': 'enabled' } : {}) }, ExpressionAttributeValues: { ':revision': { N: String(previous.counter.revision) }, ...(global ? { ':enabled': { BOOL: true } } : {}) } } : {})
    }), options(signal));
    return true;
   } catch (error) { if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false; throw error; }
  }
 };
}
