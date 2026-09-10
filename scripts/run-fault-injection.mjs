#!/usr/bin/env node
import { runFaultInjectionHarness } from '../dist/src/fault-injection.js'

console.log(JSON.stringify(runFaultInjectionHarness(), null, 2))
