#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class E2ETestRunner {
  constructor() {
    this.serverProcess = null;
    this.testResults = [];
  }

  async killExistingServers() {
    return new Promise((resolve) => {
      exec('pkill -f "ts-node server.js"', (error) => {
        // Ignore error if no process found
        setTimeout(resolve, 1000); // Wait 1s for cleanup
      });
    });
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      console.log('🚀 Starting server...');
      
      this.serverProcess = spawn('npm', ['run', 'start:ts'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      });

      let startupOutput = '';
      
      this.serverProcess.stdout.on('data', (data) => {
        startupOutput += data.toString();
        if (startupOutput.includes('Derivatives Exchange Simulator running on port 3000')) {
          console.log('✅ Server started successfully');
          resolve();
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        console.error('Server error:', data.toString());
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, 10000);
    });
  }

  async stopServer() {
    if (this.serverProcess) {
      console.log('🛑 Stopping server...');
      process.kill(-this.serverProcess.pid, 'SIGTERM');
      this.serverProcess = null;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async runTest(testFile) {
    return new Promise((resolve, reject) => {
      console.log(`\n🧪 Running test: ${testFile}`);
      console.log('='.repeat(60));
      
      const testProcess = spawn('node', [testFile], {
        stdio: 'inherit'
      });

      testProcess.on('close', (code) => {
        const success = code === 0;
        this.testResults.push({
          file: testFile,
          success,
          exitCode: code
        });
        
        console.log(`\n${success ? '✅' : '❌'} Test ${testFile} ${success ? 'PASSED' : 'FAILED'} (exit code: ${code})`);
        resolve(success);
      });

      testProcess.on('error', (error) => {
        console.error(`Test execution error: ${error.message}`);
        reject(error);
      });
    });
  }

  async findTestFiles() {
    const testDir = path.join(__dirname);
    const files = fs.readdirSync(testDir);
    return files
      .filter(file => file.endsWith('.js') && file !== 'run-tests.js')
      .map(file => path.join(testDir, file))
      .sort();
  }

  async runAllTests() {
    try {
      console.log('🔧 E2E Test Runner Starting...');
      
      // Kill any existing servers
      await this.killExistingServers();
      
      // Find all test files
      const testFiles = await this.findTestFiles();
      
      if (testFiles.length === 0) {
        console.log('❌ No test files found');
        return;
      }

      console.log(`Found ${testFiles.length} test file(s):`);
      testFiles.forEach(file => console.log(`  - ${path.basename(file)}`));

      // Run each test with fresh server
      for (const testFile of testFiles) {
        try {
          // Start fresh server for each test
          await this.startServer();
          
          // Wait a bit for server to fully initialize
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Run the test
          await this.runTest(testFile);
          
          // Stop server after test
          await this.stopServer();
          
        } catch (error) {
          console.error(`❌ Error running test ${testFile}:`, error.message);
          await this.stopServer(); // Ensure cleanup
          
          this.testResults.push({
            file: testFile,
            success: false,
            error: error.message
          });
        }
      }

      // Final results
      this.printFinalResults();
      
    } catch (error) {
      console.error('❌ Test runner failed:', error);
      process.exit(1);
    }
  }

  printFinalResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL TEST RESULTS');
    console.log('='.repeat(80));
    
    const passed = this.testResults.filter(r => r.success).length;
    const failed = this.testResults.filter(r => !r.success).length;
    const total = this.testResults.length;
    
    this.testResults.forEach(result => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      const fileName = path.basename(result.file);
      console.log(`${status} ${fileName}`);
      if (result.error) {
        console.log(`      Error: ${result.error}`);
      }
    });
    
    console.log('\n📈 Summary:');
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📊 Success Rate: ${total > 0 ? ((passed/total) * 100).toFixed(1) : 0}%`);
    
    if (failed > 0) {
      process.exit(1);
    }
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  const runner = new E2ETestRunner();
  runner.runAllTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = E2ETestRunner; 