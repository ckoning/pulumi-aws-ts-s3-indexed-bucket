import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

import { IndexedS3Bucket } from './lib/IndexedS3Bucket.js';

const bucketPrefix = 'crk-main-indexed-example';

const indexedBucket = new IndexedS3Bucket(bucketPrefix);

export const bucketName = indexedBucket.bucket.id;
export const bucketArn = indexedBucket.bucket.arn;
