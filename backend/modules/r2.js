const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// R2 speaks the same language as Amazon S3, so we use the S3 SDK
// pointed at Cloudflare's endpoint instead of AWS's.
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Uploads a file buffer to R2 and returns its public URL.
 * @param {Buffer} buffer   - the file's raw bytes
 * @param {string} key      - the filename to store it under, e.g. "videos/abc123.mp4"
 * @param {string} contentType - e.g. "video/mp4" or "image/jpeg"
 */
async function uploadToR2(buffer, key, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    // Content at this URL never changes once uploaded, so let it be
    // cached forever — this is the caching win, done properly this time.
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

module.exports = { uploadToR2 };
