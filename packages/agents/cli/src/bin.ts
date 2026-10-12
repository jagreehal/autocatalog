#!/usr/bin/env node
// The binary is the only place that exits, so `ac agents …` can call the same
// dispatch as a library without taking the process down with it.
import { runAgentsCli } from './index.js';

runAgentsCli(process.argv.slice(2)).then((code) => process.exit(code));
