import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

import { IndexedS3Bucket } from './lib/IndexedS3Bucket.js';

// Define bucket name prefix to use in example
const bucketPrefix = 'crk-main-indexed-example';

// Collect AWS execution context details
const identityInfo = aws.getCallerIdentity({});
const accountId = await identityInfo.then(
  (identityInfo) => identityInfo.accountId,
);
const regionInfo = aws.getRegion({});
const region = await regionInfo.then((regionInfo) => regionInfo.id);
const awsctx: any = {
  accountId,
  region,
};

// Create the IndexedS3Bucket
const indexedBucket = new IndexedS3Bucket(bucketPrefix, awsctx);

// Export details for stack outputs
export const bucketName = indexedBucket.bucket.id;
export const bucketArn = indexedBucket.bucket.arn;
export const tableName = indexedBucket.table.name;
export const tableArn = indexedBucket.table.arn;
export const roleArn = indexedBucket.role.arn;
export const lambdaArn = indexedBucket.lambda.arn;
