import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const proposal = JSON.parse(readFileSync(new URL('../infra/lambda/routing-guard.proposed.json', import.meta.url), 'utf8'));
const resources = proposal.Resources;

describe('routing guard infrastructure proposal (offline only)', () => {
  it('targets only the approved account and region, without deploying code or touching secrets/network access', () => {
    expect(proposal.Parameters.ExpectedAccountId.AllowedValues).toEqual(['089089716476']);
    expect(JSON.stringify(proposal.Conditions)).toContain('us-east-1');
    for (const resource of Object.values(resources) as any[]) expect(resource.Condition).toBe('TargetConfirmed');
    const types = (Object.values(resources) as any[]).map(r => r.Type);
    expect(types).not.toContain('AWS::Lambda::Function');
    expect(types).not.toContain('AWS::Lambda::Url');
    expect(types).not.toContain('AWS::SSM::Parameter');
    expect(types).not.toContain('AWS::IAM::Role');
  });

  it('keeps a small encrypted table with bounded throughput and no accidental deletion', () => {
    const table = resources.RoutingGuardTable;
    expect(table.Properties.TableName).toBe('great-circle-prod-routing-guard');
    expect(table.Properties.BillingMode).toBe('PAY_PER_REQUEST');
    expect(table.Properties.KeySchema).toEqual([{ AttributeName: 'pk', KeyType: 'HASH' }]);
    expect(table.Properties.TimeToLiveSpecification).toEqual({ AttributeName: 'expiresAt', Enabled: true });
    expect(table.Properties.SSESpecification.SSEEnabled).toBe(true);
    expect(table.Properties.OnDemandThroughput).toEqual({ MaxReadRequestUnits: 20, MaxWriteRequestUnits: 20 });
    expect(table.Properties.DeletionProtectionEnabled).toBe(true);
    expect(table.DeletionPolicy).toBe('Retain');
    expect(table.UpdateReplacePolicy).toBe('Retain');
  });

  it('adds only exact-table reads and compare-and-swap writes to the runtime role', () => {
    const policy = resources.RuntimeGuardPolicy.Properties;
    expect(policy.Roles).toEqual(['great-circle-prod-runtime']);
    expect(policy.PolicyDocument.Statement).toEqual([{
      Sid: 'ReadAndCasExactGuardTable', Effect: 'Allow',
      Action: ['dynamodb:GetItem', 'dynamodb:PutItem'],
      Resource: { 'Fn::GetAtt': ['RoutingGuardTable', 'Arn'] },
    }]);
    expect(JSON.stringify(policy)).not.toContain('ssm:');
    expect(JSON.stringify(policy)).not.toContain('iam:');
  });

  it('keeps app monitoring low-cardinality and references the shared destination only', () => {
    expect(proposal.Parameters.AlertTopicArn.AllowedValues).toEqual(['arn:aws:sns:us-east-1:089089716476:stethem-app-alerts']);
    expect(proposal.Parameters.AlertEmail).toBeUndefined();
    expect((Object.values(resources) as any[]).some(r => r.Type.startsWith('AWS::SNS::'))).toBe(false);
    for (const name of ['BudgetMetric', 'ErrorMetric']) {
      const filter = resources[name].Properties;
      expect(filter.LogGroupName).toBe('/aws/lambda/great-circle-api');
      expect(filter.FilterPattern).toContain('$.message.event');
      expect(filter.MetricTransformations).toHaveLength(1);
      expect(filter.MetricTransformations[0].Dimensions).toBeUndefined();
    }
    expect(resources.BudgetMetric.Properties.FilterPattern).toContain('$.message.scope = "global"');
    expect(resources.BudgetMetric.Properties.FilterPattern).toContain('"near_budget"');
    expect(resources.BudgetMetric.Properties.FilterPattern).toContain('"budget_block"');
    expect(resources.ErrorMetric.Properties.MetricTransformations[0].MetricName).toBe('RoutingErrors');
    for (const reason of ['guard_error', 'secret_unavailable', 'ors_unavailable', 'ors_timeout']) {
      expect(resources.ErrorMetric.Properties.FilterPattern).toContain('"' + reason + '"');
    }
    const alarms = (Object.values(resources) as any[]).filter(r => r.Type === 'AWS::CloudWatch::Alarm');
    expect(alarms).toHaveLength(4);
    for (const alarm of alarms) {
      expect(alarm.Properties.AlarmActions).toEqual([{ Ref: 'AlertTopicArn' }]);
      expect(alarm.Properties.TreatMissingData).toBe('notBreaching');
      expect(alarm.Properties.Period).toBe(300);
    }
  });

  it('owns the single email destination separately from all three app stacks', () => {
    const shared = JSON.parse(readFileSync(new URL('../infra/alerts/shared-app-alerts.proposed.json', import.meta.url), 'utf8'));
    expect(shared.Parameters.ExpectedAccountId.AllowedValues).toEqual(['089089716476']);
    expect(shared.Parameters.AlertEmail.Default).toBeUndefined();
    expect(Object.keys(shared.Resources)).toEqual(['AlertTopic', 'AlertTopicPolicy', 'AlertSubscription']);
    expect(shared.Resources.AlertTopic.Properties.TopicName).toBe('stethem-app-alerts');
    expect(shared.Resources.AlertSubscription.Properties).toEqual({
      TopicArn: { Ref: 'AlertTopic' }, Protocol: 'email', Endpoint: { Ref: 'AlertEmail' },
    });
    for (const resource of Object.values(shared.Resources) as any[]) {
      expect(resource.Condition).toBe('TargetConfirmed');
      expect(resource.DeletionPolicy).toBe('Retain');
      expect(resource.UpdateReplacePolicy).toBe('Retain');
    }
    expect(shared.Resources.AlertTopic.Properties.KmsMasterKeyId).toBeUndefined();
  });

  it('permits only same-account CloudWatch alarms from the three approved app prefixes', () => {
    const shared = JSON.parse(readFileSync(new URL('../infra/alerts/shared-app-alerts.proposed.json', import.meta.url), 'utf8'));
    const statements = shared.Resources.AlertTopicPolicy.Properties.PolicyDocument.Statement;
    expect(statements).toHaveLength(1);
    const statement = statements[0];
    expect(statement.Principal).toEqual({ Service: 'cloudwatch.amazonaws.com' });
    expect(statement.Action).toBe('sns:Publish');
    expect(statement.Resource).toEqual({ Ref: 'AlertTopic' });
    expect(statement.Condition.StringEquals['aws:SourceAccount']).toEqual({ Ref: 'AWS::AccountId' });
    expect(statement.Condition.ArnLike['aws:SourceArn'].map((x: any) => x['Fn::Sub'])).toEqual([
      'arn:${AWS::Partition}:cloudwatch:${AWS::Region}:${AWS::AccountId}:alarm:great-circle-routing-*',
      'arn:${AWS::Partition}:cloudwatch:${AWS::Region}:${AWS::AccountId}:alarm:reads-alerts-*',
      'arn:${AWS::Partition}:cloudwatch:${AWS::Region}:${AWS::AccountId}:alarm:bandit-alerts-*',
    ]);
    expect(JSON.stringify(shared)).not.toContain('budgets.amazonaws.com');
    expect(JSON.stringify(shared)).not.toContain('kms:');
    expect(JSON.stringify(shared)).not.toContain('"Protocol":"sms"');
  });

});
