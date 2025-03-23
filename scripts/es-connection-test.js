/**
 * Simple test script for Elasticsearch connection
 * 
 * Tests both raw HTTP connection and Elasticsearch client connection
 */

const http = require('http');

// Configuration
const ES_HOST = '192.168.1.17';
const ES_PORT = 9200;
const ES_USERNAME = 'elastic';
const ES_PASSWORD = 'o2Hzo=d9mmb2RnCAF_Cc';

// Test raw HTTP connection
function testRawConnection() {
  console.log('\n--- Testing raw HTTP connection ---');
  return new Promise((resolve, reject) => {
    const options = {
      hostname: ES_HOST,
      port: ES_PORT,
      path: '/',
      method: 'GET',
      auth: `${ES_USERNAME}:${ES_PASSWORD}`
    };

    console.log(`Connecting to http://${ES_HOST}:${ES_PORT} with user: ${ES_USERNAME}`);
    
    const req = http.request(options, (res) => {
      console.log(`Status code: ${res.statusCode}`);
      console.log(`Headers: ${JSON.stringify(res.headers, null, 2)}`);
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log('Response received.');
        try {
          const parsed = JSON.parse(data);
          console.log('Elasticsearch version:', parsed.version?.number);
          console.log('Cluster name:', parsed.cluster_name);
          resolve(true);
        } catch (e) {
          console.error('Error parsing response:', e);
          console.log('Raw response:', data);
          resolve(false);
        }
      });
    });
    
    req.on('error', (e) => {
      console.error(`Request error: ${e.message}`);
      reject(e);
    });
    
    req.end();
  });
}

// Test Elasticsearch client connection
async function testClientConnection() {
  try {
    console.log('\n--- Testing Elasticsearch client connection ---');
    
    // Check which Elasticsearch client version is installed
    try {
      const packageJson = require('@elastic/elasticsearch/package.json');
      console.log(`Elasticsearch client version: ${packageJson.version}`);
    } catch (e) {
      console.log('Could not determine Elasticsearch client version');
      console.error(`Error: ${e.message}`);
    }
    
    // Try to require the client
    const { Client } = require('@elastic/elasticsearch');
    console.log('Successfully required @elastic/elasticsearch');
    
    // Test connection with Basic auth
    console.log(`\nTesting connection with Basic auth`);
    const client = new Client({
      node: `http://${ES_HOST}:${ES_PORT}`,
      auth: {
        username: ES_USERNAME,
        password: ES_PASSWORD
      }
    });
    
    console.log('Client initialized, calling info() method...');
    const info = await client.info();
    
    console.log('✅ Connection successful!');
    console.log(`Elasticsearch version: ${info.version?.number || info.body?.version?.number}`);
    console.log(`Cluster name: ${info.cluster_name || info.body?.cluster_name}`);
    
    return true;
  } catch (error) {
    console.error('❌ Client connection failed');
    console.error(`Error: ${error.message}`);
    console.log('\nError details:');
    
    if (error.meta) {
      console.log('Error metadata:', JSON.stringify(error.meta, null, 2));
    }
    
    if (error.body) {
      console.log('Error body:', JSON.stringify(error.body, null, 2));
    }
    
    return false;
  }
}

// Run both tests
async function runTests() {
  try {
    console.log('Running Elasticsearch connection tests...');
    
    // Test raw connection
    const rawResult = await testRawConnection();
    console.log(`\nRaw connection test ${rawResult ? 'PASSED ✅' : 'FAILED ❌'}`);
    
    // Test client connection
    const clientResult = await testClientConnection();
    console.log(`\nClient connection test ${clientResult ? 'PASSED ✅' : 'FAILED ❌'}`);
    
    console.log('\n--- Summary ---');
    console.log(`Raw connection: ${rawResult ? 'WORKING' : 'NOT WORKING'}`);
    console.log(`Client connection: ${clientResult ? 'WORKING' : 'NOT WORKING'}`);
    
    if (!clientResult) {
      console.log('\nSuggested fixes:');
      console.log('1. Make sure you have the right Elasticsearch client version:');
      console.log('   npm install @elastic/elasticsearch@8.11.0');
      console.log('2. Check if your credentials are correct');
      console.log('3. Verify that Elasticsearch is accepting connections on the configured port');
    }
    
  } catch (error) {
    console.error('Test runner error:', error);
  }
}

// Run the tests
runTests();