import * as pulumi from '@pulumi/pulumi';

/**
 * A Pulumi ComponentResource to deploy a S3 bucket whose content is indexed into a DynamoDB table
 * using S3 bucket events and a Lambda function.
 */
export class IndexedS3Bucket extends pulumi.ComponentResource {
  /**
   * Constructor for `IndexedS3Bucket` component
   *
   * @param {string} bucketName the name of the S3 bucket to be used in resource creation
   * @param {pulumi.ComponentResourceOptions=} opts a `ComponentResource` configuration
   */
  constructor(bucketName: string, opts?: pulumi.ComponentResourceOptions) {
    // Register this component with name pkg:index:StaticWebsite
    super('ckoning:pulumi-examples:IndexedS3Bucket', bucketName, {}, opts);

    // Register that we are done constructing the component and define outputs
    this.registerOutputs({});
  }
}
