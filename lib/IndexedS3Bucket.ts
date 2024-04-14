import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

/**
 * A Pulumi ComponentResource to deploy a S3 bucket whose content is indexed into a DynamoDB table
 * using S3 bucket events and a Lambda function.
 */
export class IndexedS3Bucket extends pulumi.ComponentResource {
  readonly bucket: aws.s3.Bucket;
  readonly table: aws.dynamodb.Table;

  /**
   * Create a S3 bucket to contain the user data
   *
   * @param {string} bucketName
   * @returns aws.s3.Bucket
   */
  protected createBucket(bucketName: string): aws.s3.Bucket {
    const bucket = new aws.s3.Bucket(bucketName, {}, { parent: this });
    return bucket;
  }

  /**
   * Create a DynamoDB table to contain the bucket content index
   * @param {string} tableName
   * @returns aws.dynamodb.Table
   */
  protected createTable(tableName: string): aws.dynamodb.Table {
    const table = new aws.dynamodb.Table(
      tableName,
      {
        name: tableName,
        // Attribute definitions
        attributes: [
          {
            name: 'filename',
            type: 'S',
          },
          {
            name: 'size',
            type: 'N',
          },
          {
            name: 'created',
            type: 'N',
          },
          {
            name: 'last_modified',
            type: 'N',
          },
        ],
        // Index settings
        hashKey: 'filename',
        rangeKey: 'created',
        localSecondaryIndexes: [
          {
            name: 'size',
            projectionType: 'ALL',
            rangeKey: 'size',
          },
          {
            name: 'last_modified',
            projectionType: 'ALL',
            rangeKey: 'last_modified',
          },
        ],
        // Data durability settings
        deletionProtectionEnabled: true,
        pointInTimeRecovery: {
          enabled: true,
        },
        // Data security settings
        serverSideEncryption: {
          enabled: true,
        },
        // Billing settings
        tableClass: 'STANDARD',
        billingMode: 'PAY_PER_REQUEST', // On-Demand
      },
      { parent: this },
    );
    return table;
  }

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
    this.bucket = this.createBucket(bucketName);

    // Create DynamoDB table
    const tableName = `${bucketName}-index`;
    this.table = this.createTable(tableName);

    // Register that we are done constructing the component and define outputs
    this.registerOutputs({
      bucketArn: this.bucket.id,
      bucketName: this.bucket.arn,
      tableArn: this.table.arn,
      tableName: this.table.name,
    });
  }
}
