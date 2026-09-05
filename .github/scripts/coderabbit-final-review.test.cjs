'use strict';

const assert = require('node:assert/strict');
const gate = require('./coderabbit-final-review.cjs');

assert.deepEqual(gate, { retired: true });
console.log('Retired CodeRabbit requester remains inert.');
