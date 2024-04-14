import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

import { IndexedS3Bucket } from './lib/IndexedS3Bucket.js';

const bucketName = 'crk-main-indexed-example';

const site = new IndexedS3Bucket(bucketName);
