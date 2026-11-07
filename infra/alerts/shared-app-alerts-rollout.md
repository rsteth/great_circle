# Shared operational-alert destination proposal

Status, November 7, 2026: the shared alert infrastructure has been created and verified. Email subscription confirmation and notification delivery verification remain pending; alerts must not yet be described as reaching their destination. The approved recipient remains a deployment parameter, not a source default.

## Ownership and scope

Create one separately owned CloudFormation stack, proposed name `stethem-app-alerts`, in the verified account ending 6476, us-east-1. Its SNS topic has the same name. Great Circle, Reads and Bandit app stacks reference the verified TopicArn as an input. They do not create or replace a topic, email subscription or publication policy.

The deployment recipient is the exact address selected by the user, passed as the required AlertEmail parameter. Do not assume it is a personal address or reuse it for unrelated communications. The source deliberately has no default address.

The shared stack retains the topic, subscription and policy if an app stack is removed or the shared stack is deleted. Deliberate final cleanup remains an explicit operator decision; do not recreate retained resources blindly.

## Publication policy

The topic allows SNS Publish from CloudWatch only, with both:
- aws:SourceAccount equal to the verified account;
- aws:SourceArn matching one of the same-account, same-region alarm prefixes:
  - great-circle-routing-*
  - reads-alerts-*
  - bandit-alerts-*

The shared topic adds no app runtime privileges, credential access, cross-account publishing or public subscription permission. Future alarm-prefix or publisher changes require separate review. In particular, the current proposal does not grant AWS Budgets permission or create a billing monitor.

## Recipient confirmation and content

SNS sends one confirmation email after subscription creation. All three apps can then use that confirmed destination. Until the subscription is confirmed and a non-sensitive test alert is verified, do not claim that notifications are operational.

If the approved mailbox is connected and available for this task, its matching confirmation can be handled within the user's authorization. Otherwise someone with access to that mailbox must use the SNS confirmation link. Never request mailbox passwords in chat.

Alerts contain operational status, metric names/counts, resource identifiers and approved cost summaries only. They must not include API keys, tokens, raw IP addresses, route coordinates, article text, user content or request bodies. No SMS subscription is proposed.

The topic uses standard SNS storage protection and HTTPS API transport, without optional customer-managed KMS message encryption. This avoids surprise KMS permissions and cross-service delivery failures. It is not end-to-end encrypted email. If stronger message encryption is desired, review the exact KMS key policy and service grants separately.

## Costs and validation

There is no per-topic standing charge. Standard SNS request/email-delivery charges are usage-based and normally tiny at alert volumes; account-wide allowances may cover them. App metric/alarm charges are separate and must not be represented as one shared $1 price for all three apps.

Great Circle's package is two custom metrics and four standard alarm metrics, approximately $1/month before shared allowances. Reads and Bandit retain their own approved metric/alert designs and cost estimates.

Read-only checks found the proposed SNS topic name unused. AWS accepted both final shared/app template structures and the synthetic alert-filter patterns, including the expanded service-failure filter. Tests confirmed that normal budget denial and expected unroutable labels are excluded from the error metric. Infrastructure validation does not prove real delivery.

## Billing coverage

Read-only November 7 checks found no AWS Budgets objects and no AWS/Billing CloudWatch alarms in us-east-1. Cost Anomaly Detection inventory was denied because Cost Explorer is not enabled; it was not enabled or bypassed.

One account-wide notification-only monthly budget is preferable to unverified per-app tagged-cost alarms until cost-allocation tags are checked. It requires a user-chosen alert threshold and separate exact policy/resource approval. Do not invent a spending cap. AWS Budgets monitoring/notifications are free, but updates are delayed, typically 8–12 hours. An alert threshold does not stop spending. No billing resources are in this proposal.

## Rollout and rollback

1. Obtain approval for this exact shared topic, source restrictions and selected email destination.
2. Inspect the CloudFormation change set and create only these three SNS resources.
3. Confirm the email subscription, inspect the effective policy, and verify a non-sensitive test notification.
4. Give each app the verified TopicArn and apply only its separately approved monitoring package.
5. Verify actual alarm delivery without including user content.

If one app's alarm configuration needs rollback, modify only that app's alarms. Do not delete the shared subscription or broaden the topic policy. If notification delivery fails, keep app protections independent of notification success and report the failure honestly.

Sources:
- https://docs.aws.amazon.com/sns/latest/dg/sns-data-encryption.html
- https://www.repost.aws/knowledge-center/cloudwatch-receive-sns-for-alarm-trigger
- https://aws.amazon.com/sns/faqs/
- https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/
- https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html
