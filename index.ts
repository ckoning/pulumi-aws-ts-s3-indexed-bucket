import { IndexedS3Bucket } from './lib/IndexedS3Bucket.js';

// Define bucket name prefix to use in example
const bucketPrefix = 'crk-main-indexed-example';

// Create the IndexedS3Bucket
const indexedBucket = new IndexedS3Bucket(bucketPrefix);

// Export details for stack outputs
export const bucketName = indexedBucket.bucket.id;
export const bucketArn = indexedBucket.bucket.arn;
export const tableName = indexedBucket.table.name;
export const tableArn = indexedBucket.table.arn;
export const roleArn = indexedBucket.role.arn;
export const lambdaArn = indexedBucket.lambda.arn;
