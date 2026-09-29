import { Module } from '@nestjs/common';
import { CertificateService, ExternalExamResultService, TranscriptService } from './cert.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { PlacementLookupModule } from '../enrollment/placement-lookup.module';
import { FeesModule } from '../fees/fees.module';
import {
  CertificateController,
  CertificateVerifyController,
  ExternalExamResultController,
  TranscriptController,
} from './cert.controller';

/**
 * Certification (A6): transcripts (rollup of the published result spine),
 * external UNEB results, and issued certificates with public verification.
 * SequenceService is global (KernelModule) so certificate serials need no extra import.
 */
@Module({
  imports: [PlacementLookupModule, FeesModule],
  controllers: [TranscriptController, ExternalExamResultController, CertificateController, CertificateVerifyController],
  providers: [TranscriptService, ExternalExamResultService, CertificateService, CertificatePdfService],
  exports: [TranscriptService, ExternalExamResultService, CertificateService],
})
export class CertificationModule {}
