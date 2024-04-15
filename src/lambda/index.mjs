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
import { S3 } from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';

/***
 * Initialize AWS configuration
 *
 * Create AWS resources and configure as appropriate for service
 */
console.info('Initialize AWS config');
const tableName = process.env.DYNAMO_TABLE_ARN;
const s3 = new S3();
const ddb = new DynamoDBClient({
  apiVersion: '2012-08-10',
  region: process.env.DYNAMO_TABLE_REGION,
});

/**
 * Check to see if a filename exists in the database, and return current entry data if present
 *
 * @param {string} filename - Full path and filename of the entry to search for
 * @returns
 * @async
 */
const getItem = async (filename) => {
  console.info(`Check for existing file ${filename}`);

  // Look for an existing entry for the given filename
  const input = {
    TableName: tableName,
    ConsistentRead: true,
    Key: {
      filename: {
        S: filename,
      },
    },
  };
  console.debug(input);
  const response = await ddb.send(new GetItemCommand(input));
  console.debug(response);

  // Check for a hit, and clean up the data if entry found
  const fileExists = 'Item' in response ? true : false;
  let data = null;
  if (fileExists) {
    const item = response.Item;
    data = {
      filename: item.filename.S,
      created: item.created.N,
      size: item.size.N,
      last_modified: item.last_modified.N,
    };
  }

  // Return result
  const result = {
    fileExists,
    data,
  };

  return result;
};

/**
 * Create an entry in the database for a newly uploaded file
 *
 * @param {string} filename - Full path and filename of the database entry to create
 * @param {number} filesize - Size of the new file in bytes
 * @async
 */
const createItem = async (filename, filesize) => {
  console.info(`Create item ${filename} in database`);

  // Use PutItemCommand to create update an object in the DynamoDB table
  // See https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/dynamodb/command/PutItemCommand
  //
  // DynamoDB Client requires that numeric values be transmitted
  // as strings for interoperability between languages.
  // See https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_AttributeValue.html
  const input = {
    TableName: tableName,
    Item: {
      filename: {
        S: filename,
      },
      size: {
        N: `${filesize}`,
      },
      created: {
        N: `${Date.now()}`,
      },
      last_modified: {
        N: `${Date.now()}`,
      },
    },
    ReturnValues: 'NONE',
  };
  console.debug(input);
  const response = await ddb.send(new PutItemCommand(input));
  console.debug(response);
};

/**
 * Update an existing entry in the database for a modified file
 *
 * @param {string} filename - Full path and filename for the database entry to update
 * @param {string} filesize - Size of the updated file in bytes
 * @param {object} data - Existing entry data for file
 */
const updateItem = async (filename, filesize, data) => {
  console.info(`Update item ${filename} in database`);

  // Use PutItemCommand to create update an object in the DynamoDB table
  // See https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/dynamodb/command/PutItemCommand
  //
  // DynamoDB Client requires that numeric values be transmitted
  // as strings for interoperability between languages.
  // See https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_AttributeValue.html
  const input = {
    TableName: tableName,
    Item: {
      filename: {
        S: filename,
      },
      size: {
        N: `${filesize}`,
      },
      created: {
        N: `${data.created}`,
      },
      last_modified: {
        N: `${Date.now()}`,
      },
    },
    ReturnValues: 'NONE',
  };
  console.debug(input);
  const response = await ddb.send(new PutItemCommand(input));
  console.debug(response);
};

/**
 * Upsert filename entry into DynamoDB table
 *
 * @param {string} file - The S3 bucket key (filename) to be created/updated
 * @param {number} size - The size of the file in bytes
 * @async
 */
const handleUpload = async (filename, filesize) => {
  console.info(`Upsert ${filename} into database`);

  // Check to see if the item exists in the database already
  const { fileExists, data } = await getItem(filename);
  if (!fileExists) {
    // Create new entry for new files
    await createItem(filename, filesize);
  } else {
    // Update entry for existing files
    await updateItem(filename, filesize, data);
  }
};

/**
 * Remove filename entry from DynamoDB table
 *
 * @param {string} file - The S3 bucket key (filename) to be removed
 * @async
 */
const handleDelete = async (filename) => {
  console.info(`Delete ${filename} from database`);

  // Delete any existing entrise for the filename
  const input = {
    TableName: tableName,
    Key: {
      filename: {
        S: filename,
      },
    },
  };
  console.debug(input);
  const response = await ddb.send(new DeleteItemCommand(input));
  console.debug(response);
};

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
  console.debug('Received event:', JSON.stringify(data, null, 2));

  // Parse the bucket event data
  const event = data.Records[0];
  const eventName = event.eventName;

  const bucket = event.s3.bucket.name;
  const key = decodeURIComponent(event.s3.object.key.replace(/\+/g, ' '));
  const size = event.s3.object.size;

  /**
   * Handle bucket action
   *
   * See link below for definitions of allowable actions
   * https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html#supported-notification-event-types
   */
  try {
    switch (true) {
      // Folder event
      case key.endsWith('/'):
        // Skip all folders, all files are indexed by full path
        break;
      // Upload event
      case eventName.startsWith('ObjectCreated'):
        await handleUpload(key, size);
        break;
      // Delete event
      case eventName.startsWith('ObjectRemove'):
        await handleDelete(key);
        break;
      // Handle unsupported bucket action
      default:
        throw new Error(`Unsupported bucket action ${eventName}`);
    }
  } catch (err) {
    console.error(err);
  }
};
