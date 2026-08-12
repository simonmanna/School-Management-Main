import { Global, Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { ApprovalPolicyController } from './approval-policy.controller';
import { ApprovalWorkflowController } from './approval-workflow.controller';
import { ApprovalsNotificationsSubscriber } from './approvals-notifications.subscriber';

@Global()
@Module({
  controllers: [ApprovalsController, ApprovalPolicyController, ApprovalWorkflowController],
  providers: [ApprovalsService, ApprovalsNotificationsSubscriber],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
