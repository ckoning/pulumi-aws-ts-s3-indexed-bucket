import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

/**
 * A Pulumi ComponentResource to deploy a S3 bucket whose content is indexed into a DynamoDB table
 * using S3 bucket events and a Lambda function.
 */
export class IndexedS3Bucket extends pulumi.ComponentResource {
  readonly bucket: aws.s3.Bucket;
  readonly table: aws.dynamodb.Table;
  readonly role: aws.iam.Role;

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
   * Create IAM role defining execution privileges for Lambda function
   *
   * @param {string} functionName
   * @param {string} tableName
   * @param {any} awsctx
   * @returns aws.iam.Role
   */
  protected createRole(
    functionName: string,
    tableName: string,
    awsctx: any,
  ): aws.iam.Role {
    // Define permissions for Lambda function
    const executionPolicyPermissions = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'logs:CreateLogGroup',
          Resource: 'arn:aws:logs:*:*:*',
        },
        {
          Effect: 'Allow',
          Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          Resource: ['arn:aws:logs:*:*:*'],
        },
        {
          Effect: 'Allow',
          Action: ['s3:GetObject'],
          Resource: 'arn:aws:s3:::*/*',
        },
        {
          Effect: 'Allow',
          Action: [
            'dynamodb:GetItem',
            'dynamodb:Query',
            'dynamodb:Scan',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
          ],
          Resource: `arn:aws:dynamodb:${awsctx.region}:${awsctx.accountId}:table/${tableName}`,
        },
      ],
    };

    // Create IAM policy for Lambda function execution role
    const executionPolicy = new aws.iam.Policy(
      `${functionName}-policy`,
      {
        name: `${functionName}-policy`,
        path: '/',
        description: `Execution permissions for lambda function ${functionName}`,
        policy: JSON.stringify(executionPolicyPermissions),
      },
      { parent: this },
    );

    // Define trust policy for Lambda function execution role
    const trustPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {
            Service: 'lambda.amazonaws.com',
          },
        },
      ],
    };

    // Create Lamdba function execution role
    const executionRole = new aws.iam.Role(
      `${functionName}-role`,
      {
        name: `${functionName}-role`,
        assumeRolePolicy: JSON.stringify(trustPolicy),
      },
      { parent: this },
    );

    // Attach policy to Lambda function exection role
    const executionRolePolicyAttachment = new aws.iam.RolePolicyAttachment(
      `${functionName}-role`,
      {
        role: executionRole.name,
        policyArn: executionPolicy.arn,
      },
      { parent: this },
    );

    return executionRole;
  }

  /**
   * Constructor for `IndexedS3Bucket` component
   *
   * @param {string} bucketName the name of the S3 bucket to be used in resource creation
   * @param {pulumi.ComponentResourceOptions=} opts a `ComponentResource` configuration
   * @constructor
   */
  constructor(
    bucketName: string,
    awsctx: any,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    // Register this component with name pkg:index:StaticWebsite
    super('ckoning:pulumi-examples:IndexedS3Bucket', bucketName, {}, opts);

    // Create the S3 bucket
    this.bucket = this.createBucket(bucketName);

    // Create DynamoDB table
    const tableName = `${bucketName}-index`;
    this.table = this.createTable(tableName);

    // Create IAM role
    const functionName = `${bucketName}-event-handler`;
    this.role = this.createRole(functionName, tableName, awsctx);

    // Register that we are done constructing the component and define outputs
    this.registerOutputs({
      bucketArn: this.bucket.id,
      bucketName: this.bucket.arn,
      tableArn: this.table.arn,
      tableName: this.table.name,
      roleArn: this.role.arn,
    });
  }
}
