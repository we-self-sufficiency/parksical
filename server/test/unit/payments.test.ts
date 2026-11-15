import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readConfig} from '../../src/config.js';
import {verifyPayment} from '../../src/payments/payment.service.js';
import {signWebhook,verifyWebhook} from '../../src/payments/provider.js';
test('payment HMAC authenticates exact bytes, timestamp and constant length signature',()=>{
  const secret='synthetic-test-secret-0000000000000001',raw=Buffer.from('{"orderId":"synthetic"}'),timestamp='1794736800',now=Number(timestamp)*1000;
  const sig=signWebhook(secret,timestamp,raw);verifyWebhook(secret,raw,timestamp,sig,now);
  for(const [body,ts,s] of [[Buffer.from('{ "orderId":"synthetic"}'),timestamp,sig],[raw,timestamp,'0'.repeat(64)],[raw,timestamp,'short'],[raw,undefined,sig],[raw,'1794736400',sig]] as const)assert.throws(()=>verifyWebhook(secret,body,ts,s,now));
  assert.throws(()=>verifyWebhook(secret,raw,timestamp,sig,now+300001));
});
test('payment provider evidence must match server order, transaction, integer amount and currency',()=>{
  const order={id:'order',amountKrw:1000,currency:'KRW'},result={orderId:'order',transactionId:'transaction',amountKrw:1000,currency:'KRW',status:'SUCCEEDED' as const};
  verifyPayment(order,result,'transaction');
  for(const patch of [{orderId:'other'},{transactionId:'other'},{amountKrw:1},{currency:'USD'}])assert.throws(()=>verifyPayment(order,{...result,...patch},'transaction'));
});
test('payments are default off, independent of MAX and blocked in production or with unselected provider',()=>{
  const base={DATABASE_URL:'postgresql://local:local@127.0.0.1/db',NODE_ENV:'test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:'synthetic-development-secret-0000001'};
  assert.equal(readConfig(base).devPaymentsEnabled,false);
  const enabled={...base,DEV_PAYMENTS_ENABLED:'true',PAYMENT_PROVIDER:'SANDBOX',PAYMENT_WEBHOOK_SECRET:'synthetic-webhook-secret-0000000001'};
  assert.equal(readConfig(enabled).devPaymentsEnabled,true);assert.equal(readConfig(enabled).devReservationsEnabled,false);
  for(const patch of [{NODE_ENV:'production'},{DEV_AUTH_ENABLED:'false'},{PAYMENT_PROVIDER:undefined},{PAYMENT_PROVIDER:'REAL'},{PAYMENT_WEBHOOK_SECRET:'short'},{DEV_PAYMENTS_ENABLED:'yes'},{REAL_PAYMENTS_ENABLED:'true'}])assert.throws(()=>readConfig({...enabled,...patch}));
});
