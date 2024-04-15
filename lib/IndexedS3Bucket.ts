/**
 * @author Christopher Koning <christopher.koning@gmail.com>
 * @license MPL-2.0
 *
 * A Pulumi ComponentResource to deploy a S3 bucket whose content is indexed into a DynamoDB table
 * using S3 bucket events and a Lambda function. The index tracks path & filename, creation date,
 * last modified date, and filesize.
 */

import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as archive from '@pulumi/archive';

export class IndexedS3Bucket extends pulumi.ComponentResource {
  /** S3 bucket name */
  protected readonly bucketName: string;

  /** Lambda function name */
  protected readonly functionName: string;

  /** DynamoDB table name */
  protected readonly tableName: string;

  /** S3 bucket resource */
  readonly bucket: aws.s3.Bucket;

  /** Lambda function resource */
  readonly lambda: aws.lambda.Function;

  /** Lambda execution IAM role resource */
  readonly role: aws.iam.Role;

  /** DynamoDB table resource */
  readonly table: aws.dynamodb.Table;

  /**
   * Create a S3 bucket to contain the user data
   *
   * @returns aws.s3.Bucket
   */
  protected createBucket(): aws.s3.Bucket {
    const bucket = new aws.s3.Bucket(
      this.bucketName,
      {
        bucket: this.bucketName,
        acl: aws.s3.CannedAcl.Private,
        versioning: {
          enabled: true,
        },
        serverSideEncryptionConfiguration: {
          rule: {
            bucketKeyEnabled: true,
            applyServerSideEncryptionByDefault: {
              sseAlgorithm: 'aws:kms',
            },
          },
        },
      },
      { parent: this },
    );
    return bucket;
  }

  /**
   * Create a DynamoDB table to contain the bucket content index
   *
   * @returns aws.dynamodb.Table
   */
  protected createTable(): aws.dynamodb.Table {
    const table = new aws.dynamodb.Table(
      this.tableName,
      {
        name: this.tableName,
        // Attribute definitions
        // Note: only define attributes that are going to be indexed
        attributes: [
          {
            name: 'filename',
            type: 'S',
          },
        ],
        // Index settings
        hashKey: 'filename',
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
   * @returns aws.iam.Role
   */
  protected createRole(): aws.iam.Role {
    // Define permissions for Lambda function
    const executionPolicyDocument = this.table.arn.apply((arn) =>
      JSON.stringify({
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
            Resource: `${arn}`,
          },
        ],
      }),
    );

    // Create IAM policy for Lambda function execution role
    const executionPolicy = new aws.iam.Policy(
      `${this.functionName}-policy`,
      {
        name: `${this.functionName}-policy`,
        path: '/',
        description: `Execution permissions for lambda function ${this.functionName}`,
        policy: executionPolicyDocument,
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
      `${this.functionName}-role`,
      {
        name: `${this.functionName}-role`,
        assumeRolePolicy: JSON.stringify(trustPolicy),
      },
      { parent: this },
    );

    // Attach policy to Lambda function exection role
    const executionRolePolicyAttachment = new aws.iam.RolePolicyAttachment(
      `${this.functionName}-role`,
      {
        role: executionRole.name,
        policyArn: executionPolicy.arn,
      },
      { parent: this },
    );

    return executionRole;
  }

  /**
   * Create Lambda function implementing S3 event handler
   *
   * @returns aws.lambda.Function
   */
  protected createLambda(): aws.lambda.Function {
    // Create the archive from the source file
    const lambdaSource = archive.getFile({
      type: 'zip',
      sourceFile: './src/lambda/index.mjs',
      outputPath: './src/lambda/lambda_function_payload.zip',
    });

    // Get the current region
    const region = aws.getRegionOutput();

    // Create the Lambda function
    const lambda = new aws.lambda.Function(
      this.functionName,
      {
        name: this.functionName,
        description: `S3 event processing function for bucket ${this.bucketName}`,
        code: new pulumi.asset.FileArchive(
          './src/lambda/lambda_function_payload.zip',
        ),
        role: this.role.arn,
        handler: 'index.handler',
        sourceCodeHash: lambdaSource.then(
          (lambdaSource) => lambdaSource.outputBase64sha256,
        ),
        runtime: aws.lambda.Runtime.NodeJS20dX,
        memorySize: 128,
        ephemeralStorage: {
          size: 512,
        },
        environment: {
          variables: {
            DYNAMO_TABLE_ARN: this.table.arn,
            DYNAMO_TABLE_REGION: region.id.apply((id) => id),
          },
        },
      },
      { parent: this },
    );

    // Create bucket permission allowing S3 bucket to invoke Lambda function
    const bucketPermission = new aws.lambda.Permission(
      `${this.bucketName}-${this.functionName}-permission`,
      {
        statementId: 'AllowExecutionFromS3Bucket',
        action: 'lambda:InvokeFunction',
        function: lambda.arn,
        principal: 's3.amazonaws.com',
        sourceArn: this.bucket.arn,
      },
      { parent: this },
    );

    // Create bucket notification for all upload and delete events
    const bucketNotification = new aws.s3.BucketNotification(
      `${this.bucketName}-${this.functionName}-notification`,
      {
        bucket: this.bucket.id,
        lambdaFunctions: [
          {
            lambdaFunctionArn: lambda.arn,
            events: ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'],
          },
        ],
      },
      {
        parent: this,
        dependsOn: [bucketPermission],
      },
    );

    return lambda;
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

    // Define resource names based on user provided bucket name
    this.bucketName = bucketName;
    this.tableName = `${bucketName}-index`;
    this.functionName = `${bucketName}-event-handler`;

    // Create the S3 bucket
    this.bucket = this.createBucket();

    // Create DynamoDB table
    this.table = this.createTable();

    // Create IAM role
    this.role = this.createRole();

    // Create Lambda function
    this.lambda = this.createLambda();

    // Register that we are done constructing the component and define outputs
    this.registerOutputs({
      bucketArn: this.bucket.id,
      bucketName: this.bucket.arn,
      tableArn: this.table.arn,
      tableName: this.table.name,
      roleArn: this.role.arn,
      roleName: this.role.name,
      lambdaArn: this.lambda.arn,
    });
  }
}
