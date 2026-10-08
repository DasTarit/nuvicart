import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const types = read("lib/shipping/types.ts");
const manual = read("lib/shipping/manual.ts");
const shiprocket = read("lib/shipping/shiprocket.ts");
const index = read("lib/shipping/index.ts");

test("ShippingProvider requires findShipmentByReference", () => {
  assert.match(types, /findShipmentByReference\(reference: string\): Promise<Shipment \| null>/);
});

test("Shiprocket implements findShipmentByReference", () => {
  assert.match(shiprocket, /async findShipmentByReference\(reference\)/);
});

test("Manual provider implements findShipmentByReference", () => {
  assert.match(manual, /async findShipmentByReference\(\)/);
});

test("Manual provider does not perform a remote Shiprocket lookup", () => {
  const method = manual.match(/async findShipmentByReference\(\) \{([\s\S]*?)\},/);
  assert.ok(method);
  assert.equal(method[1].trim(), "return null;");
  assert.doesNotMatch(manual, /shiprocket|fetch\(/i);
});

test("Manual provider remains functional for createShipment", () => assert.match(manual, /async createShipment\(input: CreateShipmentInput\)/));
test("Manual provider remains functional for getShipment", () => assert.match(manual, /async getShipment\(\)/));
test("Manual provider remains functional for cancelShipment", () => assert.match(manual, /async cancelShipment\(\)/));
test("Manual provider remains functional for getTracking", () => assert.match(manual, /async getTracking\(\)/));

for (const file of [
  "tests/phase5a-fulfillment.test.mjs",
  "tests/phase5b-shiprocket.test.mjs",
  "tests/phase5b1-shiprocket-reliability.test.mjs",
  "tests/phase4b-payment.test.mjs",
  "tests/phase4b1-reliability.test.mjs",
  "tests/phase4b2-webhook-recovery.test.mjs",
]) test(`${file} remains in the suite`, () => assert.ok(fs.existsSync(path.join(root, file))));

test("no duplicate provider abstraction is introduced", () => {
  assert.match(index, /ShippingProvider/);
  assert.doesNotMatch(types, /ShippingProviderV2|ShippingProvider2/);
});
