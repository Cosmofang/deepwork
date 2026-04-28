#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = join(__dirname, '..', 'src', 'cli', 'index.ts');

const proc = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', cli, ...process.argv.slice(2)], { stdio: 'inherit' });
proc.on('exit', code => process.exit(code ?? 0));
