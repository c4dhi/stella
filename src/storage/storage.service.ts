import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'

export interface IStorageService {
  upload(filename: string, data: Buffer): Promise<string>
  download(storagePath: string): Promise<Buffer>
  delete(storagePath: string): Promise<void>
  exists(storagePath: string): Promise<boolean>
  getAbsolutePath(storagePath: string): string
}

@Injectable()
export class StorageService implements IStorageService {
  private readonly logger = new Logger(StorageService.name)
  private readonly storageRoot: string

  constructor(private configService: ConfigService) {
    // Default storage location is ./data/agent-packages relative to project root
    this.storageRoot = this.configService.get<string>(
      'AGENT_STORAGE_PATH',
      path.join(process.cwd(), 'data', 'agent-packages'),
    )
    this.ensureStorageDir()
  }

  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.mkdir(this.storageRoot, { recursive: true })
      this.logger.log(`Storage directory: ${this.storageRoot}`)
    } catch (error) {
      this.logger.error(`Failed to create storage directory: ${error.message}`)
    }
  }

  /**
   * Upload a file to storage.
   * Returns the relative storage path (not absolute).
   */
  async upload(filename: string, data: Buffer): Promise<string> {
    // Generate a unique directory name using timestamp and random suffix
    const timestamp = Date.now()
    const randomSuffix = crypto.randomBytes(4).toString('hex')
    const dirName = `${timestamp}-${randomSuffix}`

    // Sanitize filename
    const safeFilename = this.sanitizeFilename(filename)
    const relativePath = path.join(dirName, safeFilename)
    const absolutePath = path.join(this.storageRoot, relativePath)

    // Create the directory
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })

    // Write the file
    await fs.writeFile(absolutePath, data)
    this.logger.log(`Uploaded file: ${relativePath} (${data.length} bytes)`)

    return relativePath
  }

  /**
   * Download a file from storage.
   */
  async download(storagePath: string): Promise<Buffer> {
    const absolutePath = this.getAbsolutePath(storagePath)

    try {
      const data = await fs.readFile(absolutePath)
      return data
    } catch (error) {
      this.logger.error(`Failed to download ${storagePath}: ${error.message}`)
      throw new Error(`File not found: ${storagePath}`)
    }
  }

  /**
   * Delete a file from storage.
   */
  async delete(storagePath: string): Promise<void> {
    const absolutePath = this.getAbsolutePath(storagePath)
    const dirPath = path.dirname(absolutePath)

    try {
      // Delete the file
      await fs.unlink(absolutePath)
      this.logger.log(`Deleted file: ${storagePath}`)

      // Try to remove the directory if empty
      try {
        const files = await fs.readdir(dirPath)
        if (files.length === 0) {
          await fs.rmdir(dirPath)
          this.logger.debug(`Removed empty directory: ${dirPath}`)
        }
      } catch {
        // Directory might not be empty or already deleted
      }
    } catch (error) {
      this.logger.warn(`Failed to delete ${storagePath}: ${error.message}`)
    }
  }

  /**
   * Check if a file exists in storage.
   */
  async exists(storagePath: string): Promise<boolean> {
    const absolutePath = this.getAbsolutePath(storagePath)

    try {
      await fs.access(absolutePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the absolute filesystem path for a storage path.
   */
  getAbsolutePath(storagePath: string): string {
    // Prevent path traversal attacks
    const normalized = path.normalize(storagePath).replace(/^(\.\.(\/|\\|$))+/, '')
    return path.join(this.storageRoot, normalized)
  }

  /**
   * Calculate SHA256 hash of data.
   */
  static calculateHash(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex')
  }

  /**
   * Sanitize a filename to prevent path traversal.
   */
  private sanitizeFilename(filename: string): string {
    // Remove path separators and dangerous characters
    return filename
      .replace(/[/\\]/g, '_')
      .replace(/\.\./g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
  }

  /**
   * Get the storage root path (for debugging/admin).
   */
  getStorageRoot(): string {
    return this.storageRoot
  }
}
