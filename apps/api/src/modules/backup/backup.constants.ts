import { BackupFrequency, BackupType, CompressionLevel, DestinationType, EncryptionType, InternetBehaviour, RetentionMode } from './backup.dto';

export const BACKUP_SETTING_KEY = 'backup.config';

// Auto-detect PostgreSQL bin directory on Windows
function detectPgBin(): string {
  if (process.platform !== 'win32') return '/usr/bin';
  
  const basePaths = [
    'C:\\Program Files\\PostgreSQL',
    'C:\\Program Files (x86)\\PostgreSQL',
  ];
  
  // Check common version directories (16, 17, 18, 15, 14, 13)
  const versions = ['18', '17', '16', '15', '14', '13', '12'];
  
  for (const base of basePaths) {
    for (const version of versions) {
      const binPath = `${base}\\${version}\\bin`;
      try {
        const fs = require('fs');
        if (fs.existsSync(binPath) && fs.existsSync(`${binPath}\\pg_dump.exe`)) {
          return binPath;
        }
      } catch { }
    }
  }
  
  // Fallback to default
  return 'C:\\Program Files\\PostgreSQL\\18\\bin';
}

export const PG_BIN_DEFAULT = process.env.PG_BIN || detectPgBin();

export const BACKUP_DEFAULTS = {
  frequency: BackupFrequency.Daily,
  dailyConfig: { times: ['02:00'] },
  weeklyConfig: { days: [0], time: '03:00' },
  customCronExpression: '',
  customIntervalMinutes: 60,
  types: [BackupType.Full],
  includes: {
    database: true,
    schemaOnly: false,
    databaseData: true,
    uploadedImages: true,
    productImages: true,
    customerDocuments: true,
    generatedReports: false,
    attachments: false,
    envFile: true,
    configFiles: true,
    posSettings: true,
    orgSettings: true,
    printerConfig: true,
    receiptTemplates: true,
    kitchenPrinterSettings: true,
    logs: false,
    auditLogs: false,
    scheduledTasks: false,
  },
  destinations: [
    { type: DestinationType.Local, path: process.env.BACKUP_DIR || 'backup', label: 'Local Backup', enabled: true },
  ],
  retention: {
    mode: RetentionMode.KeepLast,
    keepLastCount: 14,
    keepDays: 30,
    smartDaily: 30,
    smartWeekly: 12,
    smartMonthly: 12,
  },
  compression: CompressionLevel.Normal,
  encryption: { type: EncryptionType.None, password: process.env.BACKUP_ENCRYPTION_PASSWORD || '' },
  verification: { verifyIntegrity: true, testRestore: false, sha256Checksum: true },
  notifications: {
    on: ['failed'],
    channels: ['desktop'],
    emailAddress: process.env.BACKUP_NOTIFY_EMAIL || '',
    phoneNumber: '',
  },
  cleanup: { deleteExpired: true, deleteTempFiles: true, removeFailedFiles: true },
  internetBehaviour: InternetBehaviour.LocalOnly,
  namingFormat: 'POS-CAFE_{TYPE}_{DATE}_{TIME}',
  schedule: { time: process.env.BACKUP_TIME || '02:00', dayOfWeek: 7, timezone: 'UTC', customIntervalMinutes: 60, cronExpression: '' },
  advanced: {
    maxThreads: 1,
    compressionLevel: 6,
    pauseBusinessHours: false,
    businessHoursStart: '08:00',
    businessHoursEnd: '22:00',
    skipIfBusy: false,
    retryCount: 3,
    retryDelayMinutes: 5,
    backupTimeoutMinutes: 60,
    maxDiskUsageGb: 999999,
    autoDiskSpaceCheck: true,
  },
};
