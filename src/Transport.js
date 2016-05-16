import redis from 'redis';
import Promise from 'bluebird';
import uuid from 'node-uuid';
import _ from 'lodash';
import Boom from 'boom';
import type from 'type-of';
import PubSub from './PubSub';
import Queue from './Queue';

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

class Transport {

  constructor({ url, debug = false }) {
    this.url = url;
    this.debug = debug;

    this.client = null;
    this.isConnected = false;
  }

  open(callback) {
    // check if already connected
    if (this.isConnected) {
      return Promise.resolve();
    }

    this.client = redis.createClient(this.url);
    this.isConnected = true;

    // debug mode
    if (this.debug) {
      this.client.monitor(() => {
        console.log('Entering monitoring mode');
      });

      this.client.on('monitor', (time, args) => {
        console.log(`${time}: ${args}`);
      });
    }

    return Promise.resolve().asCallback(callback);
  }

  close(callback) {
    // check if connected
    if (!this.isConnected) {
      return Promise.resolve(); // exit
    }

    return Promise.resolve()

      .then(() => {
        if (this._pubsub) {
          this._pubsub.removeAllListeners();
          return this._pubsub.unsubscribe();
        }

        return Promise.resolve();
      })

      .then(() => {
        if (this._queue) {
          this._queue.removeAllListeners();
          return this._queue.unsubscribe();
        }

        return Promise.resolve();
      })

      .tap(() => {
        this.client.removeAllListeners();
        this.client.quit();

        this.client = null;
        this._pubsub = null;
        this._queue = null;
        this.isConnected = false;
      })

      .asCallback(callback);
  }

  get pubsub() {
    // check if connected
    if (!this.isConnected) {
      throw new Error('Transport layer is closed or was never opened; did you forget to call #open()');
    }

    // make sure pubsub is singleton
    if (!this._pubsub) {
      this._pubsub = new PubSub({ client: this.client });
    }

    return this._pubsub;
  }

  get queue() {
    // check if connected
    if (!this.isConnected) {
      throw new Error('Transport layer is closed or was never opened; did you forget to call #open()');
    }

    // make sure queue is singleton
    if (!this._queue) {
      this._queue = new Queue({ client: this.client });
    }

    return this._queue;
  }

  register(channel, method, handler) {
    // check if connected
    if (!this.isConnected) {
      throw new Error('Transport layer is closed or was never opened; did you forget to call #open()');
    }

    this.queue.on(channel, ({ id, method: remoteMethod, params = [], jsonrpc }) => {
      // validate jsonrpc property
      if (jsonrpc !== '2.0') {
        console.error(`Invalid JSON-RPC protocol, expected "2.0", received ${jsonrpc}`);
        return; // exit
      }

      // validate id property
      if (!_.isString(id)) {
        console.error(`Invalid JSON-RPC id; expected string, received ${type(id)}`);
        return; // exit
      }

      // validate method property
      if (!_.isString(remoteMethod)) {
        console.error(`Invalid JSON-RPC method; expected string, received ${type(method)}`);
        return; // exit
      }

      // validate params property
      if (!_.isArray(params)) {
        console.error(`Invalid JSON-RPC params; expected array, received ${type(params)}`);
        return; // exit
      }

      if (method === remoteMethod) {
        handler.apply(null, _.concat(params, (error, result) => {
          this.pubsub.postMessage(id, {
            error,
            result,
            id: uuid.v4(),
            jsonrpc: '2.0'
          });
        }));
      }
    });

    this.queue.subscribe(channel);
  }

  invoke(channel, method, params, callback) {
    // check if connected
    if (!this.isConnected) {
      throw new Error('Transport layer is closed or was never opened; did you forget to call #open()');
    }

    // validate channel argument
    if (!_.isString(channel)) {
      throw new TypeError(`Invalid channel argument; expected string, received ${type(channel)}`);
    }

    // validate method argument
    if (!_.isString(method)) {
      throw new TypeError(`Invalid method argument; expected string, received ${type(method)}`);
    }

    // validate params argument
    if (_.isFunction(params)) {
      callback = params;
      params = [];
    } else if (_.isUndefined(params)) {
      params = [];
    } else if (_.isPlainObject(params) || _.isNumber(params) || _.isString(params) || _.isDate(params)) {
      params = [params]; // convert to array
    } else if (!_.isArray(params)) {
      throw new TypeError('Invalid params argument; expected array, object, number, string or date');
    }

    // generate JSON-RPC id
    const id = uuid.v4();

    return new Promise((resolve, reject) => {
      this.pubsub.once(id, ({ result, error }) => {
        if (error) {
          // handle Boom errors
          if (error.isBoom === true) {
            error = Boom.create(error.output.payload.statusCode, error.output.payload.message, error.data);
          }

          reject(error);
        } else {
          resolve(result);
        }

        this.pubsub.unsubscribe(id); // garbage collect
      });

      this.pubsub.subscribe(id)
        .then(() => {
          this.queue.postMessage(channel, { id, method, params, jsonrpc: '2.0' });
        });
    }).asCallback(callback);
  }

}

export default Transport;
