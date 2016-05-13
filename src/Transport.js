import redis from 'redis';
import Promise from 'bluebird';
import uuid from 'node-uuid';
import _ from 'lodash';
import Boom from 'boom';
import PubSub from './PubSub';
import Queue from './Queue';

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

class Transport {

  constructor({ url, debug = false }) {
    this.client = redis.createClient(url);
    this.methods = {};

    this.pubsub = new PubSub({
      client: this.client
    });

    this.queue = new Queue({
      client: this.client
    });

    // set functionality on debug mode
    if (debug === true) {
      this.client.monitor(() => {
        console.log('Entering monitoring mode');
      });

      this.client.on('monitor', (time, args) => {
        console.log(`${time}: ${args}`);
      });
    }
  }

  register(channel, method, handler) {
    this.queue.on(channel, ({ id, method: remoteMethod, params = [], jsonrpc }) => {
      // validate jsonrpc property
      if (jsonrpc !== '2.0') {
        console.error(`Invalid JSON-RPC protocol, expected "2.0", received ${jsonrpc}`);
        return; // exit
      }

      // validate id property
      if (!_.isString(id)) {
        console.error('Invalid JSON-RPC id, expected string');
        return; // exit
      }

      // validate method property
      if (!_.isString(remoteMethod)) {
        console.error('Invalid JSON-RPC method, expected string');
        return; // exit
      }

      // validate params property
      if (!_.isArray(params)) {
        console.error('Invalid JSON-RPC params, expected array');
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
    // validate channel argument
    if (!_.isString(channel)) {
      throw new TypeError('Invalid channel argument; expected string');
    }

    // validate method argument
    if (!_.isString(method)) {
      throw new TypeError('Invalid method argument; expected string');
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

  close() {
    return this.client.quitAsync();
  }

}

export default Transport;
