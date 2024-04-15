/**
 * @author Christopher Koning <christopher.koning@gmail.com>
 * @license MPL-2.0
 *
 * S3 bucket event handler Lambda source. This Lambda function is intended to create and maintain a
 * table indexing the contents of an S3 bucket in AWS. As content is uploaded and removed from the
 * bucket, the table is updated with the object key (path & filename), as well as its last modified
 * date. This index table can then be used to query bucket contents to avoid several functional and
 * governance issues related to direct S3 bucket access.
 */
import { S3 } from '@aws-sdk/client-s3'
import {
    DynamoDBClient,
    PutItemCommand,
    DeleteItemCommand
} from '@aws-sdk/client-dynamodb'



/***
 * Initialize AWS configuration
 *
 * Create AWS resources and configure as appropriate for service
 */
console.info('Initialize AWS config')
const tableName = process.env.DYNAMO_TABLE_ARN
const s3 = new S3()
const ddb = new DynamoDBClient({
    apiVersion: "2012-08-10" ,
    region: process.env.DYNAMO_TABLE_REGION
})



/**
 * Upsert filename entry into DynamoDB table
 *
 * @param {string} file - The S3 bucket key (filename) to be created/updated
 * @param {number} size - The size of the file in bytes
 * @async
 */
const handleUpload = async (filename, filesize) => {
    console.info(`Upsert ${filename} into database`)
    // Use PutItemCommand to create or update an object in the DynamoDB table
    // See https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/dynamodb/command/PutItemCommand
    //
    // DynamoDB Client requires that numeric values be transmitted
    // as strings for interoperability between languages.
    // See https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_AttributeValue.html
    const input = {
        "TableName": tableName,
        "Item": {
            "filename": {
              "S": filename
            },
            "size": {
              "N": `${filesize}`
            },
            "created": {
              "N": `${Date.now()}`
            },
            "last_modified": {
              "N": `${Date.now()}`
            }
        },
        "ReturnValues": "NONE"
    }
    console.debug(input)
    const response = await ddb.send(new PutItemCommand(input))
    console.debug(response)
}

/**
 * Remove filename entry from DynamoDB table
 *
 * @param {string} file - The S3 bucket key (filename) to be removed
 * @async
 */
const handleDelete = async (filename) => {
    console.info(`Delete ${filename} from database`)
    const input = {
        "TableName": tableName,
        "Key": {
            "filename": {
                "S": filename
            }
        }
    }
    console.debug(input)
    const response = await ddb.send(new DeleteItemCommand(input))
    console.debug(response)
}



/**
 * Main event handler
 *
 * Receives S3 bucket event, parses source bucket, object key (filename), and
 * upserts or deletes an entry to the DynamoDB table as appropriate for the
 * selected action.
 *
 * @param {object} data - The S3 bucket event to be handled
 * @async
 */
 export const handler = async (data) => {
    console.debug('Received event:', JSON.stringify(data, null, 2))

    // Parse the bucket event data
    const event = data.Records[0]
    const eventName = event.eventName

    const bucket = event.s3.bucket.name
    const key = decodeURIComponent(event.s3.object.key.replace(/\+/g, ' '))
    const size = event.s3.object.size

    /**
     * Handle bucket action
     *
     * See link below for definitions of allowable actions
     * https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html#supported-notification-event-types
     */
    try {
        switch(true) {
            // Upload event
            case eventName.startsWith("ObjectCreated"):
                await handleUpload(key, size)
                break
            // Delete event
            case eventName.startsWith("ObjectRemove"):
                await handleDelete(key)
                break
            // Handle unsupported bucket action
            default:
                throw new Error(`Unsupported bucket action ${eventName}`)
        }
    } catch (err) {
        console.error(err)
    }
}
