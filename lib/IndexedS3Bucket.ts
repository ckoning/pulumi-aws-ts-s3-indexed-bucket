import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as archive from '@pulumi/archive';

/**
 * A Pulumi ComponentResource to deploy a S3 bucket whose content is indexed into a DynamoDB table
 * using S3 bucket events and a Lambda function.
 */
export class IndexedS3Bucket extends pulumi.ComponentResource {
  readonly bucket: aws.s3.Bucket;
  readonly table: aws.dynamodb.Table;
  readonly role: aws.iam.Role;
  readonly lambda: aws.lambda.Function;

  /**
   * Create a S3 bucket to contain the user data
   *
   * @param {string} bucketName - The name of the S3 bucket to be created
   * @returns aws.s3.Bucket
   */
  protected createBucket(bucketName: string): aws.s3.Bucket {
    const bucket = new aws.s3.Bucket(bucketName, {}, { parent: this });
    return bucket;
  }

  /**
   * Create a DynamoDB table to contain the bucket content index
   * @param {string} tableName - The name of the DynamoDB table to be created
   * @returns aws.dynamodb.Table
   */
  protected createTable(tableName: string): aws.dynamodb.Table {
    const table = new aws.dynamodb.Table(
      tableName,
      {
        name: tableName,
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
   * @param {string} functionName - Name of the Lambda function the IAM role will be assumed by
   * @param {string} tableName - Name of the DynamoDB table the Lambda function is allowed to read/write to/from
   * @param {any} awsctx - The AWS context information containing the account ID and region the assets are deployed in
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
   * Create Lambda function implementing S3 event handler
   *
   * @param functionName - Name of the Lambda function to be created
   * @param bucketName - Name of the S3 bucket the Lambda function will handle events for
   * @param tableName - Name of the DynamoDB table the Lambda function will read/write to/from
   * @param {any} awsctx - The AWS context information containing the account ID and region the assets are deployed in
   * @returns aws.lambda.Function
   */
  protected createLambda(
    functionName: string,
    bucketName: string,
    tableName: string,
    awsctx: any,
  ): aws.lambda.Function {
    // Create the archive from the source file
    const lambdaSource = archive.getFile({
      type: 'zip',
      sourceFile: './src/lambda/index.mjs',
      outputPath: './src/lambda/lambda_function_payload.zip',
    });

    // Create the Lambda function
    const lambda = new aws.lambda.Function(
      functionName,
      {
        name: functionName,
        description: `S3 event processing function for bucket ${bucketName}`,
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
            DYNAMO_TABLE_ARN: `arn:aws:dynamodb:${awsctx.region}:${awsctx.accountId}:table/${tableName}`,
            DYNAMO_TABLE_REGION: awsctx.region,
          },
        },
      },
      { parent: this },
    );

    // Create bucket permission allowing S3 bucket to invoke Lambda function
    const bucketPermission = new aws.lambda.Permission(
      `${bucketName}-${functionName}-permission`,
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
      `${bucketName}-${functionName}-notification`,
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
  constructor(
    bucketName: string,
    awsctx: any,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    // Register this component with name pkg:index:StaticWebsite
    super('ckoning:pulumi-examples:IndexedS3Bucket', bucketName, {}, opts);

    // Define resource names based on user provided bucket name
    const tableName = `${bucketName}-index`;
    const functionName = `${bucketName}-event-handler`;

    // Create the S3 bucket
    this.bucket = this.createBucket(bucketName);

    // Create DynamoDB table
    this.table = this.createTable(tableName);

    // Create IAM role
    this.role = this.createRole(functionName, tableName, awsctx);

    // Create Lambda function
    this.lambda = this.createLambda(
      functionName,
      bucketName,
      tableName,
      awsctx,
    );

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
