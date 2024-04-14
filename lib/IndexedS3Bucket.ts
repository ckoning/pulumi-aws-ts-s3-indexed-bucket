import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

/**
 * A Pulumi ComponentResource to deploy a S3 bucket whose content is indexed into a DynamoDB table
 * using S3 bucket events and a Lambda function.
 */
export class IndexedS3Bucket extends pulumi.ComponentResource {
  readonly bucket: aws.s3.Bucket;

  /**
   * Constructor for `IndexedS3Bucket` component
   *
   * @param {string} bucketName the name of the S3 bucket to be used in resource creation
   * @param {pulumi.ComponentResourceOptions=} opts a `ComponentResource` configuration
   * @constructor
   */
  constructor(bucketName: string, opts?: pulumi.ComponentResourceOptions) {
    // Register this component with name pkg:index:StaticWebsite
    super('ckoning:pulumi-examples:IndexedS3Bucket', bucketName, {}, opts);

    // Create the S3 bucket
    this.bucket = new aws.s3.Bucket(bucketName, {}, { parent: this });

    // Register that we are done constructing the component and define outputs
    this.registerOutputs({
      bucketArn: this.bucket.id,
      bucketName: this.bucket.arn,
    });
  }
}
