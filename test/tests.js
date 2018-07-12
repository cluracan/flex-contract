'use strict'
const ganache = require('ganache-cli');
const FlexContract = require('../src/index');
const promisify = require('util').promisify;
const fs = require('mz/fs');
const assert = require('assert');
const crypto = require('crypto');
const ethjs = require('ethereumjs-util');
const ABI = JSON.parse(fs.readFileSync(require.resolve('./contracts/TestContract_sol_TestContract.abi'), 'utf-8'));
const BYTECODE = fs.readFileSync(require.resolve('./contracts/TestContract_sol_TestContract.bin'), 'utf-8').trim();
const RUNTIME_BYTECODE = fs.readFileSync(require.resolve('./contracts/TestContract_sol_TestContract.runtime.bin'), 'utf-8').trim();
const Web3 = require('web3');

describe('flex-contract', function() {
	let _ganache = null;
	let provider = null;
	let accounts = null;
	let watches = [];

	before(async function() {
		accounts = _.times(16, () => ({
			secretKey: crypto.randomBytes(32),
			balance: 100 + _.repeat('0', 18)
		}));
		_ganache = ganache.server({
			accounts: accounts
		});
		await promisify(_ganache.listen)(8545);
		provider = _ganache.provider;
		provider.setMaxListeners(1024);
	});

	after(async function() {
		await promisify(_ganache.close)();
		_.each(watches, w => w.close());
	});

	it('can deploy', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		const r = c.new();
		const txId = await r.txId;
		assert.ok(txId);
		const receipt = await r.receipt;
		assert.ok(receipt.contractAddress);
	});

	it('can get code digest', async function() {
		const digest = Web3.utils.keccak256('0x'+RUNTIME_BYTECODE);
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const _digest = await c.getCodeDigest();
		assert.equal(_digest, digest);
	});

	it('can call constant functions', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		assert.equal(await c.constFn(), 1);
		assert.equal(await c.constFn(1), 2);
		assert.equal(await c.constFn(1, 2), 3);
		const addr = randomHex(20);
		assert.equal(await c.echoAddress(addr), addr);
		const array = _.times(3, () => randomHex(32));
		assert.equal(_.difference(await c.echoArray(array), array).length, 0);
	});

	it('can call constant functions with named args', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		assert.equal(await c.constFn({args:{}}), 1);
		assert.equal(await c.constFn({args:{a: 1}}), 2);
		assert.equal(await c.constFn({args:{a: 1, b: 2}}), 3);
		const addr = randomHex(20);
		assert.equal(await c.echoAddress({args: {a: addr}}), addr);
		const array = _.times(3, () => randomHex(32));
		assert.equal(_.difference(await c.echoArray({args: {a: array}}), array).length, 0);
	});

	it('can get multiple return values from constant function', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const args = [randomHex(20), _.random(1, 1e6), randomHex(32)];
		const r = await c.returnMultiple(...args);
		for (let i = 0; i < args; i++)
			assert.equal(r, args[i]);
	});

	it('can get multiple named return values from constant function', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const args = [randomHex(20), _.random(1, 1e6), randomHex(32)];
		const r = await c.returnMultipleNamed(...args);
		for (let i = 0; i < args; i++)
			assert.equal(r, args[i]);
	});

	it('can refer to named multiple return values from constant function by name', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const args = [randomHex(20), _.random(1, 1e6), randomHex(32)];
		const r = await c.returnMultipleNamed(...args);
		assert.equal(r['r0'], args[0]);
		assert.equal(r['r1'], args[1]);
		assert.equal(r['r2'], args[2]);
	});

	it('can transact', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const r = c.transact();
		assert.ok(await r.txId);
		assert.ok(await r.receipt);
	});

	it('can transact and pay', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		await c.transact({value: 100});
		const bal = await c.web3.eth.getBalance(c.address);
		assert.equal(bal, 100);
	});

	it('can call a cloned a contract', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const clone = c.clone();
		await clone.constFn();
		await clone.transact();
	});

	it('can deploy a cloned a contract', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		const clone = c.clone();
		await clone.new();
	});

	it('can get a single receipt event', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const args = [randomHex(20), _.random(1, 1e6), randomHex(32)];
		const receipt = await c.raiseEvent(...args);
		const event = receipt.events[0];
		assert.equal(event.address, c.address);
		assert.equal(event.name, 'SingleEvent');
		assert.equal(event.args.a, args[0]);
		assert.equal(event.args.b, args[1]);
		assert.equal(event.args.c, args[2]);
	});

	it('can get multiple receipt events', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const count = 3;
		const args = [randomHex(20), _.random(1, 1e6), randomHex(32)];
		const receipt = await c.raiseEvents(count, ...args);
		const events = receipt.events.sort((a,b) => a.args.idx - b.args.idx);
		for (let i = 0; i < events.length; i++) {
			const event = events[i];
			assert.equal(event.address, c.address);
			assert.equal(event.name, 'RepeatedEvent');
			assert.equal(event.args.idx, i);
			assert.equal(event.args.a, args[0]);
			assert.equal(event.args.b, args[1]);
			assert.equal(event.args.c, args[2]);
		}
	});

	it('can find a receipt event with findEvent', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const count = 3;
		const args = [randomHex(20), _.random(1, 1e6), randomHex(32)];
		const receipt =await c.raiseEvents(count, ...args);
		const event = receipt.findEvent('RepeatedEvent',
			{idx: 1, a: args[0], b: args[1], c: args[2]});
		assert.equal(event.address, c.address);
		assert.equal(event.name, 'RepeatedEvent');
		assert.equal(event.args.idx, 1);
		assert.equal(event.args.a, args[0]);
		assert.equal(event.args.b, args[1]);
		assert.equal(event.args.c, args[2]);
	});

	it('can see receipt event raised in other contract', async function() {
		const c1 = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		const c2 = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c1.new();
		await c2.new();
		const args = [randomHex(20), _.random(1, 1e6), randomHex(32)];
		const receipt = await c1.callOther(c2.address, ...args);
		const event = receipt.events[0];
		assert.equal(event.address, c2.address);
		assert.equal(event.name, 'SingleEvent');
		assert.equal(event.args.a, args[0]);
		assert.equal(event.args.b, args[1]);
		assert.equal(event.args.c, args[2]);
	});

	it('can send transaction with explicit key', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		await c.transact({key: accounts[0].secretKey});
	});

	it('can get past events', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const argss = _.times(8, () =>
			[randomHex(20), _.random(1, 1e6), randomHex(32)]);
		for (let args of argss)
			await c.raiseEvent(...args);
		const r = await c.SingleEvent({fromBlock: -argss.length});
		assert.equal(r.length, argss.length);
		for (let i = 0; i < argss.length; i++) {
			const args = argss[i];
			const event = r[i];
			assert.equal(event.name, 'SingleEvent');
			assert.equal(event.address, c.address);
			for (let j = 0; j < args.length; j++)
				assert.equal(event.args[j], args[j]);
		}
	});

	it('can get past events with array filter args', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const choices = [
			_.times(2, () => randomHex(20)),
			_.times(2, () => _.random(1, 1e6)),
			_.times(2, () => randomHex(32))
		];
		const argss = _.times(8, () =>
			_.times(choices.length, i => _.sample(choices[i])));
		for (let args of argss) {
			await c.raiseEvents(1, ...args);
			await c.raiseEvent(...args);
		}
		const filters = _.times(16,
			() => _.times(choices.length, i => _.sample(choices[i])));
		const matches = _.map(filters, f => _.filter(argss, a => {
			return _.every(_.times(a.length, i => a[i] == f[i]));
		}));
		for (let n = 0; n < filters.length; n++) {
			const r = await c.SingleEvent(
				{fromBlock: -argss.length * 2, args: filters[n]});
			assert.equal(r.length, matches[n].length);
			for (let i = 0; i < r.length; i++) {
				const event = r[i];
				const match = matches[i];
				assert.equal(event.name, 'SingleEvent');
				assert.equal(event.address, c.address);
				for (let j = 0; j < event.args.length; j++)
					assert.equal(event.args[j], match[j]);
			}
		}
	});

	it('can get past events with named filter args', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const choices = [
			_.times(2, () => randomHex(20)),
			_.times(2, () => _.random(1, 1e6)),
			_.times(2, () => randomHex(32))
		];
		const argss = _.times(8, () =>
			_.times(choices.length, i => _.sample(choices[i])));
		for (let args of argss) {
			await c.raiseEvents(1, ...args);
			await c.raiseEvent(...args);
		}
		const filters = _.times(16,
			() => _.times(choices.length, i => _.sample(choices[i])));
		const matches = _.map(filters, f => _.filter(argss, a => {
			return _.every(_.times(a.length, i => a[i] == f[i]));
		}));
		for (let n = 0; n < filters.length; n++) {
			const r = await c.SingleEvent(
				{
					fromBlock: -argss.length * 2,
					args: {
						a: filters[n][0],
						b: filters[n][1],
						c: filters[n][2],
					}});
			assert.equal(r.length, matches[n].length);
			for (let i = 0; i < r.length; i++) {
				const event = r[i];
				const match = matches[i];
				assert.equal(event.name, 'SingleEvent');
				assert.equal(event.address, c.address);
				for (let j = 0; j < event.args.length; j++)
					assert.equal(event.args[j], match[j]);
			}
		}
	});

	it('can watch future events', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const watch = c.SingleEvent.watch({pollRate: 25});
		watches.push(watch);
		const logs = [];
		watch.on('data', log => logs.push(log));
		const argss = _.times(8, () =>
			[randomHex(20), _.random(1, 1e6), randomHex(32)]);
		for (let args of argss) {
			await c.raiseEvents(1, ...args);
			await c.raiseEvent(...args);
		}
		await wait(100);
		assert.equal(logs.length, argss.length);
		for (let i = 0; i < argss.length; i++) {
			const args = argss[i];
			const event = logs[i];
			assert.equal(event.name, 'SingleEvent');
			assert.equal(event.address, c.address);
			for (let j = 0; j < args.length; j++)
				assert.equal(event.args[j], args[j]);
		}
	});

	it('can watch future events with a full filter', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const logs = [];
		const choices = [
			_.times(2, () => randomHex(20)),
			_.times(2, () => _.random(1, 1e6)),
			_.times(2, () => randomHex(32))
		];
		const argss = [..._.times(4, () => _.times(3, (i) => choices[i][0])),
			..._.times(4, () => _.times(3, (i) => choices[i][1]))]
		const filter = argss[0];
		const watch = c.SingleEvent.watch({args: filter, pollRate: 25});
		watches.push(watch);
		watch.on('data', log => logs.push(log));
		for (let args of argss) {
			await c.raiseEvents(1, ...args);
			await c.raiseEvent(...args);
		}
		await wait(100);
		assert.equal(logs.length, 4);
		for (let i = 0; i < logs.length; i++) {
			const event = logs[i];
			const match = choices[0];
			assert.equal(event.name, 'SingleEvent');
			assert.equal(event.address, c.address);
			for (let j = 0; j < event.args.length; j++)
				assert.equal(event.args[j], match[j]);
		}
	});

	it('can watch future events with a partial filter', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const logs = [];
		const choices = [
			_.times(2, () => randomHex(20)),
			_.times(2, () => _.random(1, 1e6)),
			_.times(2, () => randomHex(32))
		];
		const argss = [..._.times(4, () => _.times(3, (i) => choices[i][0])),
			..._.times(4, () => _.times(3, (i) => choices[i][1]))]
		const filter = _.slice(argss[0], 0, 2);
		const watch = c.SingleEvent.watch({args: filter, pollRate: 50});
		watches.push(watch);
		watch.on('data', log => logs.push(log));
		for (let args of argss) {
			await c.raiseEvents(1, ...args);
			await c.raiseEvent(...args);
		}
		await wait(300);
		watch.stop();
		assert.equal(logs.length, 4);
		for (let i = 0; i < logs.length; i++) {
			const event = logs[i];
			const match = choices[0];
			assert.equal(event.name, 'SingleEvent');
			assert.equal(event.address, c.address);
			for (let j = 0; j < event.args.length; j++)
				assert.equal(event.args[j], match[j]);
		}
	});

	it('can stop watching future events', async function() {
		const c = new FlexContract(ABI, {provider: provider, bytecode: BYTECODE});
		await c.new();
		const watch = c.SingleEvent.watch({pollRate: 25});
		watches.push(watch);
		const logs = [];
		watch.on('data', log => logs.push(log));
		const argss = _.times(4, () =>
			[randomHex(20), _.random(1, 1e6), randomHex(32)]);
		for (let args of argss) {
			await c.raiseEvents(1, ...args);
			await c.raiseEvent(...args);
		}
		await wait(100);
		watch.stop();
		for (let args of argss) {
			await c.raiseEvents(1, ...args);
			await c.raiseEvent(...args);
		}
		await wait(100);
		assert.equal(logs.length, argss.length);
	});
});

function randomHex(size=32) {
	return '0x'+crypto.randomBytes(size).toString('hex');
}

function wait(ms) {
	return new Promise((accept, reject) => {
		setTimeout(accept, ms);
	});
}
