#!/usr/bin/env node
// The front door. `npx autocatalog .` has to work before anything is installed
// and before anything is configured, so this package exists to be that name and
// nothing else: it runs the same CLI as `ac`.
import 'autocatalog-cli/bin';
