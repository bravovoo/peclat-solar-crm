import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:30000,
  reporter:'list',use:{baseURL:'http://localhost:3100',channel:'chrome',headless:true,trace:'retain-on-failure'},
  webServer:{command:'node --import tsx scripts/e2e-server.ts',url:'http://localhost:3100/login',timeout:120000,reuseExistingServer:false},
});
