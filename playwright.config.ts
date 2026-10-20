import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'**/*.spec.ts',workers:1,timeout:120000,
  use:{baseURL:'http://127.0.0.1:5174',headless:true,launchOptions:{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'},viewport:{width:390,height:844}},
  reporter:[['list']],
});
