import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { KernelModule } from '../../kernel/kernel.module';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { AccountingModule } from '../accounting/accounting.module';
import { AssetCategoryController } from './controllers/asset-category.controller';
import { AssetController } from './controllers/asset.controller';
import { AssetAcquisitionController } from './controllers/asset-acquisition.controller';
import { AssetAssignmentController } from './controllers/asset-assignment.controller';
import { AssetTransferController } from './controllers/asset-transfer.controller';
import { AssetDepreciationController } from './controllers/asset-depreciation.controller';
import { AssetMaintenanceController } from './controllers/asset-maintenance.controller';
import { AssetRepairController } from './controllers/asset-repair.controller';
import { AssetWarrantyController } from './controllers/asset-warranty.controller';
import { AssetInsuranceController } from './controllers/asset-insurance.controller';
import { AssetInspectionController } from './controllers/asset-inspection.controller';
import { AssetDisposalController } from './controllers/asset-disposal.controller';
import { AssetRevaluationController } from './controllers/asset-revaluation.controller';
import { AssetCheckInOutController } from './controllers/asset-checkinout.controller';
import { AssetDashboardController } from './controllers/asset-dashboard.controller';
import { AssetCategoryService } from './services/asset-category.service';
import { AssetService } from './services/asset.service';
import { AssetAcquisitionService } from './services/asset-acquisition.service';
import { AssetAssignmentService } from './services/asset-assignment.service';
import { AssetTransferService } from './services/asset-transfer.service';
import { AssetDepreciationService } from './services/asset-depreciation.service';
import { AssetDepreciationStrategy } from './services/asset-depreciation.strategy';
import { AssetMaintenanceService } from './services/asset-maintenance.service';
import { AssetRepairService } from './services/asset-repair.service';
import { AssetWarrantyService } from './services/asset-warranty.service';
import { AssetInsuranceService } from './services/asset-insurance.service';
import { AssetInspectionService } from './services/asset-inspection.service';
import { AssetDisposalService } from './services/asset-disposal.service';
import { AssetRevaluationService } from './services/asset-revaluation.service';
import { AssetCheckInOutService } from './services/asset-checkinout.service';
import { AssetDashboardService } from './services/asset-dashboard.service';

@Module({
  imports: [KernelModule, AccountingModule],
  controllers: [
    AssetCategoryController,
    AssetController,
    AssetAcquisitionController,
    AssetAssignmentController,
    AssetTransferController,
    AssetDepreciationController,
    AssetMaintenanceController,
    AssetRepairController,
    AssetWarrantyController,
    AssetInsuranceController,
    AssetInspectionController,
    AssetDisposalController,
    AssetRevaluationController,
    AssetCheckInOutController,
    AssetDashboardController,
  ],
  providers: [
    AssetCategoryService,
    AssetService,
    AssetAcquisitionService,
    AssetAssignmentService,
    AssetTransferService,
    AssetDepreciationService,
    AssetDepreciationStrategy,
    AssetMaintenanceService,
    AssetRepairService,
    AssetWarrantyService,
    AssetInsuranceService,
    AssetInspectionService,
    AssetDisposalService,
    AssetRevaluationService,
    AssetCheckInOutService,
    AssetDashboardService,
  ],
  exports: [
    AssetService,
    AssetCategoryService,
    AssetDepreciationService,
  ],
})
export class FixedAssetModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'fixed-asset',
      version: '1.0.0',
      dependencies: ['accounting'],
      permissions: [
        ...Object.values(PERMISSIONS.fixedAsset),
        ...Object.values(PERMISSIONS.assetCategory),
        ...Object.values(PERMISSIONS.assetDepreciation),
        ...Object.values(PERMISSIONS.assetReport),
      ],
    });
  }
}
