/* eslint-env node, mocha */

import { assert } from 'chai';
import Transport from '../src/Transport';

describe('Transport', () => {
  const transport = new Transport({ url: process.env.REDIS_URL });

  before((done) => {
    transport.open(done);
  });

  after((done) => {
    transport.close(done);
  });

  describe('Queue Transport', () => {
    it('posts message', (done) => {
      transport.queue.postMessage('foobar', { a: 1, b: 2 })
        .asCallback(done);
    });

    it('subscribes to queue and receives message', (done) => {
      transport.queue.once('foobar', (message) => {
        assert.isObject(message);
        assert.strictEqual(message.a, 1);
        assert.strictEqual(message.b, 2);
        done();
      });

      transport.queue.subscribe('foobar');
    });

    it('unsubscribes from queue', (done) => {
      transport.queue.unsubscribe('foobar')
        .asCallback(done);
    });
  });

  describe('PubSub Transport', () => {
    it('subscribes, posts and receives message', (done) => {
      transport.pubsub.once('foobar', (message) => {
        assert.isObject(message);
        assert.strictEqual(message.a, 1);
        assert.strictEqual(message.b, 2);
        done();
      });

      transport.pubsub.subscribe('foobar')
        .then(() => {
          transport.pubsub.postMessage('foobar', { a: 1, b: 2 });
        });
    });

    it('unsubscribes from pubsub', (done) => {
      transport.pubsub.unsubscribe('foobar')
        .asCallback(done);
    });
  });

  describe('RPC', () => {
    it('registers method', () => {
      transport.register('foobar', 'add', (a, b, callback) => {
        callback(null, a + b);
      });
    });

    it('invokes method', (done) => {
      transport.invoke('foobar', 'add', [1, 2])
        .then((result) => {
          assert.strictEqual(result, 3);
        })
        .asCallback(done);
    });
  });
});
