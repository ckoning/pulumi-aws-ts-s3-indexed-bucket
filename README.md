# pulumi-aws-ts-s3-indexed-bucket
### Overview
A Pulumi resource implementing a S3 bucket whose content is indexed into a DynamoDB table using S3 bucket events and a Lambda function. The index tracks path & filename, creation date, last modified date, and filesize. Folder actions are ignored. All data is encrypted at rest and in transit, and durability settings are enabled to prevent accidental data loss. This pattern is well suited to management of large data sets where content scanning is too time consuming or unreliable, or sensitive data sets where strict access silos are required by policy or regulation.


### Architecture
![Indexed S3 Bucket Diagram](docs/img/indexed_s3_bucket.png?raw=true "Indexed S3 Bucket")

#### Summary
This `IndexedS3Bucket` Pulumi component creates eight AWS resources deploying four architectu ral components to implement the indexed s3 bucket pattern.

- An encrypted, private S3 bucket with versioning enabled stores the data set
- An encrypted auto-scaling DynamoDB table stores the index of the source bucket
- A S3 bucket event handler Lambda function receives change notifications from the source bucket and maintains the index in DynamoDB
- An IAM role is created to grant permissions for the Lambda function to access the other components

#### Resources
The `IndexedS3Bucket` component will create the resources below.

| Resource                     | Component              | Purpose                                                        |
|------------------------------|------------------------|----------------------------------------------------------------|
| aws:dynamodb:Table           | Database table         | Store index data                                               |
| aws:iam:Policy               | IAM role               | Define permissions for event handler function                   |
| aws:iam:Role                 | IAM role               | Create identity for event handler function                     |
| aws:iam:RolePolicyAttachment | IAM role               | Assign permisisons to event handler identity                   |
| aws:lambda:Function          | Event Hanlder Function | Create event handler function                                  |
| aws:lambda:Permission        | Event Hanlder Function | Allow S3 bucket to invoke event handler function               |
| aws:s3:Bucket                | Source bucket          | Store source data to be indexed                                |
| aws:s3:BucketNotification     | Source bucket          | Notify event handler function of source bucket content changes |

### Future Improvements

This design may be improved in the future to improve suitability for more regulated environments. Below are known issues

- Scope down IAM permissions to target specific resources
- Use something analogous to the [CloudPosse Null Label](https://github.com/cloudposse/terraform-null-label) to enforce naming and tagging standards
- Deploy custom log group for the Lambda function to encrypt the logs and control data retention length
- Support customer managed KMS encryption for all resources
- Support VPC endpoint communications between the services to keep all network traffic internal to the organization's private subnets
- Implement lifecycle rules on the source bucket to control data retention and reduce costs
