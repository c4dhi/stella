import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Logger,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { SystemAdminGuard } from '../auth/guards/system-admin.guard'
import { BackupService, BackupImportReport } from './backup.service'

/**
 * Full-system backup import endpoint (#378). SystemAdmin-only.
 *
 * Export is intentionally NOT exposed over HTTP — it runs only via the wizard
 * export script (scripts/backup-export.sh → the in-pod backup CLI), which also
 * folds in deployment config and handles encryption. Import stays here so an
 * admin can restore a data bundle from the dashboard.
 */
@Controller('admin/backup')
@UseGuards(SystemAdminGuard)
export class BackupController {
  private readonly logger = new Logger(BackupController.name)

  constructor(private readonly backup: BackupService) {}

  /**
   * POST /admin/backup/import?confirmOverwrite=true[&allowKeyMismatch=true]
   * Header X-Backup-Passphrase: <passphrase> (only if the bundle is encrypted)
   *
   * Accepts a bundle upload and restores it, OVERWRITING all existing data. The
   * file streams to a temp path on disk (never buffered in memory) so multi-GB
   * bundles are handled. `confirmOverwrite=true` is required — the service
   * refuses otherwise, mirroring the UI's overwrite confirmation.
   */
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: tmpdir(),
        filename: (_req, _file, cb) =>
          cb(null, `stella-import-${randomBytes(8).toString('hex')}.zip`),
      }),
      // 20 GB ceiling — a backstop, not an expected size.
      limits: { fileSize: 20 * 1024 * 1024 * 1024 },
    }),
  )
  async import(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('confirmOverwrite') confirmOverwrite: string | undefined,
    @Query('allowKeyMismatch') allowKeyMismatch: string | undefined,
    @Headers('x-backup-passphrase') passphrase: string | undefined,
  ): Promise<BackupImportReport> {
    if (!file) {
      throw new BadRequestException('No backup bundle uploaded')
    }
    this.logger.warn(
      `Backup import requested (${file.size} bytes) — overwriting deployment.`,
    )
    return this.backup.import({
      bundlePath: file.path,
      confirmOverwrite: confirmOverwrite === 'true',
      allowKeyMismatch: allowKeyMismatch === 'true',
      passphrase: passphrase || undefined,
    })
  }
}
