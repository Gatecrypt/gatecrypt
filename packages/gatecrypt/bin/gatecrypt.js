#!/usr/bin/env node
// The command itself is built into dist/. This file is what package managers link as `gatecrypt`:
// it is in the repository, so the link can be made before the package has been built.
import '../dist/cli.js';
