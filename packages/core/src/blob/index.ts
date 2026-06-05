import { createS3BlobProvider } from './s3.ts'
import type { BlobProvider, BlobProviderConfig } from './types.ts'

export type {
  BlobHead,
  BlobProvider,
  BlobProviderConfig,
  BlobProviderKind,
  PresignOptions,
  PresignPutOptions,
} from './types.ts'
export { isSha256, physicalKey, projectKeyPrefix, stagingKey } from './keys.ts'

/**
 * Build a {@link BlobProvider} from config. Both `local` (MinIO) and `r2` are S3-compatible,
 * so they share one implementation — the storage analog of `createProvider` for the database.
 */
export function createBlobProvider(config: BlobProviderConfig): BlobProvider {
  if (config.endpoint === '' || config.bucket === '' || config.accessKeyId === '' || config.secretAccessKey === '') {
    throw new Error(`Blob provider "${config.kind}" requires endpoint, bucket, accessKeyId and secretAccessKey.`)
  }
  return createS3BlobProvider(config)
}
