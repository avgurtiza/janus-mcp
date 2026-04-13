#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const nodeCmd = process.execPath;
const indexPath = path.join(__dirname, '..', 'dist', 'index.js');

const child = spawn(nodeCmd, [indexPath, ...args], {
  stdio: 'inherit',
  cwd: process.cwd()
});

child.on('exit', code => process.exit(code));